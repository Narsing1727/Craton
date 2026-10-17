// Webhooks: tell other systems when something happens in a repository (a push, a pull request, a
// release). Signed the Standard Webhooks way, retried with backoff, with a delivery log you can
// replay from. Because this makes the server call URLs that users typed, it refuses to reach
// private, loopback or link-local addresses, and connects to the address it checked, so a hostname
// that later resolves somewhere else (DNS rebinding) can't slip past.
//
// Signature: `webhook-signature: v1,<base64 HMAC-SHA256>` over `"<webhook-id>.<webhook-timestamp>.<body>"`,
// keyed with the base64-decoded bytes of the secret (`whsec_...`). Receivers should compare in
// constant time and reject timestamps more than a few minutes old.

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import type { Ctx } from "./context.ts";
import { badRequest, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { config } from "../config.ts";
import { sendWebhookPausedEmail } from "./email.ts";
import { FORMATS, chatBody, detectFormat, type Format } from "./chatformat.ts";

export const EVENTS = ["push", "pull_request", "release", "issue", "lock"] as const;
export type WebhookEvent = (typeof EVENTS)[number] | "ping";

/**
 * What each event carries in `data`, beside the envelope every delivery has (id, type, createdAt, repository). The
 * tests compare this table with real deliveries, so it cannot say more or less than what is sent. `optional` fields
 * appear only for some actions.
 */
export const EVENT_DOCS: Record<WebhookEvent, { when: string; fields: Record<string, string>; optional?: string[] }> = {
  ping: { when: "A webhook was created, or you pressed Send test.", fields: { zen: "A sentence, to show the delivery works." } },
  push: {
    when: "A branch moved to a new commit.",
    fields: { branch: "The branch name.", before: "The commit it pointed at (null for a new branch).", after: "The commit it points at now.", pusher: "Handle of who pushed.", commits: "Up to 20 new commits: sha, message, author." },
  },
  pull_request: {
    when: "A pull request was opened, merged or closed.",
    fields: { action: "opened, merged or closed.", number: "The pull request number.", title: "Its title.", source: "The branch with the changes.", target: "The branch it merges into.", author: "Who opened it (action opened).", mergedBy: "Who merged it (action merged).", closedBy: "Who closed it (action closed)." },
    optional: ["author", "mergedBy", "closedBy"],
  },
  release: {
    when: "A release was published.",
    fields: { tag: "The version tag.", title: "The release title.", prerelease: "True for a pre-release.", commit: "The commit it pins.", merkleRoot: "The Merkle root of that commit.", author: "Who published it." },
  },
  issue: {
    when: "An issue was opened, closed or reopened. Editing its text is not an event.",
    fields: { action: "opened, closed or reopened.", number: "The issue number.", title: "Its title.", label: "Its label.", author: "Who opened it (action opened).", by: "Who closed or reopened it." },
    optional: ["author", "by"],
  },
  lock: {
    when: "A file was locked or unlocked.",
    fields: { action: "locked or unlocked.", path: "The file's path.", reason: "Why it was locked (action locked).", holder: "Who took the lock (action locked).", by: "Who released it (action unlocked).", forced: "True when an admin released someone else's lock (action unlocked)." },
    optional: ["reason", "holder", "by", "forced"],
  },
};

/** When each attempt happens, counted from the previous one. The first is immediate. */
const BACKOFF_MS = [0, 30_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
const TIMEOUT_MS = 10_000;
const MAX_BODY_LOG = 500;

// ── Safe destinations ──────────────────────────────────────────────────────

/** True for addresses a webhook must never reach: this host, private networks, link-local (cloud metadata), and so on. */
export function isBlockedAddress(address: string): boolean {
  const v = net.isIP(address);
  if (v === 4) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, including 169.254.169.254 metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) || // IETF protocol assignments, documentation
      (a === 198 && (b === 18 || b === 19)) || // benchmarking
      a >= 224 // multicast and reserved
    );
  }
  if (v === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4 written as IPv6
    if (mapped) return isBlockedAddress(mapped[1]);
    return /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff"); // unique-local, link-local, multicast
  }
  return true; // not an address at all
}

/** Syntax check at the time a webhook is saved; the address check happens again at every delivery. */
export function validateUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw badRequest("Enter a full URL, like https://example.org/hooks/craton.");
  }
  const dev = config.webhooks.allowPrivate;
  if (u.protocol !== "https:" && !(dev && u.protocol === "http:")) throw badRequest("Webhook URLs must use https://.");
  if (u.username || u.password) throw badRequest("Put credentials in the receiver, not in the URL.");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!dev && (host === "localhost" || (net.isIP(host) !== 0 && isBlockedAddress(host)))) {
    throw badRequest("That address is on a private network, so Craton can’t reach it. Use a public URL.");
  }
  return u;
}

/** A DNS lookup that refuses to return a blocked address, so the connection can only go where we checked. */
function safeLookup(hostname: string, options: dns.LookupOptions, callback: (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = addresses as dns.LookupAddress[];
    if (!config.webhooks.allowPrivate && list.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error("That address is on a private network, so Craton won’t send to it."), { code: "EBLOCKED" }));
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

// ── Signing ────────────────────────────────────────────────────────────────

export const newSecret = () => `whsec_${randomBytes(32).toString("base64")}`;

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return `v1,${createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64")}`;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

type HookRow = { id: number; repo_id: number; url: string; secret: string; events: string; active: number; paused_reason: string | null; created_at: string; format: Format };

const cleanEvents = (input: unknown): string[] => {
  const list = Array.isArray(input) ? input.map(String) : [];
  const bad = list.find((e) => !(EVENTS as readonly string[]).includes(e));
  if (bad) throw badRequest(`“${bad}” isn’t an event. Choose from: ${EVENTS.join(", ")}.`);
  const unique = [...new Set(list)];
  if (!unique.length) throw badRequest(`Choose at least one event: ${EVENTS.join(", ")}.`);
  return unique;
};

function hookJson(r: HookRow) {
  return { id: r.id, url: r.url, format: r.format, events: JSON.parse(r.events) as string[], active: Boolean(r.active), pausedReason: r.paused_reason, createdAt: r.created_at };
}

function findHook(ctx: Ctx, repo: RepoRow, id: number): HookRow {
  const row = ctx.db.prepare("SELECT * FROM webhooks WHERE id = ? AND repo_id = ?").get(id, repo.id) as HookRow | undefined;
  if (!row) throw notFound("Webhook");
  return row;
}

export function listHooks(ctx: Ctx, repo: RepoRow) {
  const rows = ctx.db.prepare("SELECT * FROM webhooks WHERE repo_id = ? ORDER BY id").all(repo.id) as HookRow[];
  return rows.map((r) => {
    const last = ctx.db.prepare("SELECT status, response_code, created_at FROM webhook_deliveries WHERE webhook_id = ? AND status != 'pending' ORDER BY id DESC LIMIT 1").get(r.id) as { status: string; response_code: number | null; created_at: string } | undefined;
    return { ...hookJson(r), lastDelivery: last ? { status: last.status, responseCode: last.response_code, at: last.created_at } : null };
  });
}

/** The format asked for, or the one the address implies (Slack, Teams and Discord have their own webhook hosts). */
const chooseFormat = (asked: unknown, url: string): Format => {
  if (asked === undefined || asked === null || asked === "" || asked === "auto") return detectFormat(url);
  if (!(FORMATS as readonly unknown[]).includes(asked)) throw badRequest(`format must be one of: auto, ${FORMATS.join(", ")}.`);
  return asked as Format;
};

export function createHook(ctx: Ctx, repo: RepoRow, userId: number, input: { url: string; events: string[]; format?: string }) {
  const url = validateUrl(input.url).toString();
  const format = chooseFormat(input.format, url);
  const events = cleanEvents(input.events);
  if ((ctx.db.prepare("SELECT COUNT(*) AS n FROM webhooks WHERE repo_id = ?").get(repo.id) as { n: number }).n >= 10) throw badRequest("A repository can have up to ten webhooks.");
  const secret = newSecret();
  const id = Number(ctx.db.prepare("INSERT INTO webhooks (repo_id, url, secret, events, created_by, format) VALUES (?, ?, ?, ?, ?, ?)").run(repo.id, url, secret, JSON.stringify(events), userId, format).lastInsertRowid);
  // The secret is shown once, here. A chat room does not check signatures, so a chat webhook has none to show.
  return format === "json" ? { ...hookJson(findHook(ctx, repo, id)), secret } : hookJson(findHook(ctx, repo, id));
}

export function updateHook(ctx: Ctx, repo: RepoRow, id: number, patch: { url?: string; events?: string[]; active?: boolean; format?: string }) {
  findHook(ctx, repo, id);
  if (patch.url !== undefined) {
    const url = validateUrl(patch.url).toString();
    // A new address implies its own format unless one is given with it.
    ctx.db.prepare("UPDATE webhooks SET url = ?, format = ? WHERE id = ?").run(url, chooseFormat(patch.format, url), id);
  } else if (patch.format !== undefined) {
    ctx.db.prepare("UPDATE webhooks SET format = ? WHERE id = ?").run(chooseFormat(patch.format, findHook(ctx, repo, id).url), id);
  }
  if (patch.events !== undefined) ctx.db.prepare("UPDATE webhooks SET events = ? WHERE id = ?").run(JSON.stringify(cleanEvents(patch.events)), id);
  // Resuming or pausing by hand clears the automatic pause's explanation.
  if (patch.active !== undefined) ctx.db.prepare("UPDATE webhooks SET active = ?, paused_reason = NULL WHERE id = ?").run(patch.active ? 1 : 0, id);
  return hookJson(findHook(ctx, repo, id));
}

export function deleteHook(ctx: Ctx, repo: RepoRow, id: number) {
  findHook(ctx, repo, id);
  ctx.db.prepare("DELETE FROM webhooks WHERE id = ?").run(id);
}

export function listDeliveries(ctx: Ctx, repo: RepoRow, hookId: number) {
  findHook(ctx, repo, hookId);
  const rows = ctx.db
    .prepare("SELECT id, event, message_id, attempt, status, response_code, error, next_attempt_at, created_at, delivered_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 50")
    .all(hookId) as { id: number; event: string; message_id: string; attempt: number; status: string; response_code: number | null; error: string | null; next_attempt_at: string | null; created_at: string; delivered_at: string | null }[];
  return rows.map((r) => ({ id: r.id, event: r.event, messageId: r.message_id, attempts: r.attempt, status: r.status, responseCode: r.response_code, error: r.error, nextAttemptAt: r.next_attempt_at, createdAt: r.created_at, deliveredAt: r.delivered_at }));
}

// ── Sending ────────────────────────────────────────────────────────────────

const now = () => new Date().toISOString();
const inflight = new Set<number>();

function envelope(repo: RepoRow, event: WebhookEvent, messageId: string, data: unknown) {
  return JSON.stringify({ id: messageId, type: event, createdAt: now(), repository: { owner: repo.owner, name: repo.name, visibility: repo.visibility }, data });
}

/** Queue an event for every active webhook subscribed to it, and start delivering. Never throws. */
export function emit(ctx: Ctx, repo: RepoRow, event: WebhookEvent, data: unknown) {
  try {
    const hooks = ctx.db.prepare("SELECT * FROM webhooks WHERE repo_id = ? AND active = 1").all(repo.id) as HookRow[];
    let queued = 0;
    for (const h of hooks) {
      if (event !== "ping" && !(JSON.parse(h.events) as string[]).includes(event)) continue;
      const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
      ctx.db.prepare("INSERT INTO webhook_deliveries (webhook_id, event, message_id, payload, status, next_attempt_at) VALUES (?, ?, ?, ?, 'pending', ?)").run(h.id, event, messageId, envelope(repo, event, messageId, data), now());
      queued++;
    }
    if (queued && config.webhooks.autoDeliver) setImmediate(() => void deliverDue(ctx));
  } catch (err) {
    console.error("webhook emit failed", err);
  }
}

/** Send a test event to one webhook, whatever its subscriptions. */
export function ping(ctx: Ctx, repo: RepoRow, hookId: number) {
  const h = findHook(ctx, repo, hookId);
  const messageId = `msg_${randomUUID().replace(/-/g, "")}`;
  ctx.db.prepare("INSERT INTO webhook_deliveries (webhook_id, event, message_id, payload, status, next_attempt_at) VALUES (?, 'ping', ?, ?, 'pending', ?)").run(h.id, messageId, envelope(repo, "ping", messageId, { zen: "Craton webhooks are working." }), now());
  if (config.webhooks.autoDeliver) setImmediate(() => void deliverDue(ctx));
}

/** Put a delivery back in the queue (same message id, as receivers de-duplicate on it) and send it. */
export function redeliver(ctx: Ctx, repo: RepoRow, hookId: number, deliveryId: number) {
  findHook(ctx, repo, hookId);
  const row = ctx.db.prepare("SELECT id FROM webhook_deliveries WHERE id = ? AND webhook_id = ?").get(deliveryId, hookId);
  if (!row) throw notFound("Delivery");
  ctx.db.prepare("UPDATE webhook_deliveries SET status = 'pending', attempt = 0, error = NULL, next_attempt_at = ? WHERE id = ?").run(now(), deliveryId);
  if (config.webhooks.autoDeliver) setImmediate(() => void deliverDue(ctx));
}

type Sent = { ok: boolean; code: number | null; error: string | null };

function post(target: URL, headers: Record<string, string>, body: string): Promise<Sent> {
  return new Promise((resolve) => {
    // Node doesn't look up a host that is already an address, so the lookup guard below never sees
    // one: check it here.
    const host = target.hostname.replace(/^\[|\]$/g, "");
    if (!config.webhooks.allowPrivate && net.isIP(host) !== 0 && isBlockedAddress(host)) {
      return resolve({ ok: false, code: null, error: "That address is on a private network, so Craton won’t send to it." });
    }
    const lib = target.protocol === "https:" ? https : http;
    const req = lib.request(
      target,
      { method: "POST", headers: { ...headers, "content-length": String(Buffer.byteLength(body)) }, timeout: TIMEOUT_MS, lookup: safeLookup as never },
      (res) => {
        let seen = "";
        res.on("data", (d: Buffer) => {
          if (seen.length < MAX_BODY_LOG) seen += d.toString("utf8", 0, MAX_BODY_LOG);
        });
        res.on("end", () => {
          const code = res.statusCode ?? 0;
          // Redirects are not followed: the destination was checked, the one it points to was not.
          resolve({ ok: code >= 200 && code < 300, code, error: code >= 200 && code < 300 ? null : `The receiver answered ${code}${code >= 300 && code < 400 ? " (redirects aren’t followed)" : ""}.` });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error(`No answer within ${TIMEOUT_MS / 1000} seconds.`)));
    req.on("error", (err: NodeJS.ErrnoException) => resolve({ ok: false, code: null, error: err.code === "EBLOCKED" ? err.message : `Couldn’t reach the receiver: ${err.message}` }));
    req.end(body);
  });
}

type DueRow = { id: number; webhook_id: number; event: string; message_id: string; payload: string; attempt: number; url: string; secret: string; format: Format; owner: string; repo_name: string };

/** How many finished deliveries in a row must fail before Craton stops sending to a receiver. */
export const PAUSE_AFTER_FAILURES = 10;

/**
 * A receiver that has failed its last ten finished deliveries (each already retried to exhaustion) is not coming back
 * by itself: pause the webhook, say why, and tell the repository's admins once. A person resumes it from Settings.
 */
function pauseIfDead(ctx: Ctx, webhookId: number, url: string, lastError: string) {
  const last = ctx.db.prepare("SELECT status FROM webhook_deliveries WHERE webhook_id = ? AND status IN ('succeeded','failed') ORDER BY id DESC LIMIT ?").all(webhookId, PAUSE_AFTER_FAILURES) as { status: string }[];
  if (last.length < PAUSE_AFTER_FAILURES || last.some((r) => r.status !== "failed")) return;
  const hook = ctx.db.prepare("SELECT w.active, r.id AS repo_id, r.name, o.handle AS owner, o.id AS owner_id, o.kind FROM webhooks w JOIN repos r ON r.id = w.repo_id JOIN owners o ON o.id = r.owner_id WHERE w.id = ?").get(webhookId) as
    | { active: number; repo_id: number; name: string; owner: string; owner_id: number; kind: string }
    | undefined;
  if (!hook || !hook.active) return;
  const reason = `Paused automatically after ${PAUSE_AFTER_FAILURES} failed deliveries in a row. Last error: ${lastError}`.slice(0, 300);
  ctx.db.prepare("UPDATE webhooks SET active = 0, paused_reason = ? WHERE id = ?").run(reason, webhookId);
  const admins = new Set<string>();
  const addEmail = (sql: string, ...args: number[]) => {
    for (const row of ctx.db.prepare(sql).all(...args) as { email: string }[]) admins.add(row.email);
  };
  if (hook.kind === "org") addEmail("SELECT u.email FROM memberships m JOIN users u ON u.owner_id = m.user_id WHERE m.org_id = ? AND m.role = 'Owner'", hook.owner_id);
  else addEmail("SELECT email FROM users WHERE owner_id = ?", hook.owner_id);
  addEmail("SELECT u.email FROM collaborators c JOIN users u ON u.owner_id = c.user_id WHERE c.repo_id = ? AND c.role = 'Admin'", hook.repo_id);
  for (const to of admins) void sendWebhookPausedEmail(to, `${hook.owner}/${hook.name}`, url, lastError, `${config.webUrl}/${hook.owner}/${hook.name}/settings/webhooks`);
}

async function attempt(ctx: Ctx, d: DueRow) {
  const timestamp = Math.floor(Date.now() / 1000); // each attempt gets a fresh timestamp; the message id stays
  let headers: Record<string, string> = {
    "content-type": "application/json",
    "user-agent": "Craton-Webhooks/1",
    "webhook-id": d.message_id,
    "webhook-timestamp": String(timestamp),
    "webhook-signature": sign(d.secret, d.message_id, timestamp, d.payload),
    "x-craton-event": d.event,
  };
  let body = d.payload;
  if (d.format !== "json") {
    // A chat room: the same event, written as a message in the shape that service reads. Nothing to sign.
    headers = { "content-type": "application/json", "user-agent": "Craton-Webhooks/1", "x-craton-event": d.event };
    body = JSON.stringify(chatBody(d.format, { owner: d.owner, name: d.repo_name }, d.event, (JSON.parse(d.payload) as { data?: Record<string, unknown> }).data ?? {}));
  }
  let result: Sent;
  try {
    result = await post(new URL(d.url), headers, body);
  } catch (err) {
    result = { ok: false, code: null, error: (err as Error).message };
  }
  const tries = d.attempt + 1;
  if (result.ok) {
    ctx.db.prepare("UPDATE webhook_deliveries SET status = 'succeeded', attempt = ?, response_code = ?, error = NULL, next_attempt_at = NULL, delivered_at = ? WHERE id = ?").run(tries, result.code, now(), d.id);
  } else if (tries >= BACKOFF_MS.length) {
    ctx.db.prepare("UPDATE webhook_deliveries SET status = 'failed', attempt = ?, response_code = ?, error = ?, next_attempt_at = NULL WHERE id = ?").run(tries, result.code, result.error, d.id);
    pauseIfDead(ctx, d.webhook_id, d.url, result.error ?? `HTTP ${result.code}`);
  } else {
    ctx.db.prepare("UPDATE webhook_deliveries SET attempt = ?, response_code = ?, error = ?, next_attempt_at = ? WHERE id = ?").run(tries, result.code, result.error, new Date(Date.now() + BACKOFF_MS[tries]).toISOString(), d.id);
  }
}

/** Send everything that is due. Safe to call from a timer and from emit() at once. */
export async function deliverDue(ctx: Ctx) {
  const due = ctx.db
    .prepare(
      `SELECT d.id, d.webhook_id, d.event, d.message_id, d.payload, d.attempt, w.url, w.secret, w.format, o.handle AS owner, r.name AS repo_name
       FROM webhook_deliveries d JOIN webhooks w ON w.id = d.webhook_id JOIN repos r ON r.id = w.repo_id JOIN owners o ON o.id = r.owner_id
       WHERE d.status = 'pending' AND d.next_attempt_at <= ? ORDER BY d.id LIMIT 25`,
    )
    .all(now()) as DueRow[];
  await Promise.all(
    due
      .filter((d) => !inflight.has(d.id))
      .map(async (d) => {
        inflight.add(d.id);
        try {
          await attempt(ctx, d);
        } finally {
          inflight.delete(d.id);
        }
      }),
  );
  return due.length;
}

/** Retry deliveries that failed and are due again. */
export function startRetryLoop(ctx: Ctx) {
  const timer = setInterval(() => void deliverDue(ctx).catch((err) => console.error("webhook retry failed", err)), 15_000);
  timer.unref();
  return timer;
}

