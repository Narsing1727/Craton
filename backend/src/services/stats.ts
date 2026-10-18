// Storage statistics, audit packages and search.

import { filterAsync } from "../core/async.ts";
import { statement } from "../db/db.ts";
import type { Ctx } from "./context.ts";
import { notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { repoJson, listRepos, repoPage } from "./repos.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { getObject, listCommits, objectsAmong, resolveRef } from "./history.ts";
import { chunkInfos } from "./chunks.ts";
import { leafHash, merkleProof, merkleProofs } from "../core/merkle.ts";
import { orgRole } from "./accounts.ts";
import { config } from "../config.ts";

/**
 * Logical size (what the repository shows), stored size (unique chunks it references, compressed),
 * and where the savings come from: repeats inside its own history, and chunks shared with other repos.
 */
export async function storageStats(ctx: Ctx, repo: RepoRow) {
  const unique = await ctx.db.get("SELECT COUNT(*) AS n, COALESCE(SUM(c.size),0) AS raw, COALESCE(SUM(c.stored_size),0) AS stored FROM repo_chunks rc JOIN chunks c ON c.hash = rc.hash WHERE rc.repo_id = ?", repo.id) as { n: number; raw: number; stored: number };
  const shared = await ctx.db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(c.size),0) AS raw FROM repo_chunks rc JOIN chunks c ON c.hash = rc.hash
       WHERE rc.repo_id = ? AND EXISTS (SELECT 1 FROM repo_chunks o WHERE o.hash = rc.hash AND o.repo_id <> rc.repo_id)`, repo.id) as { n: number; raw: number };

  // Every file version across history, as if stored without deduplication.
  const blobs = await ctx.db.all("SELECT o.body FROM objects o JOIN repo_objects ro ON ro.object_id = o.id WHERE ro.repo_id = ? AND o.type = 'blob'", repo.id) as { body: string }[];
  let historyBytes = 0;
  for (const b of blobs) historyBytes += (JSON.parse(b.body) as BlobObject).size;

  let logical = 0;
  const folders = new Map<string, { logical: number; chunks: Set<string> }>();
  let tip: string | null = null;
  try {
    tip = await resolveRef(ctx, repo, repo.default_branch);
  } catch {}
  if (tip) {
    const tree = await getObject<TreeObject>(ctx, repo, (await getObject<CommitObject>(ctx, repo, tip, "commit")).tree, "tree");
    const blobs = await objectsAmong(ctx, repo, tree.entries.map((e) => e.blob));
    for (const e of tree.entries) {
      logical += e.size;
      const top = e.path.includes("/") ? `${e.path.split("/")[0]}/` : "(root)";
      const f = folders.get(top) ?? { logical: 0, chunks: new Set<string>() };
      f.logical += e.size;
      const blob = blobs.get(e.blob);
      if (!blob) throw notFound(`blob ${e.blob.slice(0, 7)}`);
      for (const c of (JSON.parse(blob.body) as BlobObject).chunks) f.chunks.add(c.hash);
      folders.set(top, f);
    }
  }
  const infos = await chunkInfos(ctx, [...folders.values()].flatMap((f) => [...f.chunks]));
  const folderRows = ([...folders.entries()].map(([path, f]) => {
    let raw = 0, stored = 0;
    const codecs = new Set<string>();
    for (const h of f.chunks) {
      const c = infos.get(h);
      if (c) {
        raw += c.size;
        stored += c.stored_size;
        codecs.add(c.codec);
      }
    }
    return { path, logicalBytes: f.logical, uniqueBytes: raw, storedBytes: stored, codecs: [...codecs] };
  }));

  // Public repositories this one shares chunks with. Private ones are never named: that would
  // tell the viewer something about data they can't see.
  const sharedWith = (
    await ctx.db.all(`SELECT o.handle AS owner, r.name AS name, COUNT(*) AS chunks, SUM(c.size) AS bytes
         FROM repo_chunks mine JOIN repo_chunks other ON other.hash = mine.hash AND other.repo_id <> mine.repo_id
         JOIN repos r ON r.id = other.repo_id JOIN owners o ON o.id = r.owner_id JOIN chunks c ON c.hash = mine.hash
         WHERE mine.repo_id = ? AND r.visibility = 'public' GROUP BY r.id, o.handle ORDER BY bytes DESC LIMIT 10`, repo.id) as { owner: string; name: string; chunks: number; bytes: number }[]
  ).map((r) => ({ repository: `${r.owner}/${r.name}`, chunks: r.chunks, bytes: r.bytes }));

  return {
    logicalBytes: logical,
    historyBytes,
    uniqueBytes: unique.raw,
    storedBytes: unique.stored,
    chunkCount: unique.n,
    averageChunkBytes: unique.n ? Math.round(unique.raw / unique.n) : 0,
    compressionRatio: unique.stored ? Number((unique.raw / unique.stored).toFixed(2)) : 1,
    savedByHistoryBytes: Math.max(0, historyBytes - unique.raw),
    sharedWithOtherReposBytes: shared.raw,
    sharedChunkCount: shared.n,
    sharedWith,
    folders: folderRows.sort((a, b) => b.logicalBytes - a.logicalBytes),
    storage: ctx.store.kind,
  };
}

/** Everything an auditor needs to cite this repository's history (LOCUS). */
export async function auditPackage(ctx: Ctx, repo: RepoRow) {
  const commits = await listCommits(ctx, repo, repo.default_branch, 10_000);
  const tip = commits[0];
  let proofs: { path: string; blob: string; proof: ReturnType<typeof merkleProof> }[] = [];
  if (tip) {
    const tree = await getObject<TreeObject>(ctx, repo, tip.tree, "tree");
    const leaves = tree.entries.map((e) => leafHash(e.path, e.blob));
    const all = merkleProofs(leaves);
    proofs = tree.entries.map((e, i) => ({ path: e.path, blob: e.blob, proof: all[i] }));
  }
  const refLog = await ctx.db.all("SELECT ref, old_commit, new_commit, actor, at FROM ref_log WHERE repo_id = ? ORDER BY id", repo.id);
  return {
    repository: `${repo.owner}/${repo.name}`,
    generatedAt: new Date().toISOString(),
    head: tip?.id ?? null,
    merkleRoot: tip?.merkle_root ?? null,
    commits: commits.map((c) => ({ sha: c.id, parents: JSON.parse(c.parents), author: c.author, message: c.message, timestamp: c.timestamp, merkleRoot: c.merkle_root })),
    inclusionProofs: proofs,
    refLog,
  };
}

/** File names are looked for in this many of the most recently updated repositories the person can read (there is no file index yet). */
const FILE_SEARCH_REPOSITORIES = 100;
const SEARCH_PEOPLE = 50;

export async function search(ctx: Ctx, userId: number | null, q: string) {
  const needle = q.trim().toLowerCase();
  const repos = (await repoPage(ctx, userId, needle ? { q: needle } : {}, { limit: 100, offset: 0 })).rows.map(repoJson);
  const files: { repo: string; path: string; size: number }[] = [];
  for (const r of (await repoPage(ctx, userId, {}, { limit: FILE_SEARCH_REPOSITORIES, offset: 0 })).rows) {
    let tip: string;
    try {
      tip = await resolveRef(ctx, r, r.default_branch);
    } catch {
      continue;
    }
    const tree = await getObject<TreeObject>(ctx, r, (await getObject<CommitObject>(ctx, r, tip, "commit")).tree, "tree");
    for (const e of tree.entries) if (!needle || e.path.toLowerCase().includes(needle)) files.push({ repo: `${r.owner}/${r.name}`, path: e.path, size: e.size });
    if (files.length >= 100) break;
  }
  const like = `%${needle.replace(/[\%_]/g, (c) => `\${c}`)}%`;
  const ownersOf = (kind: "user" | "org") =>
    ctx.db.all<{ handle: string; kind: string; name: string; bio: string }>(
      `SELECT handle, kind, name, bio FROM owners WHERE kind = ? AND lower(handle || ' ' || name || ' ' || bio) LIKE ? ESCAPE '\' ORDER BY handle LIMIT ?`,
      kind, like, SEARCH_PEOPLE,
    );
  const [people, organizations] = await Promise.all([ownersOf("user"), ownersOf("org")]);
  return { repositories: repos, files: files.slice(0, 100), people, organizations };
}

/** Owners a user can push to (themselves and orgs where they can create repositories). */
export async function writableOwners(ctx: Ctx, userId: number) {
  const self = await ctx.db.get("SELECT handle FROM owners WHERE id = ?", userId) as { handle: string };
  const orgs = await ctx.db.all("SELECT o.id, o.handle FROM memberships m JOIN owners o ON o.id = m.org_id WHERE m.user_id = ?", userId) as { id: number; handle: string }[];
  return [self.handle, ...(await filterAsync(orgs, async (o) => await orgRole(ctx, o.id, userId) !== "Member")).map((o) => o.handle)];
}

/**
 * Plan usage for everything a user can push to (their account plus orgs they administer).
 * Billed: unique chunks their repositories reference, compressed, counted once. Free: chunks
 * that a public repository of another owner also references (DECISIONS.md §3).
 */
export async function usage(ctx: Ctx, userId: number, plan: keyof typeof config.plans) {
  const owners = await writableOwners(ctx, userId);
  return usageOf(ctx, await listRepos(ctx, userId, { owners }), plan);
}

/** Usage for one account or organization (its own repositories only). */
export async function ownerUsage(ctx: Ctx, viewerId: number, ownerHandle: string, plan: keyof typeof config.plans) {
  return usageOf(ctx, await listRepos(ctx, viewerId, { owner: ownerHandle }), plan);
}

async function usageOf(ctx: Ctx, repos: RepoRow[], plan: keyof typeof config.plans) {
  const ids = repos.map((r) => r.id);
  const limitBytes = config.plans[plan]?.storageBytes ?? config.plans.free.storageBytes;
  if (!ids.length) return { plan, limitBytes, storedBytes: 0, sharedFreeBytes: 0, repositories: { total: 0, public: 0, private: 0 }, checks: { passed: 0, failed: 0 } };
  const list = ids.join(",");
  const ownerIds = [...new Set(repos.map((r) => r.owner_id))].join(",");
  const rows = await ctx.db.all(`SELECT c.size, c.stored_size,
         EXISTS (SELECT 1 FROM repo_chunks o JOIN repos r ON r.id = o.repo_id
                 WHERE o.hash = c.hash AND r.visibility = 'public' AND r.owner_id NOT IN (${ownerIds})) AS shared
       FROM chunks c WHERE c.hash IN (SELECT DISTINCT hash FROM repo_chunks WHERE repo_id IN (${list}))`) as { size: number; stored_size: number; shared: number }[];
  let storedBytes = 0, sharedFreeBytes = 0;
  for (const r of rows) {
    if (r.shared) sharedFreeBytes += r.size;
    else storedBytes += r.stored_size;
  }
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const checks = await ctx.db.get(`SELECT COUNT(*) FILTER (WHERE status = 'passed') AS passed, COUNT(*) FILTER (WHERE status = 'failed') AS failed FROM check_runs WHERE repo_id IN (${list}) AND created_at >= ?`, since) as { passed: number | null; failed: number | null };
  return {
    plan,
    limitBytes,
    storedBytes,
    sharedFreeBytes,
    repositories: { total: repos.length, public: repos.filter((r) => r.visibility === "public").length, private: repos.filter((r) => r.visibility === "private").length },
    checks: { passed: checks.passed ?? 0, failed: checks.failed ?? 0 },
  };
}
