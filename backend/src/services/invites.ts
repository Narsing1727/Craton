// Invite someone to a repository by email address, before they have an account. The invitation is a
// one-time link (only its hash is stored) that lasts 14 days. Accepting needs a signed-in account whose
// verified address is the one invited, so a forwarded link can't be used by someone else.

import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { ROLES, setCollaborator, type CollaboratorRole } from "./collaborators.ts";

const DAYS = 14;
const MAX_PENDING = 20;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export type Invite = { id: number; email: string; role: CollaboratorRole; invitedBy: string; createdAt: string; expiresAt: string };

/** "a***@example.org": enough for the right person to recognise, not enough to harvest. */
export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

function cleanRole(input: unknown): CollaboratorRole {
  const role = ROLES.find((r) => r.toLowerCase() === String(input ?? "Read").toLowerCase());
  if (!role) throw badRequest(`Role must be one of ${ROLES.join(", ")}.`);
  return role;
}

/** The account that already uses this address (verified or not), if any. */
export function accountWithEmail(ctx: Ctx, email: string): { id: number; handle: string } | null {
  return (ctx.db.prepare("SELECT o.id, o.handle FROM users u JOIN owners o ON o.id = u.owner_id WHERE u.email = ? COLLATE NOCASE").get(email) as { id: number; handle: string } | undefined) ?? null;
}

export function createInvite(ctx: Ctx, repo: RepoRow, inviterId: number, input: { email?: unknown; role?: unknown }) {
  const email = String(input.email ?? "").trim();
  if (!EMAIL.test(email)) throw badRequest("Enter a valid email address.");
  const role = cleanRole(input.role);
  const pending = (ctx.db.prepare("SELECT COUNT(*) AS n FROM repo_invites WHERE repo_id = ? AND accepted_at IS NULL AND expires_at > ?").get(repo.id, new Date().toISOString()) as { n: number }).n;
  const replacing = ctx.db.prepare("SELECT 1 FROM repo_invites WHERE repo_id = ? AND email = ? COLLATE NOCASE").get(repo.id, email);
  if (!replacing && pending >= MAX_PENDING) throw badRequest(`Up to ${MAX_PENDING} invitations can be waiting at once. Revoke one first.`);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + DAYS * 86_400_000).toISOString();
  // One live invitation per address: sending again replaces the earlier link.
  ctx.db.prepare("DELETE FROM repo_invites WHERE repo_id = ? AND email = ? COLLATE NOCASE").run(repo.id, email);
  const { lastInsertRowid } = ctx.db
    .prepare("INSERT INTO repo_invites (repo_id, email, role, token_hash, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(repo.id, email, role, hashOf(token), inviterId, expiresAt);
  return { id: Number(lastInsertRowid), token, email, role, expiresAt };
}

export function listInvites(ctx: Ctx, repo: RepoRow): Invite[] {
  const rows = ctx.db
    .prepare("SELECT i.id, i.email, i.role, o.handle AS invitedBy, i.created_at AS createdAt, i.expires_at AS expiresAt FROM repo_invites i JOIN owners o ON o.id = i.invited_by WHERE i.repo_id = ? AND i.accepted_at IS NULL ORDER BY i.id DESC")
    .all(repo.id) as Invite[];
  return rows;
}

export function revokeInvite(ctx: Ctx, repo: RepoRow, id: number) {
  const r = ctx.db.prepare("DELETE FROM repo_invites WHERE id = ? AND repo_id = ? AND accepted_at IS NULL").run(id, repo.id);
  if (r.changes === 0) throw notFound("Invitation");
}

type Row = { id: number; repo_id: number; email: string; role: CollaboratorRole; expires_at: string; accepted_at: string | null; owner: string; name: string; inviter: string };
function byToken(ctx: Ctx, token: unknown): Row {
  const row = ctx.db
    .prepare(
      `SELECT i.id, i.repo_id, i.email, i.role, i.expires_at, i.accepted_at, o.handle AS owner, r.name, inv.handle AS inviter
       FROM repo_invites i JOIN repos r ON r.id = i.repo_id JOIN owners o ON o.id = r.owner_id JOIN owners inv ON inv.id = i.invited_by
       WHERE i.token_hash = ?`,
    )
    .get(hashOf(String(token ?? ""))) as Row | undefined;
  if (!row || row.accepted_at || row.expires_at < new Date().toISOString()) throw new ApiError(400, "invite_invalid", "This invitation has expired, was already used, or was withdrawn. Ask for a new one.");
  return row;
}

/** What an invitation is for, shown before anyone signs in. */
export function previewInvite(ctx: Ctx, token: unknown) {
  const r = byToken(ctx, token);
  return { repo: `${r.owner}/${r.name}`, role: r.role, invitedBy: r.inviter, emailHint: maskEmail(r.email), expiresAt: r.expires_at, hasAccount: accountWithEmail(ctx, r.email) !== null };
}

/** Join the repository. The signed-in account must have confirmed the address the invitation was sent to. */
export function acceptInvite(ctx: Ctx, token: unknown, user: { id: number; email: string; email_verified_at: string | null }) {
  const r = byToken(ctx, token);
  if (user.email.toLowerCase() !== r.email.toLowerCase()) {
    throw new ApiError(403, "invite_email_mismatch", `This invitation was sent to ${maskEmail(r.email)}. Sign in with an account that uses that address.`);
  }
  if (!user.email_verified_at) throw new ApiError(403, "email_unverified", "Confirm your email address first (the link we sent you), then open the invitation again.");
  const repo = ctx.db.prepare("SELECT r.*, o.handle AS owner FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.id = ?").get(r.repo_id) as RepoRow;
  const me = (ctx.db.prepare("SELECT handle FROM owners WHERE id = ?").get(user.id) as { handle: string }).handle;
  // Never lower the access of someone who already has more (owner, or a collaborator with a higher role).
  if (repo.owner_id !== user.id) {
    const existing = ctx.db.prepare("SELECT role FROM collaborators WHERE repo_id = ? AND user_id = ?").get(repo.id, user.id) as { role: CollaboratorRole } | undefined;
    if (!existing || ROLES.indexOf(existing.role) < ROLES.indexOf(r.role)) setCollaborator(ctx, repo, { handle: me, role: r.role });
  }
  ctx.db.prepare("UPDATE repo_invites SET accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(r.id);
  return { repo: `${r.owner}/${r.name}`, role: r.role };
}
