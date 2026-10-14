// File locks, for files that can't be merged (file geodatabases, HEC-RAS binaries, project
// files). The model is Git LFS's and GitLab's: one holder per path; only the holder can release
// it (a repository admin can force); and the lock is enforced when a branch moves, so a push or a
// merge that changes a path someone else holds is refused with who holds it.

import type { Ctx } from "./context.ts";
import { ApiError, badRequest, conflict, forbidden, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { config } from "../config.ts";
import { matchesAny } from "../core/globs.ts";

export type Lock = { path: string; reason: string; holder: string; lockedAt: string; /** Whole days held. */ ageDays: number; /** Held longer than config.locks.staleAfterDays. */ stale: boolean };

type Row = { path: string; reason: string; holder: string; created_at: string };
const toLock = (r: Row): Lock => {
  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(r.created_at).getTime()) / 86_400_000));
  return { path: r.path, reason: r.reason, holder: r.holder, lockedAt: r.created_at, ageDays, stale: ageDays >= config.locks.staleAfterDays };
};

const SELECT = "SELECT l.path, l.reason, l.created_at, o.handle AS holder FROM file_locks l JOIN owners o ON o.id = l.user_id";

export function cleanPath(input: unknown): string {
  const path = String(input ?? "").trim().replaceAll("\\", "/").replace(/^\/+/, "");
  if (!path || path.length > 1024 || path.split("/").some((part) => part === ".." || part === "." || part === "")) {
    throw badRequest("Give the path of a file in the repository, like terrain/basin_dem.tif.");
  }
  return path;
}

export function listLocks(ctx: Ctx, repo: RepoRow): Lock[] {
  return (ctx.db.prepare(`${SELECT} WHERE l.repo_id = ? ORDER BY l.path`).all(repo.id) as Row[]).map(toLock);
}

export function lockPath(ctx: Ctx, repo: RepoRow, userId: number, path: string, reason: string): Lock {
  const clean = cleanPath(path);
  const why = String(reason ?? "").trim().slice(0, 200);
  const held = ctx.db.prepare(`${SELECT} WHERE l.repo_id = ? AND l.path = ?`).get(repo.id, clean) as Row | undefined;
  if (held) {
    const mine = (ctx.db.prepare("SELECT 1 FROM file_locks WHERE repo_id = ? AND path = ? AND user_id = ?").get(repo.id, clean, userId)) !== undefined;
    if (!mine) throw conflict("locked", `${clean} is already locked by @${held.holder}.`, { path: clean, holder: held.holder });
    return toLock(held); // locking what you already hold is a no-op, so a retry is safe
  }
  ctx.db.prepare("INSERT INTO file_locks (repo_id, path, user_id, reason) VALUES (?, ?, ?, ?)").run(repo.id, clean, userId, why);
  return toLock(ctx.db.prepare(`${SELECT} WHERE l.repo_id = ? AND l.path = ?`).get(repo.id, clean) as Row);
}

/** Release a lock. Only the holder may, unless `force` (the route requires admin access for that). */
export function unlockPath(ctx: Ctx, repo: RepoRow, userId: number, path: string, force: boolean) {
  const clean = cleanPath(path);
  const held = ctx.db.prepare("SELECT user_id FROM file_locks WHERE repo_id = ? AND path = ?").get(repo.id, clean) as { user_id: number } | undefined;
  if (!held) throw notFound(`A lock on ${clean}`);
  if (held.user_id !== userId && !force) {
    const holder = (ctx.db.prepare("SELECT handle FROM owners WHERE id = ?").get(held.user_id) as { handle: string }).handle;
    throw forbidden(`Only @${holder} can release this lock. A repository admin can force it.`);
  }
  ctx.db.prepare("DELETE FROM file_locks WHERE repo_id = ? AND path = ?").run(repo.id, clean);
}

/**
 * For paths that match the repository's lock patterns, the person changing them must hold the lock. This is
 * for direct changes (a push or an upload); a merge carries changes someone already made under their own lock.
 */
export function assertLockedWhenRequired(ctx: Ctx, repo: RepoRow, actor: string, changed: string[]) {
  const patterns = JSON.parse(repo.lock_patterns ?? "[]") as string[];
  if (!patterns.length || !changed.length) return;
  const mine = new Set(listLocks(ctx, repo).filter((l) => l.holder === actor).map((l) => l.path));
  const missing = changed.filter((p) => matchesAny(patterns, p) && !mine.has(p));
  if (!missing.length) return;
  const shown = missing.slice(0, 5).join(", ") + (missing.length > 5 ? ` and ${missing.length - 5} more` : "");
  throw new ApiError(409, "lock_required", `${missing.length === 1 ? "This file has" : "These files have"} to be locked before ${missing.length === 1 ? "it is" : "they are"} changed: ${shown}. Lock ${missing.length === 1 ? "it" : "them"} first (craton lock <path>), push, then unlock.`, { paths: missing });
}

/**
 * Refuse a branch update that changes a path locked by someone other than `actor`. `changed` is
 * the paths the update adds, modifies or removes.
 */
export function assertNotLockedByOthers(ctx: Ctx, repo: RepoRow, actor: string, changed: string[]) {
  if (!changed.length) return;
  const blocked = listLocks(ctx, repo).filter((l) => l.holder !== actor && changed.includes(l.path));
  if (!blocked.length) return;
  const list = blocked.map((l) => `${l.path} (@${l.holder})`).join(", ");
  throw new ApiError(409, "locked", `${blocked.length === 1 ? "A file in this push is" : `${blocked.length} files in this push are`} locked by someone else: ${list}. Ask them to release the lock, or drop the change.`, {
    locks: blocked,
  });
}
