// Repositories: create, read, list, update, delete.

import type { Ctx } from "./context.ts";
import { cleanPatterns } from "../core/globs.ts";
import { badRequest, conflict, notFound } from "./context.ts";
import { getOwner, orgRole, requireAccess, repoAccess } from "./accounts.ts";
import { cleanTopics, invalidTopic, licenseIds } from "./licenses.ts";
import { bboxContains, bboxIntersects, type BBox } from "../core/geo.ts";

export type RepoRow = {
  id: number;
  owner_id: number;
  owner: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  default_branch: string;
  region: string;
  crs: string;
  nodata: number | null;
  vertical_datum: number | null;
  require_checks: number;
  require_review: number;
  stars: number;
  forks: number;
  tags: string;
  footprint: string | null;
  license: string;
  topics: string;
  lock_patterns: string;
  require_owner_review: number;
  require_cog: number;
  size_bytes: number;
  created_at: string;
  updated_at: string;
};

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const SELECT = "SELECT r.*, o.handle AS owner FROM repos r JOIN owners o ON o.id = r.owner_id";

/** Chunk scope for bytes pushed to this repository (DECISIONS.md #3). */
export const repoScope = (repo: Pick<RepoRow, "visibility" | "owner_id">) => (repo.visibility === "public" ? "public" : `owner:${repo.owner_id}`);

export function findRepo(ctx: Ctx, owner: string, name: string): RepoRow {
  const row = ctx.db.prepare(`${SELECT} WHERE o.handle = ? AND r.name = ?`).get(owner, name) as RepoRow | undefined;
  if (!row) throw notFound("Repository");
  return row;
}

export function getRepoFor(ctx: Ctx, owner: string, name: string, userId: number | null, needed: "read" | "write" | "admin" = "read") {
  const repo = findRepo(ctx, owner, name);
  requireAccess(ctx, repo, userId, needed);
  return repo;
}

export function createRepo(
  ctx: Ctx,
  userId: number,
  input: { owner?: string; name: string; description?: string; visibility?: "public" | "private"; crs?: string; region?: string; nodata?: number | null; verticalDatum?: number | null },
): RepoRow {
  const owner = input.owner ? getOwner(ctx, input.owner) : getOwner(ctx, (ctx.db.prepare("SELECT handle FROM owners WHERE id = ?").get(userId) as { handle: string }).handle);
  if (owner.kind === "user" && owner.id !== userId) throw badRequest("You can only create repositories for yourself or an organization you belong to.");
  if (owner.kind === "org") {
    const role = orgRole(ctx, owner.id, userId);
    if (!role || role === "Member") throw badRequest(`Only owners and maintainers of ${owner.handle} can create repositories.`);
  }
  const name = input.name.trim().toLowerCase();
  if (!NAME.test(name)) throw badRequest("Use lowercase letters, numbers, dots, dashes or underscores.");
  if (ctx.db.prepare("SELECT 1 FROM repos WHERE owner_id = ? AND name = ?").get(owner.id, name)) throw conflict("repo_exists", `${owner.handle}/${name} already exists.`);
  if (input.crs && !/^EPSG:\d{4,6}$/.test(input.crs)) throw badRequest("CRS must look like EPSG:32643.");
  ctx.db
    .prepare("INSERT INTO repos (owner_id, name, description, visibility, crs, region, nodata, vertical_datum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(owner.id, name, input.description ?? "", input.visibility ?? "public", input.crs ?? "EPSG:32643", input.region ?? "", input.nodata ?? null, input.verticalDatum ?? null);
  return findRepo(ctx, owner.handle, name);
}

export function listRepos(ctx: Ctx, userId: number | null, filter: { owner?: string; q?: string; topic?: string; covers?: { lat: number; lon: number }; bbox?: BBox } = {}) {
  const rows = ctx.db.prepare(`${SELECT} ORDER BY r.updated_at DESC`).all() as RepoRow[];
  const q = filter.q?.toLowerCase();
  return rows.filter(
    (r) =>
      repoAccess(ctx, r, userId) !== "none" &&
      (!filter.owner || r.owner === filter.owner) &&
      (!filter.covers || (r.footprint !== null && bboxContains(JSON.parse(r.footprint) as BBox, filter.covers.lon, filter.covers.lat))) &&
      (!filter.bbox || (r.footprint !== null && bboxIntersects(JSON.parse(r.footprint) as BBox, filter.bbox))) &&
      (!filter.topic || (JSON.parse(r.topics) as string[]).includes(filter.topic.toLowerCase())) &&
      (!q || `${r.owner}/${r.name} ${r.description} ${r.region} ${r.tags} ${r.topics}`.toLowerCase().includes(q)),
  );
}

export function updateRepo(
  ctx: Ctx,
  repo: RepoRow,
  patch: Partial<{ name: string; description: string; defaultBranch: string; visibility: "public" | "private"; crs: string; nodata: number | null; verticalDatum: number | null; requireChecks: boolean; requireReview: boolean; requireOwnerReview: boolean; requireCog: boolean; license: string; topics: string[]; lockPatterns: string[] }>,
) {
  if (patch.name !== undefined) {
    const name = patch.name.trim().toLowerCase();
    if (!NAME.test(name)) throw badRequest("Use lowercase letters, numbers, dots, dashes or underscores.");
    if (name !== repo.name && ctx.db.prepare("SELECT 1 FROM repos WHERE owner_id = ? AND name = ?").get(repo.owner_id, name)) throw conflict("repo_exists", `${repo.owner}/${name} already exists.`);
    ctx.db.prepare("UPDATE repos SET name = ? WHERE id = ?").run(name, repo.id);
  }
  if (patch.defaultBranch !== undefined && !ctx.db.prepare("SELECT 1 FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, patch.defaultBranch)) {
    throw badRequest(`Branch ${patch.defaultBranch} doesn’t exist.`);
  }
  if (patch.crs !== undefined && !/^EPSG:\d{4,6}$/.test(patch.crs)) throw badRequest("CRS must look like EPSG:32643.");
  if (patch.license !== undefined && patch.license !== "" && !licenseIds.has(patch.license)) throw badRequest("Pick a licence from the list, or leave it empty.");
  const topics = patch.topics === undefined ? undefined : cleanTopics(patch.topics);
  if (topics) {
    const problem = invalidTopic(topics);
    if (problem) throw badRequest(problem);
  }
  let lockPatterns: string[] | undefined;
  if (patch.lockPatterns !== undefined) {
    const cleaned = cleanPatterns(patch.lockPatterns);
    if (cleaned.problem) throw badRequest(cleaned.problem);
    lockPatterns = cleaned.patterns;
  }
  const set: [string, unknown][] = [];
  if (lockPatterns) set.push(["lock_patterns", JSON.stringify(lockPatterns)]);
  if (patch.license !== undefined) set.push(["license", patch.license]);
  if (topics) set.push(["topics", JSON.stringify(topics)]);
  if (patch.description !== undefined) set.push(["description", patch.description]);
  if (patch.defaultBranch !== undefined) set.push(["default_branch", patch.defaultBranch]);
  if (patch.crs !== undefined) set.push(["crs", patch.crs]);
  if (patch.nodata !== undefined) set.push(["nodata", patch.nodata]);
  if (patch.verticalDatum !== undefined) set.push(["vertical_datum", patch.verticalDatum]);
  if (patch.requireChecks !== undefined) set.push(["require_checks", patch.requireChecks ? 1 : 0]);
  if (patch.requireReview !== undefined) set.push(["require_review", patch.requireReview ? 1 : 0]);
  if (patch.requireOwnerReview !== undefined) set.push(["require_owner_review", patch.requireOwnerReview ? 1 : 0]);
  if (patch.requireCog !== undefined) set.push(["require_cog", patch.requireCog ? 1 : 0]);
  if (patch.visibility !== undefined && patch.visibility !== repo.visibility) {
    set.push(["visibility", patch.visibility]);
    if (patch.visibility === "public") {
      // Going public: its chunks become readable by anyone, so they join the public scope.
      ctx.db.prepare("INSERT OR IGNORE INTO chunk_scopes (hash, scope) SELECT hash, 'public' FROM repo_chunks WHERE repo_id = ?").run(repo.id);
    } else {
      // Going private: future pushes land in the owner's scope; chunks that were public stay public for others.
      ctx.db.prepare("INSERT OR IGNORE INTO chunk_scopes (hash, scope) SELECT hash, ? FROM repo_chunks WHERE repo_id = ?").run(`owner:${repo.owner_id}`, repo.id);
    }
  }
  for (const [col, value] of set) ctx.db.prepare(`UPDATE repos SET ${col} = ? WHERE id = ?`).run(value as never, repo.id);
  ctx.db.prepare("UPDATE repos SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(repo.id);
  const owner = ctx.db.prepare("SELECT handle FROM owners WHERE id = ?").get(repo.owner_id) as { handle: string };
  return findRepo(ctx, owner.handle, patch.name?.trim().toLowerCase() ?? repo.name);
}

export function deleteRepo(ctx: Ctx, repo: RepoRow) {
  // Physical chunks stay; chunks no longer referenced anywhere can be collected later.
  ctx.db.prepare("DELETE FROM repos WHERE id = ?").run(repo.id);
}

/** Public shape returned by the API. */
export function repoJson(repo: RepoRow) {
  return {
    owner: repo.owner,
    name: repo.name,
    description: repo.description,
    visibility: repo.visibility,
    defaultBranch: repo.default_branch,
    region: repo.region,
    crs: repo.crs,
    nodata: repo.nodata,
    verticalDatum: repo.vertical_datum,
    requireChecks: Boolean(repo.require_checks),
    requireReview: Boolean(repo.require_review),
    requireOwnerReview: Boolean(repo.require_owner_review),
    requireCog: Boolean(repo.require_cog),
    stars: repo.stars,
    forks: repo.forks,
    tags: JSON.parse(repo.tags) as string[],
    license: repo.license,
    footprint: repo.footprint ? (JSON.parse(repo.footprint) as number[]) : null,
    topics: JSON.parse(repo.topics) as string[],
    lockPatterns: JSON.parse(repo.lock_patterns ?? "[]") as string[],
    sizeBytes: repo.size_bytes,
    createdAt: repo.created_at,
    updatedAt: repo.updated_at,
  };
}
