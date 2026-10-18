// A person's inbox: what happened that they should look at, with read / unread / done kept on the
// server so it follows them from laptop to phone. Nothing here is new activity; it is the activity
// feed filtered to what concerns one person, plus their own marks on it.
//
// What concerns you:
//   - what other people do in repositories you can write to (yours, your organizations', or ones
//     you were invited to with Write);
//   - anything that mentions you (@handle), anywhere you can see;
//   - replies on an issue or pull request that you opened, even in a repository you only read.
// What you did yourself never appears.

import { statement } from "../db/db.ts";
import { createHash } from "node:crypto";
import type { Ctx } from "./context.ts";
import { badRequest } from "./context.ts";
import { listActivity, type ActivityEvent } from "./activity.ts";
import { repoAccess } from "./accounts.ts";
import { config } from "../config.ts";

export type InboxItem = Omit<ActivityEvent, "type"> & {
  type: ActivityEvent["type"] | "lock";
  /** Stable across requests, so a mark made on one device lands on the same item on another. */
  key: string;
  read: boolean;
  done: boolean;
  /** Why it is here. */
  reason: "mention" | "reply" | "activity" | "lock" | "review";
};

const WINDOW = 200; // how far back into the feed the inbox looks
const FIRST_LOOK_DAYS = 7;
const KEY = /^[0-9a-f]{16}$/;
const now = () => new Date().toISOString();

// The text is part of the key so two quick comments by one person on one thread stay two items.
export const keyOf = (e: Pick<ActivityEvent, "at" | "actor" | "href" | "detail"> & { type: string }) => createHash("sha1").update(`${e.at}|${e.actor}|${e.type}|${e.href}|${e.detail}`).digest("hex").slice(0, 16);

/**
 * Anything earlier than this counts as read. The first time someone has an inbox it is set to the
 * later of "when they joined" and "a week ago", and then stays put, so opening it doesn't present
 * a year of history as unread.
 */
async function baseline(ctx: Ctx, userId: number): Promise<string> {
  const row = await ctx.db.get("SELECT inbox_read_before FROM users WHERE owner_id = ?", userId) as { inbox_read_before: string | null };
  if (row.inbox_read_before) return row.inbox_read_before;
  const joined = (await ctx.db.get("SELECT created_at FROM owners WHERE id = ?", userId) as { created_at: string }).created_at;
  const weekAgo = new Date(Date.now() - FIRST_LOOK_DAYS * 86_400_000).toISOString();
  const start = joined > weekAgo ? joined : weekAgo;
  await ctx.db.run("UPDATE users SET inbox_read_before = ? WHERE owner_id = ?", start, userId);
  return start;
}

export async function listInbox(ctx: Ctx, user: { id: number; handle: string }, opts: { view?: "inbox" | "done" | "all"; limit?: number } = {}) {
  const view = opts.view ?? "inbox";
  const before = await baseline(ctx, user.id);
  // Write access is per repository: an owner's or organization's, or a collaborator invited with Write.
  const writeCache = new Map<string, boolean>();
  const canWrite = async (repo: string) => {
    if (!writeCache.has(repo)) {
      const [owner, name] = repo.split("/");
      const row = await ctx.db.get("SELECT r.id, r.owner_id, r.visibility FROM repos r JOIN owners o ON o.id = r.owner_id WHERE o.handle = ? AND r.name = ?", owner, name) as { id: number; owner_id: number; visibility: string } | undefined;
      const access = row ? await repoAccess(ctx, row, user.id) : "none";
      writeCache.set(repo, access === "write" || access === "admin");
    }
    return writeCache.get(repo)!;
  };
  const states = new Map((await ctx.db.all("SELECT key, state FROM inbox_state WHERE user_id = ?", user.id) as { key: string; state: string }[]).map((r) => [r.key, r.state]));
  const mention = new RegExp(`(^|[^\\w-])@${user.handle.replace(/[-]/g, "\\-")}(?![\\w-])`, "i");

  // Who opened a given issue or pull request, looked up once each.
  const authors = new Map<string, number | null>();
  const authorOf = async (repo: string, href: string) => {
    const m = href.match(/\/(issues|pull)\/(\d+)$/);
    if (!m) return null;
    const cacheKey = `${repo}${m[1]}${m[2]}`;
    if (!authors.has(cacheKey)) {
      const [owner, name] = repo.split("/");
      const table = m[1] === "issues" ? "issues" : "pulls";
      const row = await ctx.db.get(`SELECT t.author_id AS a FROM ${table} t JOIN repos r ON r.id = t.repo_id JOIN owners o ON o.id = r.owner_id WHERE o.handle = ? AND r.name = ? AND t.number = ?`, owner, name, Number(m[2])) as { a: number } | undefined;
      authors.set(cacheKey, row?.a ?? null);
    }
    return authors.get(cacheKey) ?? null;
  };

  const items: InboxItem[] = [];
  for (const e of await listActivity(ctx, user.id, { limit: WINDOW })) {
    if (e.actor === user.handle) continue;
    const talks = e.type === "comment" || e.type === "review";
    const reason: InboxItem["reason"] | null = talks && mention.test(e.detail) ? "mention" : talks && await authorOf(e.repo, e.href) === user.id ? "reply" : await canWrite(e.repo) ? "activity" : null;
    if (!reason) continue;
    const key = keyOf(e);
    const state = states.get(key);
    const done = state === "done";
    if ((view === "inbox" && done) || (view === "done" && !done)) continue;
    items.push({ ...e, key, done, reason, read: done || state === "read" || (state !== "unread" && e.at <= before) });
  }
  // A reminder for each lock this person has held for longer than the stale threshold. Derived, so it is gone
  // the moment the lock is released; its read / done marks follow the same key rules as everything else.
  const staleDays = config.locks.staleAfterDays;
  const held = await ctx.db.all("SELECT l.path, l.reason, l.created_at, o.handle AS owner, r.name FROM file_locks l JOIN repos r ON r.id = l.repo_id JOIN owners o ON o.id = r.owner_id WHERE l.user_id = ? ORDER BY l.created_at", user.id) as { path: string; reason: string; created_at: string; owner: string; name: string }[];
  for (const l of held) {
    const ageDays = Math.floor((Date.now() - new Date(l.created_at).getTime()) / 86_400_000);
    if (ageDays < staleDays) continue;
    const at = new Date(new Date(l.created_at).getTime() + staleDays * 86_400_000).toISOString();
    const e = { at, actor: "Craton", type: "lock" as const, href: `/${l.owner}/${l.name}/blob/${l.path}`, detail: l.reason || "Release it once your changes are pushed, so others can edit this file." };
    const key = keyOf(e);
    const state = states.get(key);
    const done = state === "done";
    if ((view === "inbox" && done) || (view === "done" && !done)) continue;
    items.push({ ...e, text: `lock reminder: ${l.path} has been locked by you for ${ageDays} days`, repo: `${l.owner}/${l.name}`, key, done, reason: "lock", read: done || state === "read" || (state !== "unread" && at <= before) });
  }
  // Pull requests someone asked this person to review and they haven't yet. Derived: it goes when they review.
  const asked = await ctx.db.all(`SELECT q.created_at, q.number, req.handle AS requester, o.handle AS owner, r.name, p.title
       FROM review_requests q
       JOIN repos r ON r.id = q.repo_id JOIN owners o ON o.id = r.owner_id
       JOIN pulls p ON p.repo_id = q.repo_id AND p.number = q.number AND p.state = 'open'
       JOIN owners req ON req.id = q.requested_by
       WHERE q.user_id = ?
         AND NOT EXISTS (SELECT 1 FROM reviews rv WHERE rv.repo_id = q.repo_id AND rv.number = q.number AND rv.author_id = q.user_id AND rv.created_at >= q.created_at)`, user.id) as { created_at: string; number: number; requester: string; owner: string; name: string; title: string }[];
  for (const a of asked) {
    const e = { at: a.created_at, actor: a.requester, type: "pr" as const, href: `/${a.owner}/${a.name}/pull/${a.number}`, detail: a.title };
    const key = keyOf({ ...e, type: "review-request" });
    const state = states.get(key);
    const done = state === "done";
    if ((view === "inbox" && done) || (view === "done" && !done)) continue;
    items.push({ ...e, text: `asked for your review on #${a.number}`, repo: `${a.owner}/${a.name}`, key, done, reason: "review", read: done || state === "read" || (state !== "unread" && e.at <= before) });
  }
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  const unread = items.filter((i) => !i.done && !i.read).length;
  return { items: items.slice(0, opts.limit ?? 100), unread };
}

export const unreadCount = async (ctx: Ctx, user: { id: number; handle: string }) => (await listInbox(ctx, user, { view: "inbox", limit: WINDOW })).unread;

function cleanKeys(input: unknown): string[] {
  if (!Array.isArray(input) || input.length === 0) throw badRequest("Say which items: { keys: [...] }.");
  if (input.length > 200) throw badRequest("Mark up to 200 items at a time.");
  const keys = input.map(String);
  const bad = keys.find((k) => !KEY.test(k));
  if (bad) throw badRequest(`“${bad.slice(0, 40)}” isn’t an inbox item.`);
  return [...new Set(keys)];
}

async function mark(ctx: Ctx, userId: number, input: unknown, state: "read" | "unread" | "done") {
  const keys = cleanKeys(input);
  const upsert = statement(ctx.db, "INSERT INTO inbox_state (user_id, key, state, at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, key) DO UPDATE SET state = excluded.state, at = excluded.at");
  for (const k of keys) await upsert.run(userId, k, state, now());
  return keys.length;
}

export const markRead = (ctx: Ctx, userId: number, keys: unknown) => mark(ctx, userId, keys, "read");
export const markUnread = (ctx: Ctx, userId: number, keys: unknown) => mark(ctx, userId, keys, "unread");
/** Done hides an item; restoring it (Undo) puts it back as read, since you had seen it. */
export const markDone = (ctx: Ctx, userId: number, keys: unknown) => mark(ctx, userId, keys, "done");
export const restore = (ctx: Ctx, userId: number, keys: unknown) => mark(ctx, userId, keys, "read");

/** Everything up to now becomes read in one write; explicit unread marks are cleared, done items stay done. */
export async function markAllRead(ctx: Ctx, userId: number) {
  await baseline(ctx, userId);
  await ctx.db.run("UPDATE users SET inbox_read_before = ? WHERE owner_id = ?", now(), userId);
  await ctx.db.run("DELETE FROM inbox_state WHERE user_id = ? AND state IN ('read', 'unread')", userId);
  // Done marks only matter while the item is still in the window; drop the old ones.
  await ctx.db.run("DELETE FROM inbox_state WHERE user_id = ? AND state = 'done' AND at < ?", userId, new Date(Date.now() - 90 * 86_400_000).toISOString());
}
