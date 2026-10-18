// A person's own security activity: sign-ins (and failed ones), password changes and resets, tokens
// created or revoked, two-step verification turned on or off. Shown only to that person, newest first,
// so an unfamiliar entry is something they can act on. Never holds secrets, only what happened.

import type { Ctx } from "./context.ts";

export const SECURITY_EVENT_TYPES = [
  "signed_in",
  "sign_in_failed",
  "password_changed",
  "password_reset_requested",
  "password_reset",
  "token_created",
  "token_revoked",
  "session_revoked",
  "two_factor_enabled",
  "two_factor_disabled",
  "recovery_codes_regenerated",
  "oauth_linked",
  "oauth_unlinked",
  "passkey_added",
  "passkey_removed",
  "passkey_rollback",
] as const;
export type SecurityEventType = (typeof SECURITY_EVENT_TYPES)[number];

/** Most entries kept per person; older ones are dropped as new ones arrive. */
const KEEP = 200;

export async function record(ctx: Ctx, userId: number, type: SecurityEventType, opts: { detail?: string; ip?: string | null; userAgent?: string | null } = {}) {
  await ctx.db.run("INSERT INTO security_events (user_id, type, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?)", userId, type, (opts.detail ?? "").slice(0, 200), opts.ip?.slice(0, 64) ?? null, opts.userAgent?.slice(0, 300) ?? null);
  await ctx.db.run("DELETE FROM security_events WHERE user_id = ? AND id NOT IN (SELECT id FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT ?)", userId, userId, KEEP);
}

export async function list(ctx: Ctx, userId: number, limit = 50) {
  const rows = await ctx.db.all("SELECT id, type, detail, ip, user_agent, created_at FROM security_events WHERE user_id = ? ORDER BY id DESC LIMIT ?", userId, Math.min(KEEP, Math.max(1, limit))) as { id: number; type: string; detail: string; ip: string | null; user_agent: string | null; created_at: string }[];
  return rows.map((r) => ({ id: r.id, type: r.type, detail: r.detail, ip: r.ip, userAgent: r.user_agent, at: r.created_at }));
}
