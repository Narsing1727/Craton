// Repositories: create, read, list, update, delete.

import { filterAsync } from "../core/async.ts";
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

export async function findRepo(ctx: Ctx, owner: string, name: string): Promise<RepoRow> {
  const row = await ctx.db.get(`${SELECT} WHERE o.handle = ? AND r.name = ?`, owner, name) as RepoRow | undefined;
  if (!row) throw notFound("Repository");
  return row;
}

export async function getRepoFor(ctx: Ctx, owner: string, name: string, userId: number | null, needed: "read" | "write" | "admin" = "read") {
  const repo = await findRepo(ctx, owner, name);
  await requireAccess(ctx, repo, userId, needed);
  return repo;
}

export async function createRepo(
  ctx: Ctx,
  userId: number,
  input: { owner?: string; name: string; description?: string; visibility?: "public" | "private"; crs?: string; region?: string; nodata?: number | null; verticalDatum?: number | null },
): Promise<RepoRow> {
  const owner = input.owner ? await getOwner(ctx, input.owner) : await getOwner(ctx, (await ctx.db.get("SELECT handle FROM owners WHERE id = ?", userId) as { handle: string }).handle);
  if (owner.kind === "user" && owner.id !== userId) throw badRequest("You can only create repositories for yourself or an organization you belong to.");
  if (owner.kind === "org") {
    const role = await orgRole(ctx, owner.id, userId);
    if (!role || role === "Member") throw badRequest(`Only owners and maintainers of ${owner.handle} can create repositories.`);
  }
  const name = input.name.trim().toLowerCase();
  if (!NAME.test(name)) throw badRequest("Use lowercase letters, numbers, dots, dashes or underscores.");
  if (await ctx.db.get("SELECT 1 FROM repos WHERE owner_id = ? AND name = ?", owner.id, name)) throw conflict("repo_exists", `${owner.handle}/${name} already exists.`);
  if (input.crs && !/^EPSG:\d{4,6}$/.test(input.crs)) throw badRequest("CRS must look like EPSG:32643.");
  await ctx.db.run("INSERT INTO repos (owner_id, name, description, visibility, crs, region, nodata, vertical_datum) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", owner.id, name, input.description ?? "", input.visibility ?? "public", input.crs ?? "EPSG:32643", input.region ?? "", input.nodata ?? null, input.verticalDatum ?? null);
  return findRepo(ctx, owner.handle, name);
}

/**
 * The repositories `userId` may read, as SQL: a public one, one the person owns, one owned by an organization they belong to, or one
 * they were added to. (The same rule repoAccess applies to one repository, written so the database can apply it to all of them.)
 */
export function readableBy(userId: number | null, alias = "r"): { sql: string; params: number[] } {
  if (userId === null) return { sql: `${alias}.visibility = 'public'`, params: [] };
  return {
    sql: `(${alias}.visibility = 'public' OR ${alias}.owner_id = ? OR EXISTS (SELECT 1 FROM memberships m WHERE m.org_id = ${alias}.owner_id AND m.user_id = ?)
      OR EXISTS (SELECT 1 FROM collaborators cb WHERE cb.repo_id = ${alias}.id AND cb.user_id = ?))`,
    params: [userId, userId, userId],
  };
}

type RepoFilter = { owner?: string; owners?: string[]; q?: string; topic?: string; covers?: { lat: number; lon: number }; bbox?: BBox };

/** Everything that can be decided in SQL, so a big installation does not load every repository to show a few. */
function repoWhere(userId: number | null, filter: RepoFilter) {
  const access = readableBy(userId);
  const where = [access.sql];
  const params: (string | number)[] = [...access.params];
  if (filter.owner) {
    where.push("o.handle = ?");
    params.push(filter.owner);
  }
  if (filter.owners) {
    if (!filter.owners.length) where.push("1 = 0");
    else (where.push(`o.handle IN (${filter.owners.map(() => "?").join(",")})`), params.push(...filter.owners));
  }
  const q = filter.q?.toLowerCase();
  if (q) {
    where.push(`lower(o.handle || '/' || r.name || ' ' || r.description || ' ' || r.region || ' ' || r.tags || ' ' || r.topics) LIKE ? ESCAPE '\\'`);
    params.push(`%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
  }
  return { where: where.join(" AND "), params };
}

/** What only the application can judge: topics, and where the data is on the map. */
const needsRows = (filter: RepoFilter) => Boolean(filter.topic || filter.covers || filter.bbox);
const passes = (r: RepoRow, filter: RepoFilter) =>
  (!filter.covers || (r.footprint !== null && bboxContains(JSON.parse(r.footprint) as BBox, filter.covers.lon, filter.covers.lat))) &&
  (!filter.bbox || (r.footprint !== null && bboxIntersects(JSON.parse(r.footprint) as BBox, filter.bbox))) &&
  (!filter.topic || (JSON.parse(r.topics) as string[]).includes(filter.topic.toLowerCase()));

/** The repositories `userId` can read, newest activity first. With `page`, only that slice (and how many there are in all). */
export async function repoPage(ctx: Ctx, userId: number | null, filter: RepoFilter = {}, page?: { limit: number; offset: number }): Promise<{ rows: RepoRow[]; total: number }> {
  const { where, params } = repoWhere(userId, filter);
  if (needsRows(filter)) {
    const all = (await ctx.db.all(`${SELECT} WHERE ${where} ORDER BY r.updated_at DESC`, ...params) as RepoRow[]).filter((r) => passes(r, filter));
    return { rows: page ? all.slice(page.offset, page.offset + page.limit) : all, total: all.length };
  }
  const rows = await ctx.db.all(`${SELECT} WHERE ${where} ORDER BY r.updated_at DESC, r.id DESC${page ? " LIMIT ? OFFSET ?" : ""}`, ...params, ...(page ? [page.limit, page.offset] : [])) as RepoRow[];
  const total = page ? (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM repos r JOIN owners o ON o.id = r.owner_id WHERE ${where}`, ...params))!.n : rows.length;
  return { rows, total };
}

export async function listRepos(ctx: Ctx, userId: number | null, filter: RepoFilter = {}) {
  return (await repoPage(ctx, userId, filter)).rows;
}

export async function updateRepo(
  ctx: Ctx,
  repo: RepoRow,
  patch: Partial<{ name: string; description: string; defaultBranch: string; visibility: "public" | "private"; crs: string; nodata: number | null; verticalDatum: number | null; requireChecks: boolean; requireReview: boolean; requireOwnerReview: boolean; requireCog: boolean; license: string; topics: string[]; lockPatterns: string[] }>,
) {
  if (patch.name !== undefined) {
    const name = patch.name.trim().toLowerCase();
    if (!NAME.test(name)) throw badRequest("Use lowercase letters, numbers, dots, dashes or underscores.");
    if (name !== repo.name && await ctx.db.get("SELECT 1 FROM repos WHERE owner_id = ? AND name = ?", repo.owner_id, name)) throw conflict("repo_exists", `${repo.owner}/${name} already exists.`);
    await ctx.db.run("UPDATE repos SET name = ? WHERE id = ?", name, repo.id);
  }
  if (patch.defaultBranch !== undefined && !await ctx.db.get("SELECT 1 FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?", repo.id, patch.defaultBranch)) {
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
      await ctx.db.run("INSERT INTO chunk_scopes (hash, scope) SELECT hash, 'public' FROM repo_chunks WHERE repo_id = ? ON CONFLICT DO NOTHING", repo.id);
    } else {
      // Going private: future pushes land in the owner's scope; chunks that were public stay public for others.
      await ctx.db.run("INSERT INTO chunk_scopes (hash, scope) SELECT hash, ? FROM repo_chunks WHERE repo_id = ? ON CONFLICT DO NOTHING", `owner:${repo.owner_id}`, repo.id);
    }
  }
  for (const [col, value] of set) await ctx.db.run(`UPDATE repos SET ${col} = ? WHERE id = ?`, value as never, repo.id);
  await ctx.db.run("UPDATE repos SET updated_at = now_iso() WHERE id = ?", repo.id);
  const owner = await ctx.db.get("SELECT handle FROM owners WHERE id = ?", repo.owner_id) as { handle: string };
  return findRepo(ctx, owner.handle, patch.name?.trim().toLowerCase() ?? repo.name);
}

export async function deleteRepo(ctx: Ctx, repo: RepoRow) {
  // Physical chunks stay; chunks no longer referenced anywhere can be collected later.
  await ctx.db.run("DELETE FROM repos WHERE id = ?", repo.id);
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
