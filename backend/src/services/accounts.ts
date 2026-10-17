// Users, organizations, tokens and permission checks.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./context.ts";
import { makeToken } from "../core/tokens.ts";

export type Owner = { id: number; handle: string; kind: "user" | "org"; name: string; bio: string; created_at: string };
export type User = Owner & { email: string; plan: string; role: string | null; onboarded_at: string | null; email_verified_at: string | null; totp_enabled_at: string | null };
export type Role = "Owner" | "Maintainer" | "Member";

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

/**
 * Names nobody can register: every top-level page of the web app (a person called "dashboard" would have a profile
 * nobody could open, since the page wins), plus names that would be taken for the service or its staff. "ghost" is
 * the account deleted people's conversations are kept under. A test keeps this in step with the web app's folders.
 */
export const RESERVED_HANDLES = new Set([
  // pages and routes of the web app
  "about", "api", "api-reference", "auth", "changelog", "cli", "contact", "dashboard", "dev", "docs", "explore", "forgot-password", "help", "invite",
  "issues", "login", "new", "onboarding", "orgs", "pricing", "privacy", "pulls", "reset-password", "s", "search", "security", "settings", "shared",
  "signup", "stars", "support", "terms", "trending", "verify-email",
  // files and framework paths
  "_next", "favicon", "robots", "sitemap", "static", "assets", "public",
  // names that read as the service or its staff
  "admin", "administrator", "root", "system", "staff", "ghost", "craton", "nerolith", "www", "mail", "status", "security-team", "billing", "official",
]);

// scrypt with a per-password salt: "scrypt$<salt>$<hash>".
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = scryptSync(password, Buffer.from(salt, "base64url"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(actual, expected);
}

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

export function getOwner(ctx: Ctx, handle: string): Owner {
  const row = ctx.db.prepare("SELECT * FROM owners WHERE handle = ?").get(handle) as Owner | undefined;
  if (!row) throw notFound(`@${handle}`);
  return row;
}

export function createUser(ctx: Ctx, input: { handle: string; email: string; password: string; name?: string; bio?: string }): User {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) throw badRequest("Usernames use lowercase letters, numbers and single dashes.");
  if (RESERVED_HANDLES.has(handle)) throw conflict("handle_taken", `@${handle} is reserved.`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw badRequest("Enter a valid email address.");
  if (input.password.length < 12) throw badRequest("Passwords need at least 12 characters.");
  if (ctx.db.prepare("SELECT 1 FROM owners WHERE handle = ?").get(handle)) throw conflict("handle_taken", `@${handle} is taken.`);
  if (ctx.db.prepare("SELECT 1 FROM users WHERE email = ?").get(input.email)) throw conflict("email_taken", "An account with this email already exists.");
  const { lastInsertRowid } = ctx.db
    .prepare("INSERT INTO owners (handle, kind, name, bio) VALUES (?, 'user', ?, ?)")
    .run(handle, input.name ?? handle, input.bio ?? "");
  ctx.db.prepare("INSERT INTO users (owner_id, email, password_hash) VALUES (?, ?, ?)").run(lastInsertRowid, input.email, hashPassword(input.password));
  return getUserById(ctx, Number(lastInsertRowid));
}

/** Stored in place of a password hash for an account that has only ever signed in with Google. Never verifies. */
const NO_PASSWORD = "oauth$";

/** Whether this account has a password it can sign in with (a Google-only account does not until it sets one). */
export function hasPassword(ctx: Ctx, userId: number): boolean {
  const row = ctx.db.prepare("SELECT password_hash FROM users WHERE owner_id = ?").get(userId) as { password_hash: string } | undefined;
  return Boolean(row && row.password_hash.startsWith("scrypt$"));
}

/**
 * An account made from a Google sign-in. The address was confirmed by Google, so it counts as verified, and there is no
 * password until the person asks for one ("Forgot password" sets it by email).
 */
export function createOAuthUser(ctx: Ctx, input: { handle: string; email: string; name?: string }): User {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) throw badRequest("Usernames use lowercase letters, numbers and single dashes.");
  if (RESERVED_HANDLES.has(handle)) throw conflict("handle_taken", `@${handle} is reserved.`);
  if (ctx.db.prepare("SELECT 1 FROM owners WHERE handle = ?").get(handle)) throw conflict("handle_taken", `@${handle} is taken.`);
  if (ctx.db.prepare("SELECT 1 FROM users WHERE lower(email) = lower(?)").get(input.email)) throw conflict("email_taken", "An account with this email already exists.");
  const { lastInsertRowid } = ctx.db.prepare("INSERT INTO owners (handle, kind, name, bio) VALUES (?, 'user', ?, '')").run(handle, (input.name ?? "").trim().slice(0, 80) || handle);
  ctx.db
    .prepare("INSERT INTO users (owner_id, email, password_hash, email_verified_at) VALUES (?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))")
    .run(lastInsertRowid, input.email, NO_PASSWORD);
  return getUserById(ctx, Number(lastInsertRowid));
}

export function createOrg(ctx: Ctx, input: { handle: string; name?: string; bio?: string }, creatorId: number): Owner {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) throw badRequest("Organization names use lowercase letters, numbers and single dashes.");
  if (RESERVED_HANDLES.has(handle)) throw conflict("handle_taken", `@${handle} is reserved.`);
  if (ctx.db.prepare("SELECT 1 FROM owners WHERE handle = ?").get(handle)) throw conflict("handle_taken", `@${handle} is taken.`);
  const { lastInsertRowid } = ctx.db.prepare("INSERT INTO owners (handle, kind, name, bio) VALUES (?, 'org', ?, ?)").run(handle, input.name ?? handle, input.bio ?? "");
  ctx.db.prepare("INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, 'Owner')").run(lastInsertRowid, creatorId);
  return getOwner(ctx, handle);
}

export function addMember(ctx: Ctx, orgId: number, userId: number, role: Role) {
  ctx.db.prepare("INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role").run(orgId, userId, role);
}

export function getUserById(ctx: Ctx, id: number): User {
  const row = ctx.db.prepare("SELECT o.*, u.email, u.plan, u.role, u.onboarded_at, u.email_verified_at, u.totp_enabled_at FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.id = ?").get(id) as User | undefined;
  if (!row) throw notFound("User");
  return row;
}

/** The user id for a correct username/email and password; the same error whether the account exists or not. */
export function checkPassword(ctx: Ctx, loginName: string, password: string): number {
  const row = ctx.db
    .prepare("SELECT o.id, u.password_hash FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.handle = ? OR u.email = ?")
    .get(loginName.toLowerCase(), loginName) as { id: number; password_hash: string } | undefined;
  // Same error for unknown user and wrong password, so logins don't reveal which accounts exist.
  if (!row || !verifyPassword(password, row.password_hash)) throw new ApiError(401, "invalid_credentials", "Wrong username or password.");
  return row.id;
}

/** The id of the account a sign-in name or email belongs to, or null. Only for filing a failed attempt under that account. */
export function findUserId(ctx: Ctx, loginName: string): number | null {
  const row = ctx.db.prepare("SELECT o.id FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.handle = ? OR u.email = ?").get(loginName.toLowerCase(), loginName) as { id: number } | undefined;
  return row?.id ?? null;
}

export function startSession(ctx: Ctx, userId: number) {
  return issueToken(ctx, userId, { kind: "session", note: "web session", expiresInDays: 30 });
}

export function login(ctx: Ctx, loginName: string, password: string) {
  return startSession(ctx, checkPassword(ctx, loginName, password));
}

export function issueToken(
  ctx: Ctx,
  userId: number,
  opts: { kind: "session" | "pat"; note: string; scopes?: string[]; expiresInDays?: number | null; repos?: string[] | null; client?: { userAgent?: string | null; ip?: string | null } },
) {
  const token = makeToken(opts.kind === "pat" ? "pat" : "ses");
  const expires = opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86_400_000).toISOString() : null;
  const { lastInsertRowid } = ctx.db
    .prepare("INSERT INTO tokens (user_id, token_hash, kind, note, scopes, expires_at, user_agent, ip, repos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(userId, tokenHash(token), opts.kind, opts.note, (opts.scopes ?? ["repo"]).join(","), expires, opts.client?.userAgent?.slice(0, 300) ?? null, opts.client?.ip?.slice(0, 64) ?? null, opts.repos?.length ? JSON.stringify(opts.repos.map((r) => r.toLowerCase())) : null);
  return { token, id: Number(lastInsertRowid), expiresAt: expires };
}

/** Resolve a bearer token to its user, or null. Updates last-used time. */
export type AuthedUser = User & { scopes: string[]; tokenKind: "session" | "pat"; tokenId: number; /** "owner/name" this token is limited to, or null for every repository the person can reach. */ repos: string[] | null };
export function authenticate(ctx: Ctx, token: string | undefined | null): AuthedUser | null {
  if (!token) return null;
  const row = ctx.db.prepare("SELECT id, user_id, scopes, expires_at, kind, repos FROM tokens WHERE token_hash = ?").get(tokenHash(token)) as
    | { id: number; user_id: number; scopes: string; expires_at: string | null; kind: "session" | "pat"; repos: string | null }
    | undefined;
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
  ctx.db.prepare("UPDATE tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  return { ...getUserById(ctx, row.user_id), scopes: row.scopes.split(","), tokenKind: row.kind, tokenId: row.id, repos: row.repos ? (JSON.parse(row.repos) as string[]) : null };
}

/** Whether `token` is a working credential right now, without counting as a use of it. Used by the secret scan. */
export function liveToken(ctx: Ctx, token: string): { id: number; kind: "session" | "pat" } | null {
  const row = ctx.db.prepare("SELECT id, kind, expires_at FROM tokens WHERE token_hash = ?").get(tokenHash(token)) as { id: number; kind: "session" | "pat"; expires_at: string | null } | undefined;
  if (!row || (row.expires_at && row.expires_at < new Date().toISOString())) return null;
  return { id: row.id, kind: row.kind };
}

/** Remove one credential by id, whoever it belongs to (for a token found exposed in a public repository). */
export function revokeExposedToken(ctx: Ctx, id: number): number {
  return Number(ctx.db.prepare("DELETE FROM tokens WHERE id = ?").run(id).changes);
}

/** A user's personal access tokens; `current` marks the one making this request. */
export function listTokens(ctx: Ctx, userId: number, requestToken?: string | null) {
  const current = requestToken ? tokenHash(requestToken) : null;
  const rows = ctx.db
    .prepare("SELECT id, note, scopes, kind, created_at, expires_at, last_used_at, token_hash, repos FROM tokens WHERE user_id = ? AND kind = 'pat' ORDER BY id DESC")
    .all(userId) as { id: number; note: string; scopes: string; kind: string; created_at: string; expires_at: string | null; last_used_at: string | null; token_hash: string; repos: string | null }[];
  return rows.map(({ token_hash, repos, ...row }) => ({ ...row, repos: repos ? (JSON.parse(repos) as string[]) : null, current: token_hash === current }));
}

export function revokeToken(ctx: Ctx, userId: number, id: number) {
  const res = ctx.db.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ?").run(id, userId);
  if (res.changes === 0) throw notFound("Token");
}

export function orgRole(ctx: Ctx, orgId: number, userId: number): Role | null {
  const row = ctx.db.prepare("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?").get(orgId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

export function listMembers(ctx: Ctx, orgId: number) {
  return ctx.db
    .prepare("SELECT o.handle, o.name, m.role FROM memberships m JOIN owners o ON o.id = m.user_id WHERE m.org_id = ? ORDER BY o.handle")
    .all(orgId) as { handle: string; name: string; role: Role }[];
}

export type Access = "none" | "read" | "write" | "admin";
type RepoAccessRow = { id: number; owner_id: number; visibility: string };

/** What `userId` may do with a repository. */
export function repoAccess(ctx: Ctx, repo: RepoAccessRow, userId: number | null): Access {
  if (userId !== null) {
    if (repo.owner_id === userId) return "admin";
    const role = orgRole(ctx, repo.owner_id, userId);
    if (role === "Owner") return "admin";
    if (role === "Maintainer" || role === "Member") return "write";
    const collab = ctx.db.prepare("SELECT role FROM collaborators WHERE repo_id = ? AND user_id = ?").get(repo.id, userId) as { role: string } | undefined;
    if (collab?.role === "Admin") return "admin";
    if (collab?.role === "Write") return "write";
    if (collab) return "read";
  }
  return repo.visibility === "public" ? "read" : "none";
}

const rank: Record<Access, number> = { none: 0, read: 1, write: 2, admin: 3 };

export function requireAccess(ctx: Ctx, repo: RepoAccessRow, userId: number | null, needed: Exclude<Access, "none">) {
  const access = repoAccess(ctx, repo, userId);
  // Private repositories you can't see are reported as missing, not forbidden, so they can't be probed.
  if (access === "none") throw notFound("Repository");
  if (rank[access] < rank[needed]) throw userId === null ? new ApiError(401, "unauthenticated", "Sign in to do this.") : forbidden();
  return access;
}

// ── Organization membership ────────────────────────────────────────────────
// Owners and Maintainers add people; only Owners change roles or remove members.
// An organization always keeps at least one Owner.

const ROLES: Role[] = ["Owner", "Maintainer", "Member"];

function orgFor(ctx: Ctx, handle: string, actorId: number, needed: "Maintainer" | "Owner") {
  const org = getOwner(ctx, handle);
  if (org.kind !== "org") throw notFound(`Organization ${handle}`);
  const role = orgRole(ctx, org.id, actorId);
  if (!role) throw notFound(`Organization ${handle}`);
  if (needed === "Owner" ? role !== "Owner" : role === "Member") throw forbidden(`Only ${needed === "Owner" ? "owners" : "owners and maintainers"} of ${handle} can do this.`);
  return org;
}

function ownerCount(ctx: Ctx, orgId: number) {
  return (ctx.db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'Owner'").get(orgId) as { n: number }).n;
}

function checkRole(role: string): Role {
  if (!ROLES.includes(role as Role)) throw badRequest("Role must be Owner, Maintainer or Member.");
  return role as Role;
}

export function inviteMember(ctx: Ctx, orgHandle: string, actorId: number, input: { handle: string; role?: string }) {
  const role = checkRole(input.role ?? "Member");
  const org = orgFor(ctx, orgHandle, actorId, role === "Owner" ? "Owner" : "Maintainer");
  const person = getOwner(ctx, (input.handle ?? "").replace(/^@/, ""));
  if (person.kind !== "user") throw badRequest(`${person.handle} is an organization, not a person.`);
  if (orgRole(ctx, org.id, person.id)) throw conflict("already_member", `${person.handle} is already a member of ${org.handle}.`);
  addMember(ctx, org.id, person.id, role);
  return listMembers(ctx, org.id);
}

export function setMemberRole(ctx: Ctx, orgHandle: string, actorId: number, handle: string, role: string) {
  const next = checkRole(role);
  const org = orgFor(ctx, orgHandle, actorId, "Owner");
  const person = getOwner(ctx, handle);
  const current = orgRole(ctx, org.id, person.id);
  if (!current) throw notFound(`${handle} in ${org.handle}`);
  if (current === "Owner" && next !== "Owner" && ownerCount(ctx, org.id) === 1) throw conflict("last_owner", `${org.handle} needs at least one owner. Make someone else an owner first.`);
  addMember(ctx, org.id, person.id, next);
  return listMembers(ctx, org.id);
}

export function removeMember(ctx: Ctx, orgHandle: string, actorId: number, handle: string) {
  const org = orgFor(ctx, orgHandle, actorId, "Owner");
  const person = getOwner(ctx, handle);
  const current = orgRole(ctx, org.id, person.id);
  if (!current) throw notFound(`${handle} in ${org.handle}`);
  if (current === "Owner" && ownerCount(ctx, org.id) === 1) throw conflict("last_owner", `${org.handle} needs at least one owner.`);
  ctx.db.prepare("DELETE FROM memberships WHERE org_id = ? AND user_id = ?").run(org.id, person.id);
  return listMembers(ctx, org.id);
}

/** Rename or re-describe an organization (owners only). */
export function updateOrg(ctx: Ctx, orgHandle: string, actorId: number, patch: { name?: string; bio?: string }) {
  const org = orgFor(ctx, orgHandle, actorId, "Owner");
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) throw badRequest("The name needs 1 to 80 characters.");
    ctx.db.prepare("UPDATE owners SET name = ? WHERE id = ?").run(name, org.id);
  }
  if (patch.bio !== undefined) {
    if (patch.bio.length > 280) throw badRequest("The description is at most 280 characters.");
    ctx.db.prepare("UPDATE owners SET bio = ? WHERE id = ?").run(patch.bio.trim(), org.id);
  }
  return getOwner(ctx, org.handle);
}

/**
 * Delete an organization (owners only, confirmed by typing its handle). Refused while it still
 * has repositories, so deleting the organization never silently deletes data: delete or move
 * those first.
 */
export function deleteOrg(ctx: Ctx, orgHandle: string, actorId: number, confirm: string) {
  const org = orgFor(ctx, orgHandle, actorId, "Owner");
  if ((confirm ?? "").toLowerCase() !== org.handle.toLowerCase()) throw badRequest(`Type ${org.handle} to confirm.`);
  const repos = (ctx.db.prepare("SELECT COUNT(*) AS n FROM repos WHERE owner_id = ?").get(org.id) as { n: number }).n;
  if (repos) throw conflict("has_repositories", `${org.handle} still has ${repos} ${repos === 1 ? "repository" : "repositories"}. Delete ${repos === 1 ? "it" : "them"} first.`);
  ctx.db.prepare("DELETE FROM owners WHERE id = ?").run(org.id); // memberships cascade
}

// ── Profile, sessions and password reset ───────────────────────────────────

export const PROFILE_ROLES = ["modeler", "gis", "utility", "research", "other"];

export function updateProfile(ctx: Ctx, userId: number, patch: { name?: string; bio?: string; role?: string | null; onboarded?: boolean }) {
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) throw badRequest("Enter a name up to 80 characters.");
    ctx.db.prepare("UPDATE owners SET name = ? WHERE id = ?").run(name, userId);
  }
  if (patch.bio !== undefined) {
    if (patch.bio.length > 280) throw badRequest("Keep the bio under 280 characters.");
    ctx.db.prepare("UPDATE owners SET bio = ? WHERE id = ?").run(patch.bio.trim(), userId);
  }
  if (patch.role !== undefined) {
    if (patch.role !== null && !PROFILE_ROLES.includes(patch.role)) throw badRequest(`Role must be one of ${PROFILE_ROLES.join(", ")}.`);
    ctx.db.prepare("UPDATE users SET role = ? WHERE owner_id = ?").run(patch.role, userId);
  }
  if (patch.onboarded) ctx.db.prepare("UPDATE users SET onboarded_at = COALESCE(onboarded_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE owner_id = ?").run(userId);
  return getUserById(ctx, userId);
}

/** Sign out: the session token stops working immediately. */
export function revokeSession(ctx: Ctx, token: string) {
  ctx.db.prepare("DELETE FROM tokens WHERE token_hash = ? AND kind = 'session'").run(tokenHash(token));
}

/**
 * Start a password reset. Returns the one-time token for the caller to deliver (email in
 * production; the server log in development), or null when no account matches. Callers must
 * answer the same way either way, so the endpoint doesn't reveal which accounts exist.
 */
export function requestPasswordReset(ctx: Ctx, loginName: string) {
  const row = ctx.db
    .prepare("SELECT o.id, o.handle, u.email FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.handle = ? OR u.email = ?")
    .get(loginName.trim().toLowerCase(), loginName.trim()) as { id: number; handle: string; email: string } | undefined;
  if (!row) return null;
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  ctx.db.prepare("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)").run(row.id, tokenHash(token), expires);
  return { token, handle: row.handle, email: row.email };
}

/** Finish a reset: sets the password, burns the link, and signs out every session. */
export function resetPassword(ctx: Ctx, token: string, password: string) {
  if ((password ?? "").length < 12) throw badRequest("Passwords need at least 12 characters.");
  const row = ctx.db.prepare("SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?").get(tokenHash(token ?? "")) as
    | { id: number; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) throw badRequest("This reset link has expired or was already used. Request a new one.");
  ctx.db.prepare("UPDATE users SET password_hash = ? WHERE owner_id = ?").run(hashPassword(password), row.user_id);
  ctx.db.prepare("UPDATE password_resets SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
  ctx.db.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'session'").run(row.user_id);
  return getUserById(ctx, row.user_id);
}

// ── Email verification ─────────────────────────────────────────────────────

/** A one-time link that confirms the address. Valid for 24 hours. */
export function createVerifyToken(ctx: Ctx, userId: number) {
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  ctx.db.prepare("INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'verify', ?, ?)").run(userId, tokenHash(token), expires);
  return token;
}

export function verifyEmail(ctx: Ctx, token: string) {
  const row = ctx.db.prepare("SELECT id, user_id, expires_at, used_at FROM email_tokens WHERE token_hash = ? AND purpose = 'verify'").get(tokenHash(token ?? "")) as
    | { id: number; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.expires_at < new Date().toISOString()) throw badRequest("This confirmation link has expired. Send a new one from your settings.");
  if (!row.used_at) {
    ctx.db.prepare("UPDATE email_tokens SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(row.id);
    ctx.db.prepare("UPDATE users SET email_verified_at = COALESCE(email_verified_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE owner_id = ?").run(row.user_id);
  }
  return getUserById(ctx, row.user_id);
}

/** Publishing and inviting need a confirmed address, so nobody can spam from a throwaway signup. */
export function requireVerified(user: User, action: string) {
  if (!user.email_verified_at) throw new ApiError(403, "email_unverified", `Confirm your email address to ${action}. Check your inbox, or send a new link from Settings.`);
}

// ── Sessions and password ──────────────────────────────────────────────────

export function listSessions(ctx: Ctx, userId: number, currentTokenId: number | null) {
  const rows = ctx.db
    .prepare(
      "SELECT id, created_at, last_used_at, expires_at, user_agent, ip FROM tokens WHERE user_id = ? AND kind = 'session' AND (expires_at IS NULL OR expires_at > ?) ORDER BY COALESCE(last_used_at, created_at) DESC",
    )
    .all(userId, new Date().toISOString()) as { id: number; created_at: string; last_used_at: string | null; expires_at: string | null; user_agent: string | null; ip: string | null }[];
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at, userAgent: r.user_agent, ip: r.ip, current: r.id === currentTokenId }));
}

export function revokeSessionById(ctx: Ctx, userId: number, id: number) {
  const r = ctx.db.prepare("DELETE FROM tokens WHERE id = ? AND user_id = ? AND kind = 'session'").run(id, userId);
  if (!r.changes) throw notFound("Session");
}

/** Change password (needs the current one); signs out every other session. */
export function changePassword(ctx: Ctx, userId: number, currentTokenId: number, current: string, next: string) {
  const row = ctx.db.prepare("SELECT password_hash FROM users WHERE owner_id = ?").get(userId) as { password_hash: string };
  if (row.password_hash === NO_PASSWORD) {
    throw new ApiError(409, "no_password", "This account signs in with Google and has no password yet. Use “Forgot password” on the sign-in page to add one by email.");
  }
  if (!verifyPassword(current ?? "", row.password_hash)) throw new ApiError(403, "wrong_password", "Your current password isn’t right.");
  if ((next ?? "").length < 12) throw badRequest("Passwords need at least 12 characters.");
  ctx.db.prepare("UPDATE users SET password_hash = ? WHERE owner_id = ?").run(hashPassword(next), userId);
  ctx.db.prepare("DELETE FROM tokens WHERE user_id = ? AND kind = 'session' AND id <> ?").run(userId, currentTokenId);
}

// ── Export and deletion (GDPR Art. 20 and 17) ──────────────────────────────

/** Everything Craton holds about a person, as JSON. Repository files are fetched with `craton clone`. */
export function exportAccount(ctx: Ctx, userId: number) {
  const u = getUserById(ctx, userId);
  const all = (sql: string) => ctx.db.prepare(sql).all(userId);
  return {
    exportedAt: new Date().toISOString(),
    profile: { handle: u.handle, name: u.name, bio: u.bio, email: u.email, emailVerifiedAt: u.email_verified_at, plan: u.plan, role: u.role, createdAt: u.created_at },
    organizations: all("SELECT o.handle, m.role FROM memberships m JOIN owners o ON o.id = m.org_id WHERE m.user_id = ?"),
    repositories: all("SELECT r.name, r.description, r.visibility, r.default_branch AS defaultBranch, r.created_at AS createdAt FROM repos r WHERE r.owner_id = ?"),
    stars: all("SELECT o.handle || '/' || r.name AS repository, s.created_at AS starredAt FROM stars s JOIN repos r ON r.id = s.repo_id JOIN owners o ON o.id = r.owner_id WHERE s.user_id = ?"),
    issues: all("SELECT r.name AS repo, i.number, i.title, i.body, i.state, i.created_at AS createdAt FROM issues i JOIN repos r ON r.id = i.repo_id WHERE i.author_id = ?"),
    pullRequests: all("SELECT r.name AS repo, p.number, p.title, p.body, p.state, p.created_at AS createdAt FROM pulls p JOIN repos r ON r.id = p.repo_id WHERE p.author_id = ?"),
    comments: all("SELECT r.name AS repo, c.target, c.number, c.body, c.created_at AS createdAt FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.author_id = ?"),
    reviews: all("SELECT r.name AS repo, v.number, v.state, v.body, v.created_at AS createdAt FROM reviews v JOIN repos r ON r.id = v.repo_id WHERE v.author_id = ?"),
    tokens: all("SELECT note, kind, scopes, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt FROM tokens WHERE user_id = ?"),
    note: "Repository contents are not in this file. Download them with `craton clone owner/repo`.",
  };
}

/**
 * Delete an account. Its own repositories are deleted; what it wrote in other people's
 * repositories (issues, comments, reviews, releases) is kept and shown as @ghost, like GitHub, so
 * conversations stay readable. Commit history keeps the handle as text: history is append-only.
 */
export function deleteAccount(ctx: Ctx, userId: number, confirm: { handle: string; password: string }) {
  const u = getUserById(ctx, userId);
  if (confirm.handle !== u.handle) throw badRequest(`Type your username (${u.handle}) to confirm.`);
  const row = ctx.db.prepare("SELECT password_hash FROM users WHERE owner_id = ?").get(userId) as { password_hash: string };
  // An account with no password (Google only) is confirmed by typing its username, which was checked above.
  if (row.password_hash !== NO_PASSWORD && !verifyPassword(confirm.password ?? "", row.password_hash)) throw new ApiError(403, "wrong_password", "Your password isn’t right.");
  const soleOwner = ctx.db
    .prepare(
      "SELECT o.handle FROM memberships m JOIN owners o ON o.id = m.org_id WHERE m.user_id = ? AND m.role = 'Owner' AND (SELECT COUNT(*) FROM memberships x WHERE x.org_id = m.org_id AND x.role = 'Owner') = 1",
    )
    .all(userId) as { handle: string }[];
  if (soleOwner.length) {
    throw conflict("sole_owner", `You’re the only owner of ${soleOwner.map((o) => o.handle).join(", ")}. Make someone else an owner, or delete the organization, first.`, { orgs: soleOwner.map((o) => o.handle) });
  }

  let ghost = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'ghost'").get() as { id: number } | undefined;
  if (!ghost) {
    const { lastInsertRowid } = ctx.db.prepare("INSERT INTO owners (handle, kind, name, bio) VALUES ('ghost', 'user', 'Deleted user', 'This account was deleted.')").run();
    ghost = { id: Number(lastInsertRowid) };
  }
  ctx.db.exec("BEGIN");
  try {
    for (const t of ["issues", "pulls", "comments", "reviews", "releases"]) ctx.db.prepare(`UPDATE ${t} SET author_id = ? WHERE author_id = ?`).run(ghost.id, userId);
    ctx.db.prepare("UPDATE issues SET assignee_id = NULL WHERE assignee_id = ?").run(userId);
    const starred = ctx.db.prepare("SELECT repo_id FROM stars WHERE user_id = ?").all(userId) as { repo_id: number }[];
    ctx.db.prepare("DELETE FROM repos WHERE owner_id = ?").run(userId);
    ctx.db.prepare("DELETE FROM owners WHERE id = ?").run(userId);
    for (const s of starred) ctx.db.prepare("UPDATE repos SET stars = (SELECT COUNT(*) FROM stars WHERE repo_id = ?) WHERE id = ?").run(s.repo_id, s.repo_id);
    ctx.db.exec("COMMIT");
  } catch (err) {
    ctx.db.exec("ROLLBACK");
    throw err;
  }
}
