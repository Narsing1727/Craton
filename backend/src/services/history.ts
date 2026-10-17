// Objects, refs and history. The server never trusts ids, sizes or Merkle roots sent by a client:
// it recomputes them, and every chunk a blob names must already be in a scope the push may use.

import type { Ctx } from "./context.ts";
import { badRequest, conflict, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { repoScope } from "./repos.ts";
import { missingChunks } from "./chunks.ts";
import type { CratonObject, BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { assertLockedWhenRequired, assertNotLockedByOthers } from "./locks.ts";
import { canonicalJson, diffBlobs, diffTrees, makeCommit, makeTree, objectId, shortId, treeMerkleRoot } from "../core/objects.ts";
import { dataTypesOf } from "../core/datatypes.ts";

const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.?(?:\/|$))[^\0\\]+$/;
const BRANCH = /^[a-z0-9][a-z0-9._/-]{0,99}$/;

export function getObject<T extends CratonObject>(ctx: Ctx, repo: RepoRow, id: string, type?: T["type"]): T {
  const row = ctx.db
    .prepare("SELECT o.type, o.body FROM objects o JOIN repo_objects ro ON ro.object_id = o.id WHERE ro.repo_id = ? AND o.id = ?")
    .get(repo.id, id) as { type: string; body: string } | undefined;
  if (!row || (type && row.type !== type)) throw notFound(type ? `${type} ${id.slice(0, 7)}` : `Object ${id.slice(0, 7)}`);
  return JSON.parse(row.body) as T;
}

function hasObject(ctx: Ctx, repo: RepoRow, id: string) {
  return Boolean(ctx.db.prepare("SELECT 1 FROM repo_objects WHERE repo_id = ? AND object_id = ?").get(repo.id, id));
}

/** Which of `ids` does the repository not have yet (so the client knows what to send)? */
export function missingObjects(ctx: Ctx, repo: RepoRow, ids: string[]) {
  return [...new Set(ids)].filter((id) => !hasObject(ctx, repo, id));
}

/** Validate and store pushed objects (blobs, then trees, then commits). */
export function registerObjects(ctx: Ctx, repo: RepoRow, objects: unknown[]) {
  const parsed: CratonObject[] = objects.map((o) => {
    if (!o || typeof o !== "object" || !("type" in o)) throw badRequest("Each object needs a type.");
    return o as CratonObject;
  });
  const batch = new Map<string, CratonObject>();
  for (const o of parsed) batch.set(objectId(o), o);
  const known = (id: string) => batch.has(id) || hasObject(ctx, repo, id);
  const lookup = <T extends CratonObject>(id: string, type: T["type"]): T => (batch.get(id) as T | undefined) ?? getObject<T>(ctx, repo, id, type);

  // Blobs: sizes add up, every chunk is available to this repository.
  const blobs = parsed.filter((o): o is BlobObject => o.type === "blob");
  for (const b of blobs) {
    if (!Array.isArray(b.chunks) || typeof b.size !== "number" || !/^[0-9a-f]{64}$/.test(b.sha256 ?? "")) throw badRequest("Malformed blob.");
    const total = b.chunks.reduce((n, c) => n + c.size, 0);
    if (total !== b.size) throw badRequest(`Blob chunk sizes add up to ${total}, not ${b.size}.`);
  }
  const needed = missingChunks(ctx, repo, blobs.flatMap((b) => b.chunks.map((c) => c.hash)));
  if (needed.length) throw conflict("missing_chunks", `${needed.length} chunks must be uploaded first.`, { missing: needed });

  for (const o of parsed) {
    if (o.type === "tree") {
      const canonical = makeTree(o.entries);
      if (canonicalJson(canonical) !== canonicalJson(o)) throw badRequest("Tree entries must be sorted by path.");
      for (const e of o.entries) {
        if (!PATH.test(e.path)) throw badRequest(`Invalid path: ${e.path}`);
        if (!known(e.blob)) throw conflict("missing_objects", `Blob ${e.blob.slice(0, 7)} for ${e.path} wasn’t sent.`);
        if (lookup<BlobObject>(e.blob, "blob").size !== e.size) throw badRequest(`Size of ${e.path} doesn’t match its blob.`);
      }
    }
  }
  for (const o of parsed) {
    if (o.type === "commit") {
      if (!o.message?.trim()) throw badRequest("Commit messages can’t be empty.");
      if (!o.author?.trim()) throw badRequest("Commits need an author.");
      if (Number.isNaN(Date.parse(o.timestamp))) throw badRequest("Invalid commit timestamp.");
      if (!known(o.tree)) throw conflict("missing_objects", `Tree ${o.tree.slice(0, 7)} wasn’t sent.`);
      for (const p of o.parents) if (!known(p)) throw conflict("missing_objects", `Parent ${p.slice(0, 7)} isn’t in this repository.`);
      const root = treeMerkleRoot(lookup<TreeObject>(o.tree, "tree"));
      if (root !== o.merkleRoot) throw badRequest(`Merkle root mismatch for commit: expected ${root}.`);
    }
  }

  const insertObject = ctx.db.prepare("INSERT OR IGNORE INTO objects (id, type, body) VALUES (?, ?, ?)");
  const link = ctx.db.prepare("INSERT OR IGNORE INTO repo_objects (repo_id, object_id) VALUES (?, ?)");
  const repoChunk = ctx.db.prepare("INSERT OR IGNORE INTO repo_chunks (repo_id, hash) VALUES (?, ?)");
  const scope = ctx.db.prepare("INSERT OR IGNORE INTO chunk_scopes (hash, scope) VALUES (?, ?)");
  const commitRow = ctx.db.prepare("INSERT OR IGNORE INTO commits (repo_id, id, tree, parents, author, message, timestamp, merkle_root) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const stored: string[] = [];
  for (const [id, o] of batch) {
    insertObject.run(id, o.type, canonicalJson(o));
    link.run(repo.id, id);
    stored.push(id);
    if (o.type === "blob") {
      for (const c of o.chunks) {
        repoChunk.run(repo.id, c.hash);
        scope.run(c.hash, repoScope(repo));
      }
    }
    if (o.type === "commit") {
      commitRow.run(repo.id, id, o.tree, JSON.stringify(o.parents), o.author, o.message, o.timestamp, o.merkleRoot);
    }
  }
  return { stored };
}

export type RefRow = { name: string; kind: "branch" | "tag"; commit_id: string; updated_at: string };

export function listRefs(ctx: Ctx, repo: RepoRow, kind: "branch" | "tag" = "branch") {
  return ctx.db.prepare("SELECT name, kind, commit_id, updated_at FROM refs WHERE repo_id = ? AND kind = ? ORDER BY name").all(repo.id, kind) as RefRow[];
}

/** Resolve a branch, tag, full commit id or unique prefix to a commit id. */
export function resolveRef(ctx: Ctx, repo: RepoRow, ref: string): string {
  const named = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND name = ? ORDER BY kind").get(repo.id, ref) as { commit_id: string } | undefined;
  if (named) return named.commit_id;
  if (/^[0-9a-f]{4,64}$/.test(ref)) {
    const rows = ctx.db.prepare("SELECT id FROM commits WHERE repo_id = ? AND id LIKE ? LIMIT 2").all(repo.id, `${ref}%`) as { id: string }[];
    if (rows.length === 1) return rows[0].id;
    if (rows.length > 1) throw badRequest(`${ref} matches more than one commit; use more characters.`);
  }
  throw notFound(`Ref ${ref}`);
}

function parentsOf(ctx: Ctx, repo: RepoRow, id: string): string[] {
  const row = ctx.db.prepare("SELECT parents FROM commits WHERE repo_id = ? AND id = ?").get(repo.id, id) as { parents: string } | undefined;
  return row ? (JSON.parse(row.parents) as string[]) : [];
}

export function ancestors(ctx: Ctx, repo: RepoRow, from: string): Set<string> {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...parentsOf(ctx, repo, id));
  }
  return seen;
}

/** The commits reachable from `to` that are not reachable from `from` (all of them when `from` is null), newest first. */
export function commitsBetween(ctx: Ctx, repo: RepoRow, from: string | null, to: string): string[] {
  const known = from ? ancestors(ctx, repo, from) : new Set<string>();
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = [to];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id) || known.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...parentsOf(ctx, repo, id));
  }
  return out;
}

export const isAncestor = (ctx: Ctx, repo: RepoRow, maybeAncestor: string, of: string) => ancestors(ctx, repo, of).has(maybeAncestor);

export function mergeBase(ctx: Ctx, repo: RepoRow, a: string, b: string): string | null {
  const fromA = ancestors(ctx, repo, a);
  const queue = [b];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (fromA.has(id)) return id;
    if (seen.has(id)) continue;
    seen.add(id);
    queue.push(...parentsOf(ctx, repo, id));
  }
  return null;
}

/** The paths that differ between two commits, checked against other people's file locks. */
function assertNoLockedChanges(ctx: Ctx, repo: RepoRow, actor: string, from: string, to: string, via: string) {
  const treeOf = (id: string) => getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, id, "commit").tree, "tree");
  const changed = diffTrees(treeOf(from), treeOf(to)).map((c) => c.path);
  assertNotLockedByOthers(ctx, repo, actor, changed);
  // A direct push must hold the lock on files the repository says have to be locked. A merge carries changes
  // that were already made under someone's lock, and a new branch or an import is not an edit in place.
  if (via === "push") assertLockedWhenRequired(ctx, repo, actor, changed);
}

/**
 * Move a branch. History is append-only: the new commit must descend from the current tip
 * (fast-forward), and `expected` must match the tip the client last saw (compare-and-swap), so a
 * concurrent push is rejected instead of silently overwritten.
 */
export function updateBranch(ctx: Ctx, repo: RepoRow, branch: string, next: string, expected: string | null, actor: string, via: "push" | "merge" | "branch" | "import" = "push") {
  if (!BRANCH.test(branch)) throw badRequest("Branch names use lowercase letters, numbers, dots, dashes and slashes.");
  if (!ctx.db.prepare("SELECT 1 FROM commits WHERE repo_id = ? AND id = ?").get(repo.id, next)) throw conflict("missing_objects", "Push the commit before updating the branch.");
  const current = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, branch) as { commit_id: string } | undefined;
  if (current) {
    if (expected !== current.commit_id) {
      throw conflict("stale_ref", `${branch} moved since you last pulled (now ${current.commit_id.slice(0, 7)}). Pull, then push again.`, { current: current.commit_id });
    }
    if (current.commit_id === next) return { updated: false, old: current.commit_id, new: next };
    if (!isAncestor(ctx, repo, current.commit_id, next)) {
      throw conflict("non_fast_forward", `History is append-only: ${next.slice(0, 7)} doesn’t build on ${branch}. Pull and merge, or revert with a new commit.`);
    }
    assertNoLockedChanges(ctx, repo, actor, current.commit_id, next, via);
    ctx.db.prepare("UPDATE refs SET commit_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE repo_id = ? AND kind = 'branch' AND name = ?").run(next, repo.id, branch);
  } else {
    if (expected) throw conflict("stale_ref", `${branch} doesn’t exist yet.`);
    // A new branch: what it changes is measured from where it forks off the default branch.
    const defaultTip = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, repo.default_branch) as { commit_id: string } | undefined;
    const fork = defaultTip ? mergeBase(ctx, repo, defaultTip.commit_id, next) : null;
    if (fork) assertNoLockedChanges(ctx, repo, actor, fork, next, via);
    ctx.db.prepare("INSERT INTO refs (repo_id, kind, name, commit_id) VALUES (?, 'branch', ?, ?)").run(repo.id, branch, next);
  }
  ctx.db.prepare("INSERT INTO ref_log (repo_id, ref, old_commit, new_commit, actor, via) VALUES (?, ?, ?, ?, ?, ?)").run(repo.id, `branch:${branch}`, current?.commit_id ?? null, next, actor, via);
  ctx.db.prepare("UPDATE repos SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(repo.id);
  if (branch === repo.default_branch || !ctx.db.prepare("SELECT 1 FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, repo.default_branch)) {
    refreshRepoSummary(ctx, repo, next);
  }
  return { updated: true, old: current?.commit_id ?? null, new: next };
}

/**
 * Put a file back to how it was in an earlier commit, as a NEW commit on `branch`: history is
 * append-only, so a restore is recorded like any edit and can itself be undone. File locks held by
 * others still apply.
 */
export function restoreFile(ctx: Ctx, repo: RepoRow, branch: string, path: string, from: string, actor: string, message?: string) {
  const row = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, branch) as { commit_id: string } | undefined;
  if (!row) throw badRequest(`Restoring a file adds a commit to a branch, and “${branch}” isn’t one. Pick a branch.`);
  const tip = row.commit_id;
  const sourceId = resolveRef(ctx, repo, from);
  const treeOf = (id: string) => getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, id, "commit").tree, "tree");
  const wanted = treeOf(sourceId).entries.find((e) => e.path === path);
  if (!wanted) throw notFound(`${path} in ${shortId(sourceId)}`);
  const current = treeOf(tip);
  if (current.entries.find((e) => e.path === path)?.blob === wanted.blob) throw conflict("nothing_to_restore", `${path} on ${branch} is already identical to that version.`);

  const tree = makeTree([...current.entries.filter((e) => e.path !== path), wanted]);
  const commit = makeCommit(
    { tree: objectId(tree), parents: [tip], author: actor, message: message?.trim() || `Restore ${path} to ${shortId(sourceId)}`, timestamp: new Date().toISOString() },
    tree,
  );
  registerObjects(ctx, repo, [tree, commit]);
  const id = objectId(commit);
  updateBranch(ctx, repo, branch, id, tip, actor, "push");
  return { commit: id, before: tip, branch };
}

export function createBranch(ctx: Ctx, repo: RepoRow, name: string, from: string, actor: string) {
  if (ctx.db.prepare("SELECT 1 FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, name)) throw conflict("branch_exists", `${name} already exists.`);
  return updateBranch(ctx, repo, name, resolveRef(ctx, repo, from), null, actor, "branch");
}

export function deleteBranch(ctx: Ctx, repo: RepoRow, name: string, actor: string) {
  if (name === repo.default_branch) throw badRequest("You can’t delete the default branch.");
  const current = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, name) as { commit_id: string } | undefined;
  if (!current) throw notFound(`Branch ${name}`);
  // Commits stay in the repository; only the pointer goes (it can be recreated from the ref log).
  ctx.db.prepare("DELETE FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").run(repo.id, name);
  ctx.db.prepare("INSERT INTO ref_log (repo_id, ref, old_commit, new_commit, actor) VALUES (?, ?, ?, NULL, ?)").run(repo.id, `branch:${name}`, current.commit_id, actor);
}

/** Cache size and data types of the default branch on the repository row. */
export function refreshRepoSummary(ctx: Ctx, repo: RepoRow, commitId: string) {
  const commit = getObject<CommitObject>(ctx, repo, commitId, "commit");
  const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
  const size = tree.entries.reduce((n, e) => n + e.size, 0);
  const tags = dataTypesOf(tree.entries.map((e) => e.path));
  ctx.db.prepare("UPDATE repos SET size_bytes = ?, tags = ? WHERE id = ?").run(size, JSON.stringify(tags), repo.id);
}

export type CommitRow = { id: string; tree: string; parents: string; author: string; message: string; timestamp: string; merkle_root: string };

/** Commits reachable from `ref`, newest first. */
export function listCommits(ctx: Ctx, repo: RepoRow, ref: string, limit = 50) {
  const tip = resolveRef(ctx, repo, ref);
  const ids = ancestors(ctx, repo, tip);
  const rows = ctx.db.prepare("SELECT id, tree, parents, author, message, timestamp, merkle_root FROM commits WHERE repo_id = ? ORDER BY timestamp DESC").all(repo.id) as CommitRow[];
  return rows.filter((r) => ids.has(r.id)).slice(0, limit);
}

export function commitJson(row: CommitRow) {
  return {
    sha: row.id,
    shortSha: row.id.slice(0, 7),
    tree: row.tree,
    parents: JSON.parse(row.parents) as string[],
    author: row.author,
    message: row.message,
    timestamp: row.timestamp,
    merkleRoot: row.merkle_root,
  };
}

/** Files a commit changed relative to its first parent, with chunk-level counts. */
export function commitChanges(ctx: Ctx, repo: RepoRow, commit: CommitObject) {
  const after = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
  const parent = commit.parents[0] ? getObject<CommitObject>(ctx, repo, commit.parents[0], "commit") : null;
  const before = parent ? getObject<TreeObject>(ctx, repo, parent.tree, "tree") : null;
  return diffTrees(before, after).map((ch) => {
    const oldBlob = ch.oldBlob ? getObject<BlobObject>(ctx, repo, ch.oldBlob, "blob") : null;
    const newBlob = ch.newBlob ? getObject<BlobObject>(ctx, repo, ch.newBlob, "blob") : null;
    return { ...ch, chunks: diffBlobs(oldBlob, newBlob) };
  });
}

export type ListingEntry = { name: string; path: string; type: "dir" | "file"; size: number; blob?: string; lastCommit?: { sha: string; message: string; timestamp: string; author: string } };

/** Directory listing at `ref`, with the last commit that touched each entry. */
export function listTree(ctx: Ctx, repo: RepoRow, ref: string, dir = ""): ListingEntry[] {
  const prefix = dir.replace(/^\/+|\/+$/g, "");
  const tip = resolveRef(ctx, repo, ref);
  const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, tip, "commit").tree, "tree");
  const children = new Map<string, ListingEntry>();
  for (const e of tree.entries) {
    if (prefix && !e.path.startsWith(`${prefix}/`)) continue;
    const rest = prefix ? e.path.slice(prefix.length + 1) : e.path;
    const [head, ...more] = rest.split("/");
    const childPath = prefix ? `${prefix}/${head}` : head;
    const existing = children.get(head);
    if (more.length) {
      if (existing) existing.size += e.size;
      else children.set(head, { name: head, path: childPath, type: "dir", size: e.size });
    } else {
      children.set(head, { name: head, path: childPath, type: "file", size: e.size, blob: e.blob });
    }
  }
  if (prefix && children.size === 0) throw notFound(`Path ${prefix}`);

  // Walk history from the tip until every entry has its most recent change.
  const pending = new Set(children.keys());
  for (const row of listCommits(ctx, repo, tip, 500)) {
    if (!pending.size) break;
    const commit = getObject<CommitObject>(ctx, repo, row.id, "commit");
    const after = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
    const parent = commit.parents[0] ? getObject<CommitObject>(ctx, repo, commit.parents[0], "commit") : null;
    const changed = diffTrees(parent ? getObject<TreeObject>(ctx, repo, parent.tree, "tree") : null, after).map((c) => c.path);
    for (const name of [...pending]) {
      const p = children.get(name)!.path;
      if (changed.some((c) => c === p || c.startsWith(`${p}/`))) {
        children.get(name)!.lastCommit = { sha: row.id, message: row.message, timestamp: row.timestamp, author: row.author };
        pending.delete(name);
      }
    }
  }
  return [...children.values()].sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
}

/**
 * File-level three-way merge. A path conflicts when both sides changed it differently;
 * binary GIS files can't be merged line by line, so the fix is choosing a version.
 */
export function threeWayMerge(base: TreeObject | null, ours: TreeObject, theirs: TreeObject) {
  const b = new Map((base?.entries ?? []).map((e) => [e.path, e]));
  const o = new Map(ours.entries.map((e) => [e.path, e]));
  const t = new Map(theirs.entries.map((e) => [e.path, e]));
  const paths = new Set([...b.keys(), ...o.keys(), ...t.keys()]);
  const merged = [];
  const conflicts: string[] = [];
  for (const p of paths) {
    const vb = b.get(p)?.blob, vo = o.get(p)?.blob, vt = t.get(p)?.blob;
    let pick;
    if (vo === vt) pick = o.get(p);
    else if (vo === vb) pick = t.get(p);
    else if (vt === vb) pick = o.get(p);
    else {
      conflicts.push(p);
      continue;
    }
    if (pick) merged.push(pick);
  }
  return { tree: makeTree(merged), conflicts: conflicts.sort() };
}

/**
 * What merging `head` into `base` would bring: commits on head that base lacks, the file changes
 * since their merge base (with chunk counts), and the paths both sides changed differently.
 */
export function compareRefs(ctx: Ctx, repo: RepoRow, base: string, head: string) {
  const baseTip = resolveRef(ctx, repo, base);
  const headTip = resolveRef(ctx, repo, head);
  const onBase = ancestors(ctx, repo, baseTip);
  const onHead = ancestors(ctx, repo, headTip);
  const mb = mergeBase(ctx, repo, baseTip, headTip);
  const treeOf = (id: string) => getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, id, "commit").tree, "tree");
  const before = mb ? treeOf(mb) : null;
  const after = treeOf(headTip);
  const changes = diffTrees(before, after).map((ch) => {
    const oldBlob = ch.oldBlob ? getObject<BlobObject>(ctx, repo, ch.oldBlob, "blob") : null;
    const newBlob = ch.newBlob ? getObject<BlobObject>(ctx, repo, ch.newBlob, "blob") : null;
    return { ...ch, chunks: diffBlobs(oldBlob, newBlob) };
  });
  const rows = listCommits(ctx, repo, headTip, 10_000).filter((r) => !onBase.has(r.id));
  const behind = [...onBase].filter((id) => !onHead.has(id)).length;
  const { conflicts } = threeWayMerge(before, treeOf(baseTip), after);
  return {
    base: { ref: base, commit: baseTip },
    head: { ref: head, commit: headTip },
    mergeBase: mb,
    ahead: rows.length,
    behind,
    fastForward: onHead.has(baseTip),
    commits: rows.map(commitJson),
    changes,
    conflicts,
  };
}
