// An optional weekly email: what is still unread in a person's inbox, once a week, and nothing when there is nothing.
//
// Off unless the person turns it on (Settings → Profile). Only a confirmed address ever receives one. Every message has a
// one-click unsubscribe that works without signing in: the link carries the account number and a keyed signature, so it
// cannot be forged for someone else. The first digest comes a week after switching it on, so turning it on does not send
// the whole backlog.

import type { Ctx } from "./context.ts";
import { badRequest } from "./context.ts";
import { config } from "../config.ts";
import { sendDigestEmail } from "./email.ts";
import { listInbox } from "./inbox.ts";
import { signValue } from "./secrets.ts";

const WEEK_MS = 7 * 24 * 3_600_000;
const SHOWN = 8;

export const unsubscribeToken = (userId: number) => `${userId}.${signValue("digest-unsubscribe", String(userId))}`;
const unsubscribeUrl = (userId: number) => `${config.webUrl}/digest/unsubscribe?token=${unsubscribeToken(userId)}`;

/** Turn the digest off for whoever the token was made for. The token is checked in constant time by comparing signatures. */
export function unsubscribe(ctx: Ctx, token: unknown): string {
  const [id, sig] = String(token ?? "").split(".");
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || !sig || sig !== signValue("digest-unsubscribe", String(userId))) throw badRequest("That unsubscribe link isn’t valid. Turn the weekly email off in Settings → Profile.");
  const row = ctx.db.prepare("SELECT o.handle FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.id = ?").get(userId) as { handle: string } | undefined;
  if (!row) throw badRequest("That account doesn’t exist any more.");
  ctx.db.prepare("UPDATE users SET digest = 'off' WHERE owner_id = ?").run(userId);
  return row.handle;
}

type Due = { owner_id: number; handle: string; email: string; digest_sent_at: string | null };

/**
 * Send every digest that is due: weekly, confirmed address, something unread that arrived since the last one. A person
 * with nothing new is skipped silently (the week still counts, so they are not retried every hour). Returns how many went out.
 */
export async function sendDue(ctx: Ctx, at: Date = new Date()): Promise<number> {
  const cutoff = new Date(at.getTime() - WEEK_MS).toISOString();
  const due = ctx.db
    .prepare(
      `SELECT u.owner_id, o.handle, u.email, u.digest_sent_at FROM users u JOIN owners o ON o.id = u.owner_id
       WHERE u.digest = 'weekly' AND u.email_verified_at IS NOT NULL AND (u.digest_sent_at IS NULL OR u.digest_sent_at <= ?)`,
    )
    .all(cutoff) as Due[];
  let sent = 0;
  for (const u of due) {
    const since = u.digest_sent_at ?? cutoff;
    const items = listInbox(ctx, { id: u.owner_id, handle: u.handle }, { view: "inbox", limit: 200 }).items.filter((i) => !i.read && i.at > since);
    ctx.db.prepare("UPDATE users SET digest_sent_at = ? WHERE owner_id = ?").run(at.toISOString(), u.owner_id);
    if (!items.length) continue;
    const mentions = items.filter((i) => i.reason === "mention").length;
    await sendDigestEmail(
      u.email,
      u.handle,
      items.slice(0, SHOWN).map((i) => ({ repo: i.repo, text: `${i.actor} ${i.text}${i.detail ? `: ${i.detail.replace(/\s+/g, " ").slice(0, 100)}` : ""}`, href: `${config.webUrl}${i.href}` })),
      items.length,
      mentions,
      `${config.webUrl}/dashboard`,
      unsubscribeUrl(u.owner_id),
    );
    sent++;
  }
  return sent;
}

export function startDigestLoop(ctx: Ctx) {
  const timer = setInterval(() => void sendDue(ctx).catch((err) => console.error("digest failed", err)), 3_600_000);
  timer.unref();
  return timer;
}
