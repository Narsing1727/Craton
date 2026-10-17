// Which emails a person wants. Everything is on until they switch it off, so the stored value is only their overrides.
// Messages about the account itself (a password reset, a new sign-in, two-step verification changing, the account being
// deleted) are not in this list: they are not optional.

import type { Ctx } from "./context.ts";
import { badRequest } from "./context.ts";

export const NOTIFY_KEYS = ["review_requests", "checks_failed", "repo_access", "webhook_paused", "storage"] as const;
export type NotifyKey = (typeof NOTIFY_KEYS)[number];
export type Notify = Record<NotifyKey, boolean>;

/** The choices in effect: the stored overrides over "everything on". A damaged value counts as no overrides. */
export function notifyOf(raw: string | null | undefined): Notify {
  let stored: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed;
  } catch {}
  return Object.fromEntries(NOTIFY_KEYS.map((k) => [k, stored[k] !== false])) as Notify;
}

/** Validate a change and return the new stored value (only the switched-off ones are kept). */
export function mergeNotify(raw: string | null | undefined, patch: unknown): string {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw badRequest("notify must be an object of true/false values.");
  const next = notifyOf(raw);
  for (const [key, value] of Object.entries(patch)) {
    if (!(NOTIFY_KEYS as readonly string[]).includes(key)) throw badRequest(`Unknown notification “${key}”. Choose from ${NOTIFY_KEYS.join(", ")}.`);
    if (typeof value !== "boolean") throw badRequest(`${key} must be true or false.`);
    next[key as NotifyKey] = value;
  }
  return JSON.stringify(Object.fromEntries(NOTIFY_KEYS.filter((k) => !next[k]).map((k) => [k, false])));
}

/** Whether the person with this address wants this kind of email. An address with no account (an invitation) always does. */
export function wantsEmail(ctx: Ctx, address: string, key: NotifyKey): boolean {
  const row = ctx.db.prepare("SELECT notify FROM users WHERE email = ?").get(address) as { notify: string } | undefined;
  return row ? notifyOf(row.notify)[key] : true;
}
