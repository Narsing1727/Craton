// Where each part of a file came from. Files are stored as content-defined chunks, so "which commit last changed
// this part" is exact: walk the first-parent history from a ref, and a chunk belongs to the oldest commit in that
// walk from which it has been present continuously. For a DEM re-surveyed in strips this reads as "rows 600 to 680
// came from this commit, the rest from the first import".

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { getObject, resolveRef } from "./history.ts";
import { notFound } from "./context.ts";

export type BlameRange = {
  /** Byte range of the file, [start, end). */
  start: number;
  end: number;
  chunks: number;
  commit: string;
  author: string;
  message: string;
  timestamp: string;
};

export type Blame = {
  path: string;
  ref: string;
  commit: string;
  size: number;
  chunks: number;
  ranges: BlameRange[];
  /** True when the walk stopped at `limit` commits, so the oldest ranges may be older than shown. */
  truncated: boolean;
};

const MAX_COMMITS = 500;

function entryAt(ctx: Ctx, repo: RepoRow, commit: CommitObject, path: string): string | null {
  const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
  return tree.entries.find((e) => e.path === path)?.blob ?? null;
}

export function blameFile(ctx: Ctx, repo: RepoRow, ref: string, path: string, limit = MAX_COMMITS): Blame {
  const headId = resolveRef(ctx, repo, ref);
  let id: string | null = headId;
  let commit = getObject<CommitObject>(ctx, repo, id, "commit");
  const headBlobId = entryAt(ctx, repo, commit, path);
  if (!headBlobId) throw notFound(`File ${path} at ${ref}`);
  const head = getObject<BlobObject>(ctx, repo, headBlobId, "blob");

  // owner[i] = the commit that introduced head chunk i (null until found).
  const owner: (string | null)[] = head.chunks.map(() => null);
  const meta = new Map<string, CommitObject>();
  let walked = 0;
  let truncated = false;

  while (id) {
    walked++;
    const blobId = entryAt(ctx, repo, commit, path);
    const parentId: string | null = commit.parents[0] ?? null;
    const parent = parentId ? getObject<CommitObject>(ctx, repo, parentId, "commit") : null;
    const parentBlobId = parent ? entryAt(ctx, repo, parent, path) : null;
    // Chunks of this commit's version that the parent's version did not have were introduced here.
    const before = new Set(parentBlobId ? getObject<BlobObject>(ctx, repo, parentBlobId, "blob").chunks.map((c) => c.hash) : []);
    const here = blobId ? new Set(getObject<BlobObject>(ctx, repo, blobId, "blob").chunks.map((c) => c.hash)) : new Set<string>();
    let open = 0;
    head.chunks.forEach((c, i) => {
      if (owner[i] !== null) return;
      if (here.has(c.hash) && !before.has(c.hash)) {
        owner[i] = id!;
        meta.set(id!, commit);
      } else open++;
    });
    // Anything still unclaimed once the file didn't exist (or history ran out) belongs to the oldest commit seen.
    if (open === 0) break;
    if (!parent || !parentBlobId) {
      head.chunks.forEach((_, i) => {
        if (owner[i] === null) {
          owner[i] = id!;
          meta.set(id!, commit);
        }
      });
      break;
    }
    if (walked >= limit) {
      truncated = true;
      head.chunks.forEach((_, i) => {
        if (owner[i] === null) {
          owner[i] = id!;
          meta.set(id!, commit);
        }
      });
      break;
    }
    id = parentId;
    commit = parent!;
  }

  // Merge neighbouring chunks of the same commit into ranges.
  const ranges: BlameRange[] = [];
  let offset = 0;
  head.chunks.forEach((c, i) => {
    const sha = owner[i]!;
    const last = ranges[ranges.length - 1];
    if (last && last.commit === sha) {
      last.end += c.size;
      last.chunks++;
    } else {
      const m = meta.get(sha)!;
      ranges.push({ start: offset, end: offset + c.size, chunks: 1, commit: sha, author: m.author, message: m.message, timestamp: m.timestamp });
    }
    offset += c.size;
  });
  return { path, ref, commit: headId, size: head.size, chunks: head.chunks.length, ranges, truncated };
}
