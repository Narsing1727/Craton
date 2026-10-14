// People invited to a single repository, outside the owner's organization: the way to share a
// private repository with one colleague. Roles: Read, Write (push, merge, manage issues) and
// Admin (settings and collaborators). Only a repository admin changes the list. Access is
// immediate, like an organization invite; the person is told by email.

import type { Ctx } from "./context.ts";
import { badRequest, conflict, notFound } from "./context.ts";
import { getOwner } from "./accounts.ts";
import type { RepoRow } from "./repos.ts";

export const ROLES = ["Read", "Write", "Admin"] as const;
export type CollaboratorRole = (typeof ROLES)[number];

export type Collaborator = { handle: string; name: string; role: CollaboratorRole };

function cleanRole(input: unknown): CollaboratorRole {
  const role = ROLES.find((r) => r.toLowerCase() === String(input ?? "Read").toLowerCase());
  if (!role) throw badRequest(`Role must be one of ${ROLES.join(", ")}.`);
  return role;
}

export function listCollaborators(ctx: Ctx, repo: RepoRow): Collaborator[] {
  return ctx.db
    .prepare("SELECT o.handle, o.name, c.role FROM collaborators c JOIN owners o ON o.id = c.user_id WHERE c.repo_id = ? AND c.role IN ('Read','Write','Admin') ORDER BY o.handle")
    .all(repo.id) as Collaborator[];
}

function person(ctx: Ctx, repo: RepoRow, handle: unknown) {
  const owner = getOwner(ctx, String(handle ?? "").replace(/^@/, "").trim().toLowerCase());
  if (owner.kind !== "user") throw badRequest(`${owner.handle} is an organization, not a person. Add its members to the organization instead.`);
  if (owner.id === repo.owner_id) throw badRequest(`${owner.handle} owns this repository already.`);
  return owner;
}

/** Add someone, or change their role. Returns the list and whether they were new. */
export function setCollaborator(ctx: Ctx, repo: RepoRow, input: { handle: string; role?: string }, mustBeNew = false) {
  const role = cleanRole(input.role);
  const who = person(ctx, repo, input.handle);
  const existing = ctx.db.prepare("SELECT role FROM collaborators WHERE repo_id = ? AND user_id = ?").get(repo.id, who.id) as { role: string } | undefined;
  if (existing && mustBeNew) throw conflict("already_collaborator", `${who.handle} already has access to this repository.`);
  ctx.db.prepare("INSERT INTO collaborators (repo_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT (repo_id, user_id) DO UPDATE SET role = excluded.role").run(repo.id, who.id, role);
  return { collaborators: listCollaborators(ctx, repo), added: !existing, handle: who.handle, role };
}

export function removeCollaborator(ctx: Ctx, repo: RepoRow, handle: string) {
  const who = getOwner(ctx, handle.replace(/^@/, "").trim().toLowerCase());
  const info = ctx.db.prepare("DELETE FROM collaborators WHERE repo_id = ? AND user_id = ?").run(repo.id, who.id);
  if (!info.changes) throw notFound(`${who.handle} among this repository's collaborators`);
  // Their locks would otherwise stay held by someone who can no longer release them.
  ctx.db.prepare("DELETE FROM file_locks WHERE repo_id = ? AND user_id = ?").run(repo.id, who.id);
  return listCollaborators(ctx, repo);
}

/** Leaving is always allowed: you can drop your own access to a repository someone shared with you. */
export function leave(ctx: Ctx, repo: RepoRow, userId: number) {
  const info = ctx.db.prepare("DELETE FROM collaborators WHERE repo_id = ? AND user_id = ?").run(repo.id, userId);
  if (!info.changes) throw badRequest("You aren't a collaborator on this repository.");
  ctx.db.prepare("DELETE FROM file_locks WHERE repo_id = ? AND user_id = ?").run(repo.id, userId);
}

/** Repositories other people shared with this person, with the role they were given. */
export function sharedWith(ctx: Ctx, userId: number): { owner: string; name: string; role: CollaboratorRole }[] {
  return ctx.db
    .prepare(
      `SELECT o.handle AS owner, r.name, c.role FROM collaborators c
       JOIN repos r ON r.id = c.repo_id JOIN owners o ON o.id = r.owner_id
       WHERE c.user_id = ? AND c.role IN ('Read','Write','Admin') ORDER BY r.updated_at DESC`,
    )
    .all(userId) as { owner: string; name: string; role: CollaboratorRole }[];
}
