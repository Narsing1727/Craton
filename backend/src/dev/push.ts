// Commit files straight through the service layer (seed script and tests).
// Same steps the CLI takes over HTTP: chunk, upload missing chunks, register objects, move the branch.

import type { Ctx } from "../services/context.ts";
import type { RepoRow } from "../services/repos.ts";
import { putChunk } from "../services/chunks.ts";
import { getObject, registerObjects, resolveRef, updateBranch } from "../services/history.ts";
import { runChecks } from "../checks/runner.ts";
import type { BlobObject, CommitObject, TreeEntry, TreeObject } from "../core/objects.ts";
import { makeCommit, makeTree, objectId } from "../core/objects.ts";
import { chunkBuffer, sha256Hex } from "../core/fastcdc.ts";
import { config } from "../config.ts";

/** Write `changes` (path → bytes, or null to delete) on top of `branch` and push it. */
export async function commitFiles(
  ctx: Ctx,
  repo: RepoRow,
  opts: { branch: string; changes: Record<string, Buffer | null>; message: string; author: string; timestamp: Date; from?: string; via?: "push" | "import" },
) {
  let parent: string | null = null;
  try {
    parent = resolveRef(ctx, repo, opts.branch);
  } catch {
    if (opts.from) parent = resolveRef(ctx, repo, opts.from);
  }
  const base = parent ? getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, parent, "commit").tree, "tree") : null;
  const entries = new Map<string, TreeEntry>((base?.entries ?? []).map((e) => [e.path, e]));
  const objects: (BlobObject | TreeObject | CommitObject)[] = [];

  for (const [path, data] of Object.entries(opts.changes)) {
    if (data === null) {
      entries.delete(path);
      continue;
    }
    const spans = chunkBuffer(data, config.chunking);
    const chunks = [];
    for (const s of spans) {
      const piece = data.subarray(s.offset, s.offset + s.length);
      const hash = sha256Hex(piece);
      await putChunk(ctx, repo, hash, Buffer.from(piece));
      chunks.push({ hash, size: s.length });
    }
    const blob: BlobObject = { type: "blob", size: data.length, sha256: sha256Hex(data), chunks };
    objects.push(blob);
    entries.set(path, { path, blob: objectId(blob), size: data.length });
  }
  const tree = makeTree([...entries.values()]);
  const commit = makeCommit({ tree: objectId(tree), parents: parent ? [parent] : [], author: opts.author, message: opts.message, timestamp: opts.timestamp.toISOString() }, tree);
  objects.push(tree, commit);
  registerObjects(ctx, repo, objects);
  const id = objectId(commit);
  const current = (() => {
    try {
      return resolveRef(ctx, repo, opts.branch);
    } catch {
      return null;
    }
  })();
  updateBranch(ctx, repo, opts.branch, id, current, opts.author, opts.via ?? "push");
  const checks = await runChecks(ctx, repo, id, opts.branch);
  return { id, checks };
}
