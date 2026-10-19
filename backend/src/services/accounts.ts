// Users, organizations, tokens and permission checks.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./context.ts";
import { makeToken } from "../core/tokens.ts";
import { mergeNotify } from "./notify.ts";

export type Owner = { id: number; handle: string; kind: "user" | "org"; name: string; bio: string; website: string; location: string; company: string; pronouns: string; created_at: string };
export type User = Owner & { email: string; plan: string; role: string | null; onboarded_at: string | null; email_verified_at: string | null; totp_enabled_at: string | null; digest: "off" | "weekly"; notify: string; default_visibility: "public" | "private" };
export type Role = "Owner" | "Maintainer" | "Member";

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

/**
 * Names nobody can register: every top-level page of the web app (a person called "dashboard" would have a profile
 * nobody could open, since the page wins), plus names that would be taken for the service or its staff. "ghost" is
 * the account deleted people's conversations are kept under. A test keeps this in step with the web app's folders.
 */
export const RESERVED_HANDLES = new Set([
  // pages and routes of the web app
  "about", "api", "api-reference", "auth", "changelog", "cli", "compare", "contact", "dashboard", "dev", "digest", "avatar", "docs", "explore", "features", "forgot-password", "formats", "glossary", "guides", "help", "invite",
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

export async function getOwner(ctx: Ctx, handle: string): Promise<Owner> {
  const row = await ctx.db.get("SELECT * FROM owners WHERE handle = ?", handle) as Owner | undefined;
  if (!row) throw notFound(`@${handle}`);
  return row;
}

export async function createUser(ctx: Ctx, input: { handle: string; email: string; password: string; name?: string; bio?: string }): Promise<User> {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) throw badRequest("Usernames use lowercase letters, numbers and single dashes.");
  if (RESERVED_HANDLES.has(handle)) throw conflict("handle_taken", `@${handle} is reserved.`);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) throw badRequest("Enter a valid email address.");
  if (input.password.length < 12) throw badRequest("Passwords need at least 12 characters.");
  if (await ctx.db.get("SELECT 1 FROM owners WHERE handle = ?", handle)) throw conflict("handle_taken", `@${handle} is taken.`);
  if (await ctx.db.get("SELECT 1 FROM users WHERE email = ?", input.email)) throw conflict("email_taken", "An account with this email already exists.");
  const lastInsertRowid = await ctx.db.insert("INSERT INTO owners (handle, kind, name, bio) VALUES (?, 'user', ?, ?)", handle, input.name ?? handle, input.bio ?? "");
  await ctx.db.run("INSERT INTO users (owner_id, email, password_hash) VALUES (?, ?, ?)", lastInsertRowid, input.email, hashPassword(input.password));
  return getUserById(ctx, Number(lastInsertRowid));
}

/** Stored in place of a password hash for an account that has only ever signed in with Google. Never verifies. */
const NO_PASSWORD = "oauth$";

/** Whether this account has a password it can sign in with (a Google-only account does not until it sets one). */
export async function hasPassword(ctx: Ctx, userId: number): Promise<boolean> {
  const row = await ctx.db.get("SELECT password_hash FROM users WHERE owner_id = ?", userId) as { password_hash: string } | undefined;
  return Boolean(row && row.password_hash.startsWith("scrypt$"));
}

/**
 * An account made from a Google sign-in. The address was confirmed by Google, so it counts as verified, and there is no
 * password until the person asks for one ("Forgot password" sets it by email).
 */
export async function createOAuthUser(ctx: Ctx, input: { handle: string; email: string; name?: string }): Promise<User> {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) throw badRequest("Usernames use lowercase letters, numbers and single dashes.");
  if (RESERVED_HANDLES.has(handle)) throw conflict("handle_taken", `@${handle} is reserved.`);
  if (await ctx.db.get("SELECT 1 FROM owners WHERE handle = ?", handle)) throw conflict("handle_taken", `@${handle} is taken.`);
  if (await ctx.db.get("SELECT 1 FROM users WHERE lower(email) = lower(?)", input.email)) throw conflict("email_taken", "An account with this email already exists.");
  const lastInsertRowid = await ctx.db.insert("INSERT INTO owners (handle, kind, name, bio) VALUES (?, 'user', ?, '')", handle, (input.name ?? "").trim().slice(0, 80) || handle);
  await ctx.db.run("INSERT INTO users (owner_id, email, password_hash, email_verified_at) VALUES (?, ?, ?, now_iso())", lastInsertRowid, input.email, NO_PASSWORD);
  return getUserById(ctx, Number(lastInsertRowid));
}

export async function createOrg(ctx: Ctx, input: { handle: string; name?: string; bio?: string }, creatorId: number): Promise<Owner> {
  const handle = input.handle.trim().toLowerCase();
  if (!HANDLE.test(handle)) throw badRequest("Organization names use lowercase letters, numbers and single dashes.");
  if (RESERVED_HANDLES.has(handle)) throw conflict("handle_taken", `@${handle} is reserved.`);
  if (await ctx.db.get("SELECT 1 FROM owners WHERE handle = ?", handle)) throw conflict("handle_taken", `@${handle} is taken.`);
  const lastInsertRowid = await ctx.db.insert("INSERT INTO owners (handle, kind, name, bio) VALUES (?, 'org', ?, ?)", handle, input.name ?? handle, input.bio ?? "");
  await ctx.db.run("INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, 'Owner')", lastInsertRowid, creatorId);
  return getOwner(ctx, handle);
}

export async function addMember(ctx: Ctx, orgId: number, userId: number, role: Role) {
  await ctx.db.run("INSERT INTO memberships (org_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (org_id, user_id) DO UPDATE SET role = excluded.role", orgId, userId, role);
}

export async function getUserById(ctx: Ctx, id: number): Promise<User> {
  const row = await ctx.db.get("SELECT o.*, u.email, u.plan, u.role, u.onboarded_at, u.email_verified_at, u.totp_enabled_at, u.digest, u.notify, u.default_visibility FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.id = ?", id) as User | undefined;
  if (!row) throw notFound("User");
  return row;
}

/** The user id for a correct username/email and password; the same error whether the account exists or not. */
export async function checkPassword(ctx: Ctx, loginName: string, password: string): Promise<number> {
  const row = await ctx.db.get("SELECT o.id, u.password_hash FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.handle = ? OR u.email = ?", loginName.toLowerCase(), loginName) as { id: number; password_hash: string } | undefined;
  // Same error for unknown user and wrong password, so logins don't reveal which accounts exist.
  if (!row || !verifyPassword(password, row.password_hash)) throw new ApiError(401, "invalid_credentials", "Wrong username or password.");
  return row.id;
}

/** The id of the account a sign-in name or email belongs to, or null. Only for filing a failed attempt under that account. */
export async function findUserId(ctx: Ctx, loginName: string): Promise<number | null> {
  const row = await ctx.db.get("SELECT o.id FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.handle = ? OR u.email = ?", loginName.toLowerCase(), loginName) as { id: number } | undefined;
  return row?.id ?? null;
}

export function startSession(ctx: Ctx, userId: number) {
  return issueToken(ctx, userId, { kind: "session", note: "web session", expiresInDays: 30 });
}

export async function login(ctx: Ctx, loginName: string, password: string) {
  return startSession(ctx, await checkPassword(ctx, loginName, password));
}

export async function issueToken(
  ctx: Ctx,
  userId: number,
  opts: { kind: "session" | "pat"; note: string; scopes?: string[]; expiresInDays?: number | null; repos?: string[] | null; client?: { userAgent?: string | null; ip?: string | null } },
) {
  const token = makeToken(opts.kind === "pat" ? "pat" : "ses");
  const expires = opts.expiresInDays ? new Date(Date.now() + opts.expiresInDays * 86_400_000).toISOString() : null;
  const lastInsertRowid = await ctx.db.insert("INSERT INTO tokens (user_id, token_hash, kind, note, scopes, expires_at, user_agent, ip, repos) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", userId, tokenHash(token), opts.kind, opts.note, (opts.scopes ?? ["repo"]).join(","), expires, opts.client?.userAgent?.slice(0, 300) ?? null, opts.client?.ip?.slice(0, 64) ?? null, opts.repos?.length ? JSON.stringify(opts.repos.map((r) => r.toLowerCase())) : null);
  return { token, id: Number(lastInsertRowid), expiresAt: expires };
}

/** Resolve a bearer token to its user, or null. Updates last-used time. */
export type AuthedUser = User & { scopes: string[]; tokenKind: "session" | "pat"; tokenId: number; /** "owner/name" this token is limited to, or null for every repository the person can reach. */ repos: string[] | null };
export async function authenticate(ctx: Ctx, token: string | undefined | null): Promise<AuthedUser | null> {
  if (!token) return null;
  const row = await ctx.db.get("SELECT id, user_id, scopes, expires_at, kind, repos FROM tokens WHERE token_hash = ?", tokenHash(token)) as
    | { id: number; user_id: number; scopes: string; expires_at: string | null; kind: "session" | "pat"; repos: string | null }
    | undefined;
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null;
  // The "last used" stamp is for people to read, so a minute's accuracy is plenty; writing it on every request is a write per request.
  await ctx.db.run("UPDATE tokens SET last_used_at = now_iso() WHERE id = ? AND (last_used_at IS NULL OR last_used_at < ?)", row.id, new Date(Date.now() - 60_000).toISOString());
  return { ...await getUserById(ctx, row.user_id), scopes: row.scopes.split(","), tokenKind: row.kind, tokenId: row.id, repos: row.repos ? (JSON.parse(row.repos) as string[]) : null };
}

/** Whether `token` is a working credential right now, without counting as a use of it. Used by the secret scan. */
export async function liveToken(ctx: Ctx, token: string): Promise<{ id: number; kind: "session" | "pat" } | null> {
  const row = await ctx.db.get("SELECT id, kind, expires_at FROM tokens WHERE token_hash = ?", tokenHash(token)) as { id: number; kind: "session" | "pat"; expires_at: string | null } | undefined;
  if (!row || (row.expires_at && row.expires_at < new Date().toISOString())) return null;
  return { id: row.id, kind: row.kind };
}

/** Remove one credential by id, whoever it belongs to (for a token found exposed in a public repository). */
export async function revokeExposedToken(ctx: Ctx, id: number): Promise<number> {
  return Number((await ctx.db.run("DELETE FROM tokens WHERE id = ?", id)).changes);
}

/** A user's personal access tokens; `current` marks the one making this request. */
export async function listTokens(ctx: Ctx, userId: number, requestToken?: string | null) {
  const current = requestToken ? tokenHash(requestToken) : null;
  const rows = await ctx.db.all("SELECT id, note, scopes, kind, created_at, expires_at, last_used_at, token_hash, repos FROM tokens WHERE user_id = ? AND kind = 'pat' ORDER BY id DESC", userId) as { id: number; note: string; scopes: string; kind: string; created_at: string; expires_at: string | null; last_used_at: string | null; token_hash: string; repos: string | null }[];
  return rows.map(({ token_hash, repos, ...row }) => ({ ...row, repos: repos ? (JSON.parse(repos) as string[]) : null, current: token_hash === current }));
}

export async function revokeToken(ctx: Ctx, userId: number, id: number) {
  const res = await ctx.db.run("DELETE FROM tokens WHERE id = ? AND user_id = ?", id, userId);
  if (res.changes === 0) throw notFound("Token");
}

export async function orgRole(ctx: Ctx, orgId: number, userId: number): Promise<Role | null> {
  const row = await ctx.db.get("SELECT role FROM memberships WHERE org_id = ? AND user_id = ?", orgId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

export async function listMembers(ctx: Ctx, orgId: number) {
  return await ctx.db.all("SELECT o.handle, o.name, m.role FROM memberships m JOIN owners o ON o.id = m.user_id WHERE m.org_id = ? ORDER BY o.handle", orgId) as { handle: string; name: string; role: Role }[];
}

export type Access = "none" | "read" | "write" | "admin";
type RepoAccessRow = { id: number; owner_id: number; visibility: string };

/** What `userId` may do with a repository. */
export async function repoAccess(ctx: Ctx, repo: RepoAccessRow, userId: number | null): Promise<Access> {
  if (userId !== null) {
    if (repo.owner_id === userId) return "admin";
    const role = await orgRole(ctx, repo.owner_id, userId);
    if (role === "Owner") return "admin";
    if (role === "Maintainer" || role === "Member") return "write";
    const collab = await ctx.db.get("SELECT role FROM collaborators WHERE repo_id = ? AND user_id = ?", repo.id, userId) as { role: string } | undefined;
    if (collab?.role === "Admin") return "admin";
    if (collab?.role === "Write") return "write";
    if (collab) return "read";
  }
  return repo.visibility === "public" ? "read" : "none";
}

const rank: Record<Access, number> = { none: 0, read: 1, write: 2, admin: 3 };

export async function requireAccess(ctx: Ctx, repo: RepoAccessRow, userId: number | null, needed: Exclude<Access, "none">) {
  const access = await repoAccess(ctx, repo, userId);
  // Private repositories you can't see are reported as missing, not forbidden, so they can't be probed.
  if (access === "none") throw notFound("Repository");
  if (rank[access] < rank[needed]) throw userId === null ? new ApiError(401, "unauthenticated", "Sign in to do this.") : forbidden();
  return access;
}

// ── Organization membership ────────────────────────────────────────────────
// Owners and Maintainers add people; only Owners change roles or remove members.
// An organization always keeps at least one Owner.

const ROLES: Role[] = ["Owner", "Maintainer", "Member"];

async function orgFor(ctx: Ctx, handle: string, actorId: number, needed: "Maintainer" | "Owner") {
  const org = await getOwner(ctx, handle);
  if (org.kind !== "org") throw notFound(`Organization ${handle}`);
  const role = await orgRole(ctx, org.id, actorId);
  if (!role) throw notFound(`Organization ${handle}`);
  if (needed === "Owner" ? role !== "Owner" : role === "Member") throw forbidden(`Only ${needed === "Owner" ? "owners" : "owners and maintainers"} of ${handle} can do this.`);
  return org;
}

async function ownerCount(ctx: Ctx, orgId: number) {
  return (await ctx.db.get("SELECT COUNT(*) AS n FROM memberships WHERE org_id = ? AND role = 'Owner'", orgId) as { n: number }).n;
}

function checkRole(role: string): Role {
  if (!ROLES.includes(role as Role)) throw badRequest("Role must be Owner, Maintainer or Member.");
  return role as Role;
}

export async function inviteMember(ctx: Ctx, orgHandle: string, actorId: number, input: { handle: string; role?: string }) {
  const role = checkRole(input.role ?? "Member");
  const org = await orgFor(ctx, orgHandle, actorId, role === "Owner" ? "Owner" : "Maintainer");
  const person = await getOwner(ctx, (input.handle ?? "").replace(/^@/, ""));
  if (person.kind !== "user") throw badRequest(`${person.handle} is an organization, not a person.`);
  if (await orgRole(ctx, org.id, person.id)) throw conflict("already_member", `${person.handle} is already a member of ${org.handle}.`);
  await addMember(ctx, org.id, person.id, role);
  return listMembers(ctx, org.id);
}

export async function setMemberRole(ctx: Ctx, orgHandle: string, actorId: number, handle: string, role: string) {
  const next = checkRole(role);
  const org = await orgFor(ctx, orgHandle, actorId, "Owner");
  const person = await getOwner(ctx, handle);
  const current = await orgRole(ctx, org.id, person.id);
  if (!current) throw notFound(`${handle} in ${org.handle}`);
  if (current === "Owner" && next !== "Owner" && await ownerCount(ctx, org.id) === 1) throw conflict("last_owner", `${org.handle} needs at least one owner. Make someone else an owner first.`);
  await addMember(ctx, org.id, person.id, next);
  return listMembers(ctx, org.id);
}

export async function removeMember(ctx: Ctx, orgHandle: string, actorId: number, handle: string) {
  const org = await orgFor(ctx, orgHandle, actorId, "Owner");
  const person = await getOwner(ctx, handle);
  const current = await orgRole(ctx, org.id, person.id);
  if (!current) throw notFound(`${handle} in ${org.handle}`);
  if (current === "Owner" && await ownerCount(ctx, org.id) === 1) throw conflict("last_owner", `${org.handle} needs at least one owner.`);
  await ctx.db.run("DELETE FROM memberships WHERE org_id = ? AND user_id = ?", org.id, person.id);
  return listMembers(ctx, org.id);
}

/** Rename or re-describe an organization (owners only). */
export async function updateOrg(ctx: Ctx, orgHandle: string, actorId: number, patch: { name?: string; bio?: string }) {
  const org = await orgFor(ctx, orgHandle, actorId, "Owner");
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) throw badRequest("The name needs 1 to 80 characters.");
    await ctx.db.run("UPDATE owners SET name = ? WHERE id = ?", name, org.id);
  }
  if (patch.bio !== undefined) {
    if (patch.bio.length > 280) throw badRequest("The description is at most 280 characters.");
    await ctx.db.run("UPDATE owners SET bio = ? WHERE id = ?", patch.bio.trim(), org.id);
  }
  return getOwner(ctx, org.handle);
}

/**
 * Delete an organization (owners only, confirmed by typing its handle). Refused while it still
 * has repositories, so deleting the organization never silently deletes data: delete or move
 * those first.
 */
export async function deleteOrg(ctx: Ctx, orgHandle: string, actorId: number, confirm: string) {
  const org = await orgFor(ctx, orgHandle, actorId, "Owner");
  if ((confirm ?? "").toLowerCase() !== org.handle.toLowerCase()) throw badRequest(`Type ${org.handle} to confirm.`);
  const repos = (await ctx.db.get("SELECT COUNT(*) AS n FROM repos WHERE owner_id = ?", org.id) as { n: number }).n;
  if (repos) throw conflict("has_repositories", `${org.handle} still has ${repos} ${repos === 1 ? "repository" : "repositories"}. Delete ${repos === 1 ? "it" : "them"} first.`);
  await ctx.db.run("DELETE FROM owners WHERE id = ?", org.id); // memberships cascade
}

// ── Profile, sessions and password reset ───────────────────────────────────

export const PROFILE_ROLES = ["modeler", "gis", "utility", "research", "other"];

export async function updateProfile(ctx: Ctx, userId: number, patch: { name?: string; bio?: string; role?: string | null; onboarded?: boolean; digest?: string; notify?: unknown; defaultVisibility?: string; website?: string; location?: string; company?: string; pronouns?: string }) {
  for (const [field, max] of [["location", 80], ["company", 80], ["pronouns", 40]] as const) {
    const value = patch[field];
    if (value === undefined) continue;
    const text = String(value).trim();
    if (text.length > max) throw badRequest(`Keep ${field} under ${max} characters.`);
    if (/[\u0000-\u001f\u007f]/.test(text)) throw badRequest(`${field} cannot contain control characters.`);
    await ctx.db.run(`UPDATE owners SET ${field} = ? WHERE id = ?`, text, userId);
  }
  if (patch.website !== undefined) await ctx.db.run("UPDATE owners SET website = ? WHERE id = ?", cleanWebsite(patch.website), userId);
  if (patch.notify !== undefined) {
    const current = await ctx.db.get("SELECT notify FROM users WHERE owner_id = ?", userId) as { notify: string };
    await ctx.db.run("UPDATE users SET notify = ? WHERE owner_id = ?", mergeNotify(current.notify, patch.notify), userId);
  }
  if (patch.defaultVisibility !== undefined) {
    if (patch.defaultVisibility !== "public" && patch.defaultVisibility !== "private") throw badRequest("defaultVisibility is public or private.");
    await ctx.db.run("UPDATE users SET default_visibility = ? WHERE owner_id = ?", patch.defaultVisibility, userId);
  }
  if (patch.digest !== undefined) {
    if (patch.digest !== "off" && patch.digest !== "weekly") throw badRequest("digest is off or weekly.");
    await ctx.db.run("UPDATE users SET digest = ?, digest_sent_at = CASE WHEN ? = 'weekly' THEN now_iso() ELSE digest_sent_at END WHERE owner_id = ?", patch.digest, patch.digest, userId);
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim();
    if (!name || name.length > 80) throw badRequest("Enter a name up to 80 characters.");
    await ctx.db.run("UPDATE owners SET name = ? WHERE id = ?", name, userId);
  }
  if (patch.bio !== undefined) {
    if (patch.bio.length > 280) throw badRequest("Keep the bio under 280 characters.");
    await ctx.db.run("UPDATE owners SET bio = ? WHERE id = ?", patch.bio.trim(), userId);
  }
  if (patch.role !== undefined) {
    if (patch.role !== null && !PROFILE_ROLES.includes(patch.role)) throw badRequest(`Role must be one of ${PROFILE_ROLES.join(", ")}.`);
    await ctx.db.run("UPDATE users SET role = ? WHERE owner_id = ?", patch.role, userId);
  }
  if (patch.onboarded) await ctx.db.run("UPDATE users SET onboarded_at = COALESCE(onboarded_at, now_iso()) WHERE owner_id = ?", userId);
  return getUserById(ctx, userId);
}

/** A website for a profile: empty, or an http(s) address (a bare domain gets https). Anything else is refused. */
export function cleanWebsite(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (!text) return "";
  if (text.length > 200) throw badRequest("Keep the website under 200 characters.");
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    throw badRequest("Enter a web address such as https://example.org.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw badRequest("The website must start with http:// or https://.");
  if (url.username || url.password || !url.hostname.includes(".")) throw badRequest("Enter a web address such as https://example.org.");
  return url.toString().replace(/\/$/, "");
}

export const AVATAR_MAX_BYTES = 512 * 1024;

/** The kind of image these bytes are, by what they start with (never by what the client said); SVG and anything that can carry script is not accepted. */
export function sniffImage(data: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (data.length > 12 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length > 12 && data.subarray(0, 4).toString("latin1") === "RIFF" && data.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function setAvatar(ctx: Ctx, userId: number, data: Buffer) {
  if (data.length === 0) throw badRequest("Send the image as the request body.");
  if (data.length > AVATAR_MAX_BYTES) throw badRequest(`A profile picture is at most ${AVATAR_MAX_BYTES / 1024} KB. The web app shrinks it for you.`);
  const type = sniffImage(data);
  if (!type) throw badRequest("Use a PNG, JPEG or WebP image.");
  await ctx.db.run("INSERT INTO avatars (owner_id, type, data) VALUES (?, ?, ?) ON CONFLICT (owner_id) DO UPDATE SET type = excluded.type, data = excluded.data, updated_at = now_iso()", userId, type, data);
}

export async function removeAvatar(ctx: Ctx, userId: number) {
  await ctx.db.run("DELETE FROM avatars WHERE owner_id = ?", userId);
}

export async function getAvatar(ctx: Ctx, handle: string): Promise<{ type: string; data: Buffer; updatedAt: string } | null> {
  const row = await ctx.db.get("SELECT a.type, a.data, a.updated_at FROM avatars a JOIN owners o ON o.id = a.owner_id WHERE o.handle = ?", handle) as { type: string; data: Uint8Array; updated_at: string } | undefined;
  return row ? { type: row.type, data: Buffer.from(row.data), updatedAt: row.updated_at } : null;
}

export const hasAvatar = async (ctx: Ctx, ownerId: number) => Boolean(await ctx.db.get("SELECT 1 FROM avatars WHERE owner_id = ?", ownerId));

/** Sign out: the session token stops working immediately. */
export async function revokeSession(ctx: Ctx, token: string) {
  await ctx.db.run("DELETE FROM tokens WHERE token_hash = ? AND kind = 'session'", tokenHash(token));
}

/**
 * Start a password reset. Returns the one-time token for the caller to deliver (email in
 * production; the server log in development), or null when no account matches. Callers must
 * answer the same way either way, so the endpoint doesn't reveal which accounts exist.
 */
export async function requestPasswordReset(ctx: Ctx, loginName: string) {
  const row = await ctx.db.get("SELECT o.id, o.handle, u.email FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.handle = ? OR u.email = ?", loginName.trim().toLowerCase(), loginName.trim()) as { id: number; handle: string; email: string } | undefined;
  if (!row) return null;
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await ctx.db.run("INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES (?, ?, ?)", row.id, tokenHash(token), expires);
  return { token, handle: row.handle, email: row.email };
}

/** Finish a reset: sets the password, burns the link, and signs out every session. */
export async function resetPassword(ctx: Ctx, token: string, password: string) {
  if ((password ?? "").length < 12) throw badRequest("Passwords need at least 12 characters.");
  const row = await ctx.db.get("SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?", tokenHash(token ?? "")) as
    | { id: number; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) throw badRequest("This reset link has expired or was already used. Request a new one.");
  await ctx.db.run("UPDATE users SET password_hash = ? WHERE owner_id = ?", hashPassword(password), row.user_id);
  await ctx.db.run("UPDATE password_resets SET used_at = now_iso() WHERE id = ?", row.id);
  await ctx.db.run("DELETE FROM tokens WHERE user_id = ? AND kind = 'session'", row.user_id);
  return getUserById(ctx, row.user_id);
}

// ── Email verification ─────────────────────────────────────────────────────

/** A one-time link that confirms the address. Valid for 24 hours. */
export async function createVerifyToken(ctx: Ctx, userId: number) {
  const token = randomBytes(24).toString("base64url");
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  await ctx.db.run("INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (?, 'verify', ?, ?)", userId, tokenHash(token), expires);
  return token;
}

export async function verifyEmail(ctx: Ctx, token: string) {
  const row = await ctx.db.get("SELECT id, user_id, expires_at, used_at FROM email_tokens WHERE token_hash = ? AND purpose = 'verify'", tokenHash(token ?? "")) as
    | { id: number; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.expires_at < new Date().toISOString()) throw badRequest("This confirmation link has expired. Send a new one from your settings.");
  if (!row.used_at) {
    await ctx.db.run("UPDATE email_tokens SET used_at = now_iso() WHERE id = ?", row.id);
    await ctx.db.run("UPDATE users SET email_verified_at = COALESCE(email_verified_at, now_iso()) WHERE owner_id = ?", row.user_id);
  }
  return getUserById(ctx, row.user_id);
}

/** Publishing and inviting need a confirmed address, so nobody can spam from a throwaway signup. */
export function requireVerified(user: User, action: string) {
  if (!user.email_verified_at) throw new ApiError(403, "email_unverified", `Confirm your email address to ${action}. Check your inbox, or send a new link from Settings.`);
}

// ── Sessions and password ──────────────────────────────────────────────────

export async function listSessions(ctx: Ctx, userId: number, currentTokenId: number | null) {
  const rows = await ctx.db.all("SELECT id, created_at, last_used_at, expires_at, user_agent, ip FROM tokens WHERE user_id = ? AND kind = 'session' AND (expires_at IS NULL OR expires_at > ?) ORDER BY COALESCE(last_used_at, created_at) DESC", userId, new Date().toISOString()) as { id: number; created_at: string; last_used_at: string | null; expires_at: string | null; user_agent: string | null; ip: string | null }[];
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, lastUsedAt: r.last_used_at, expiresAt: r.expires_at, userAgent: r.user_agent, ip: r.ip, current: r.id === currentTokenId }));
}

export async function revokeSessionById(ctx: Ctx, userId: number, id: number) {
  const r = await ctx.db.run("DELETE FROM tokens WHERE id = ? AND user_id = ? AND kind = 'session'", id, userId);
  if (!r.changes) throw notFound("Session");
}

/** Change password (needs the current one); signs out every other session. */
export async function changePassword(ctx: Ctx, userId: number, currentTokenId: number, current: string, next: string) {
  const row = await ctx.db.get("SELECT password_hash FROM users WHERE owner_id = ?", userId) as { password_hash: string };
  if (row.password_hash === NO_PASSWORD) {
    throw new ApiError(409, "no_password", "This account signs in with Google and has no password yet. Use “Forgot password” on the sign-in page to add one by email.");
  }
  if (!verifyPassword(current ?? "", row.password_hash)) throw new ApiError(403, "wrong_password", "Your current password isn’t right.");
  if ((next ?? "").length < 12) throw badRequest("Passwords need at least 12 characters.");
  await ctx.db.run("UPDATE users SET password_hash = ? WHERE owner_id = ?", hashPassword(next), userId);
  await ctx.db.run("DELETE FROM tokens WHERE user_id = ? AND kind = 'session' AND id <> ?", userId, currentTokenId);
}

// ── Export and deletion (GDPR Art. 20 and 17) ──────────────────────────────

/** Everything Craton holds about a person, as JSON. Repository files are fetched with `craton clone`. */
export async function exportAccount(ctx: Ctx, userId: number) {
  const u = await getUserById(ctx, userId);
  const all = async (sql: string) => await ctx.db.all(sql, userId);
  return {
    exportedAt: new Date().toISOString(),
    profile: { handle: u.handle, name: u.name, bio: u.bio, email: u.email, emailVerifiedAt: u.email_verified_at, plan: u.plan, role: u.role, createdAt: u.created_at },
    organizations: await all("SELECT o.handle, m.role FROM memberships m JOIN owners o ON o.id = m.org_id WHERE m.user_id = ?"),
    repositories: await all("SELECT r.name, r.description, r.visibility, r.default_branch AS defaultBranch, r.created_at AS createdAt FROM repos r WHERE r.owner_id = ?"),
    stars: await all("SELECT o.handle || '/' || r.name AS repository, s.created_at AS starredAt FROM stars s JOIN repos r ON r.id = s.repo_id JOIN owners o ON o.id = r.owner_id WHERE s.user_id = ?"),
    issues: await all("SELECT r.name AS repo, i.number, i.title, i.body, i.state, i.created_at AS createdAt FROM issues i JOIN repos r ON r.id = i.repo_id WHERE i.author_id = ?"),
    pullRequests: await all("SELECT r.name AS repo, p.number, p.title, p.body, p.state, p.created_at AS createdAt FROM pulls p JOIN repos r ON r.id = p.repo_id WHERE p.author_id = ?"),
    comments: await all("SELECT r.name AS repo, c.target, c.number, c.body, c.created_at AS createdAt FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.author_id = ?"),
    reviews: await all("SELECT r.name AS repo, v.number, v.state, v.body, v.created_at AS createdAt FROM reviews v JOIN repos r ON r.id = v.repo_id WHERE v.author_id = ?"),
    tokens: await all("SELECT note, kind, scopes, created_at AS createdAt, last_used_at AS lastUsedAt, expires_at AS expiresAt FROM tokens WHERE user_id = ?"),
    note: "Repository contents are not in this file. Download them with `craton clone owner/repo`.",
  };
}

/**
 * Delete an account. Its own repositories are deleted; what it wrote in other people's
 * repositories (issues, comments, reviews, releases) is kept and shown as @ghost, like GitHub, so
 * conversations stay readable. Commit history keeps the handle as text: history is append-only.
 */
export async function deleteAccount(ctx: Ctx, userId: number, confirm: { handle: string; password: string }) {
  const u = await getUserById(ctx, userId);
  if (confirm.handle !== u.handle) throw badRequest(`Type your username (${u.handle}) to confirm.`);
  const row = await ctx.db.get("SELECT password_hash FROM users WHERE owner_id = ?", userId) as { password_hash: string };
  // An account with no password (Google only) is confirmed by typing its username, which was checked above.
  if (row.password_hash !== NO_PASSWORD && !verifyPassword(confirm.password ?? "", row.password_hash)) throw new ApiError(403, "wrong_password", "Your password isn’t right.");
  const soleOwner = await ctx.db.all("SELECT o.handle FROM memberships m JOIN owners o ON o.id = m.org_id WHERE m.user_id = ? AND m.role = 'Owner' AND (SELECT COUNT(*) FROM memberships x WHERE x.org_id = m.org_id AND x.role = 'Owner') = 1", userId) as { handle: string }[];
  if (soleOwner.length) {
    throw conflict("sole_owner", `You’re the only owner of ${soleOwner.map((o) => o.handle).join(", ")}. Make someone else an owner, or delete the organization, first.`, { orgs: soleOwner.map((o) => o.handle) });
  }

  let ghost = await ctx.db.get("SELECT id FROM owners WHERE handle = 'ghost'") as { id: number } | undefined;
  if (!ghost) {
    const lastInsertRowid = await ctx.db.insert("INSERT INTO owners (handle, kind, name, bio) VALUES ('ghost', 'user', 'Deleted user', 'This account was deleted.')");
    ghost = { id: Number(lastInsertRowid) };
  }
  await ctx.db.tx(async (db) => {
    for (const t of ["issues", "pulls", "comments", "reviews", "releases"]) await db.run(`UPDATE ${t} SET author_id = ? WHERE author_id = ?`, ghost!.id, userId);
    await db.run("UPDATE issues SET assignee_id = NULL WHERE assignee_id = ?", userId);
    const starred = await db.all("SELECT repo_id FROM stars WHERE user_id = ?", userId) as { repo_id: number }[];
    await db.run("DELETE FROM repos WHERE owner_id = ?", userId);
    await db.run("DELETE FROM owners WHERE id = ?", userId);
    for (const s of starred) await db.run("UPDATE repos SET stars = (SELECT COUNT(*) FROM stars WHERE repo_id = ?) WHERE id = ?", s.repo_id, s.repo_id);
  });
}
