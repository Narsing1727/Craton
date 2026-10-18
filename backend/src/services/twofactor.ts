// Two-step verification: an authenticator-app code (TOTP) after the password, with ten
// single-use recovery codes for a lost phone. Turning it on, off, or replacing the recovery codes
// all need the account password again. Signing in becomes two steps: the password yields a
// short-lived, attempt-limited ticket; the ticket plus a code yields the session.

import { statement } from "../db/db.ts";
import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest } from "./context.ts";
import { verifyPassword, type User } from "./accounts.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";
import { matchTotp, newTotpSecret, otpauthUrl } from "../core/totp.ts";

const ISSUER = "Craton";
const TICKET_MINUTES = 5;
const TICKET_ATTEMPTS = 5;
const RECOVERY_COUNT = 10;
const RECOVERY_ALPHABET = "23456789abcdefghjkmnpqrstuvwxyz"; // no 0/o, 1/l/i

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();
/** The time authenticator codes are judged against. A seam so tests can move it; production leaves it alone. */
export const clock = { unix: () => Math.floor(Date.now() / 1000) };

type Row = { totp_secret: string | null; totp_pending: string | null; totp_enabled_at: string | null; totp_last_step: number | null; password_hash: string };
const row = async (ctx: Ctx, userId: number) => await ctx.db.get("SELECT totp_secret, totp_pending, totp_enabled_at, totp_last_step, password_hash FROM users WHERE owner_id = ?", userId) as Row;

export const isEnabled = async (ctx: Ctx, userId: number) => Boolean((await row(ctx, userId)).totp_secret);

export async function status(ctx: Ctx, userId: number) {
  const r = await row(ctx, userId);
  const left = (await ctx.db.get("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = ? AND used_at IS NULL", userId) as { n: number }).n;
  return { enabled: Boolean(r.totp_secret), enabledAt: r.totp_enabled_at, recoveryCodesLeft: r.totp_secret ? left : 0 };
}

async function requirePassword(ctx: Ctx, userId: number, password: unknown) {
  if (typeof password !== "string" || !verifyPassword(password, (await row(ctx, userId)).password_hash)) {
    throw new ApiError(403, "wrong_password", "Your password isn’t right.");
  }
}

function generateRecoveryCodes(): string[] {
  return Array.from({ length: RECOVERY_COUNT }, () => {
    const bytes = randomBytes(10);
    const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

const normaliseRecovery = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, "");

async function storeRecoveryCodes(ctx: Ctx, userId: number) {
  const codes = generateRecoveryCodes();
  await ctx.db.run("DELETE FROM recovery_codes WHERE user_id = ?", userId);
  const insert = statement(ctx.db, "INSERT INTO recovery_codes (user_id, code_hash) VALUES (?, ?)");
  for (const c of codes) await insert.run(userId, sha(normaliseRecovery(c)));
  return codes;
}

/** Step 1 of turning it on: make a secret and hand it over to be scanned. Nothing changes until a code is confirmed. */
export async function beginSetup(ctx: Ctx, user: User, password: unknown) {
  await requirePassword(ctx, user.id, password);
  if ((await row(ctx, user.id)).totp_secret) throw new ApiError(409, "already_enabled", "Two-step verification is already on. Turn it off first to set it up again.");
  const secret = newTotpSecret();
  await ctx.db.run("UPDATE users SET totp_pending = ? WHERE owner_id = ?", encryptSecret(secret), user.id);
  return { secret, otpauthUrl: otpauthUrl(secret, user.email, ISSUER), issuer: ISSUER, account: user.email };
}

/** Step 2: the first code from the app proves it was scanned correctly. Returns the recovery codes, shown once. */
export async function enable(ctx: Ctx, user: User, code: unknown) {
  const r = await row(ctx, user.id);
  if (r.totp_secret) throw new ApiError(409, "already_enabled", "Two-step verification is already on.");
  if (!r.totp_pending) throw badRequest("Start setup first, then enter a code from your authenticator app.");
  const secret = decryptSecret(r.totp_pending);
  const step = matchTotp(secret, String(code ?? ""), clock.unix());
  if (step === null) throw new ApiError(400, "invalid_code", "That code isn’t right. Check that your phone’s clock is set automatically, and try the next code.");
  await ctx.db.run("UPDATE users SET totp_secret = ?, totp_pending = NULL, totp_enabled_at = ?, totp_last_step = ? WHERE owner_id = ?", encryptSecret(secret), now(), step, user.id);
  return { recoveryCodes: await storeRecoveryCodes(ctx, user.id) };
}

/**
 * Accept an authenticator code or a recovery code. A code is good once: an authenticator step is
 * remembered so it can't be replayed, and a recovery code is struck off.
 */
export async function verifyFactor(ctx: Ctx, userId: number, input: unknown): Promise<"totp" | "recovery" | null> {
  const text = String(input ?? "").trim();
  const r = await row(ctx, userId);
  if (!r.totp_secret || !text) return null;
  const step = matchTotp(decryptSecret(r.totp_secret), text, clock.unix(), r.totp_last_step);
  if (step !== null) {
    // Only one request can claim a given step; a concurrent replay loses here.
    const claimed = await ctx.db.run("UPDATE users SET totp_last_step = ? WHERE owner_id = ? AND (totp_last_step IS NULL OR totp_last_step < ?)", step, userId, step);
    return claimed.changes === 1 ? "totp" : null;
  }
  const used = await ctx.db.run("UPDATE recovery_codes SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL", now(), userId, sha(normaliseRecovery(text)));
  return used.changes === 1 ? "recovery" : null;
}

async function requireFactor(ctx: Ctx, userId: number, password: unknown, code: unknown) {
  await requirePassword(ctx, userId, password);
  if (!await verifyFactor(ctx, userId, code)) throw new ApiError(400, "invalid_code", "That code isn’t right.");
}

export async function disable(ctx: Ctx, user: User, password: unknown, code: unknown) {
  if (!(await row(ctx, user.id)).totp_secret) throw badRequest("Two-step verification isn’t on.");
  await requireFactor(ctx, user.id, password, code);
  await ctx.db.run("UPDATE users SET totp_secret = NULL, totp_pending = NULL, totp_enabled_at = NULL, totp_last_step = NULL WHERE owner_id = ?", user.id);
  await ctx.db.run("DELETE FROM recovery_codes WHERE user_id = ?", user.id);
  await ctx.db.run("DELETE FROM mfa_tickets WHERE user_id = ?", user.id);
}

export async function regenerateRecoveryCodes(ctx: Ctx, user: User, password: unknown, code: unknown) {
  if (!(await row(ctx, user.id)).totp_secret) throw badRequest("Two-step verification isn’t on.");
  await requireFactor(ctx, user.id, password, code);
  return { recoveryCodes: await storeRecoveryCodes(ctx, user.id) };
}

// ── Signing in ─────────────────────────────────────────────────────────────

/** After a correct password for an account with two-step on: a ticket good for one second-factor attempt window. */
export async function startLogin(ctx: Ctx, userId: number) {
  await ctx.db.run("DELETE FROM mfa_tickets WHERE expires_at < ?", now());
  const ticket = `mfa_${randomBytes(24).toString("base64url")}`;
  await ctx.db.run("INSERT INTO mfa_tickets (user_id, ticket_hash, expires_at) VALUES (?, ?, ?)", userId, sha(ticket), new Date(Date.now() + TICKET_MINUTES * 60_000).toISOString());
  return { ticket, expiresInSeconds: TICKET_MINUTES * 60 };
}

/** Whose ticket this is, without using it up, so the caller can rate-limit by account. */
export async function ticketUser(ctx: Ctx, ticket: unknown): Promise<number | null> {
  if (typeof ticket !== "string") return null;
  const t = await ctx.db.get("SELECT user_id, expires_at FROM mfa_tickets WHERE ticket_hash = ?", sha(ticket)) as { user_id: number; expires_at: string } | undefined;
  return t && t.expires_at >= now() ? t.user_id : null;
}

/** Check the code for a ticket. Returns the user id on success; a wrong code counts against the ticket, which dies after a few. */
export async function finishLogin(ctx: Ctx, ticket: unknown, code: unknown): Promise<{ userId: number; method: "totp" | "recovery" }> {
  const bad = new ApiError(401, "invalid_ticket", "That sign-in expired. Enter your password again.");
  if (typeof ticket !== "string") throw bad;
  const t = await ctx.db.get("SELECT id, user_id, attempts, expires_at FROM mfa_tickets WHERE ticket_hash = ?", sha(ticket)) as { id: number; user_id: number; attempts: number; expires_at: string } | undefined;
  if (!t || t.expires_at < now() || t.attempts >= TICKET_ATTEMPTS) {
    if (t) await ctx.db.run("DELETE FROM mfa_tickets WHERE id = ?", t.id);
    throw bad;
  }
  const method = await verifyFactor(ctx, t.user_id, code);
  if (!method) {
    await ctx.db.run("UPDATE mfa_tickets SET attempts = attempts + 1 WHERE id = ?", t.id);
    const left = TICKET_ATTEMPTS - t.attempts - 1;
    throw new ApiError(401, "invalid_code", left > 0 ? `That code isn’t right. ${left} ${left === 1 ? "try" : "tries"} left.` : "That code isn’t right, and there are no tries left. Enter your password again.", { triesLeft: left });
  }
  await ctx.db.run("DELETE FROM mfa_tickets WHERE id = ?", t.id);
  return { userId: t.user_id, method };
}

