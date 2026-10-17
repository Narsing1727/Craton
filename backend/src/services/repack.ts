// Storing what changed as a difference. When a new version of a numeric raster is committed, each of its new chunks that
// has no twin in earlier versions is compared with the bytes at the same place in the nearest earlier version that can
// serve as a base (a few commits back at most); if the
// difference is much smaller (a datum shift, a smooth recalibration: every value moved, none by much), the chunk is
// stored as that difference (encoding 10, core/refdelta.ts) and the earlier, larger form is replaced.
//
// It never changes what anyone downloads: before a chunk is replaced the new form is decoded and must hash to the chunk's
// own SHA-256, and a client is always sent a chunk in an encoding that stands alone. It runs after a branch moves, off the
// request, one commit at a time; a failure leaves the chunk as it was. Run `npm run repack` to do it for history that
// already exists.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { branchMovedListeners, getObject } from "./history.ts";
import { BlobReader, decodeStored, readChunk } from "./chunks.ts";
import { hintForPath, tiffHint } from "../core/profile.ts";
import { decodeRefDelta, encodeRefDelta, isRefDelta, type RefSlice } from "../core/refdelta.ts";
import { sha256Hex } from "../core/fastcdc.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { config } from "../config.ts";

/** A difference is kept only if it is at most this share of the chunk's current stored size. */
const WORTH_IT = 0.7;
const SMALLEST = 4096;
const MAX_REFS = 4;
/** How many earlier commits are searched for a version that can be a base. */
const LOOK_BACK = 6;

export type RepackResult = { files: number; chunks: number; savedBytes: number };

/** What the element width of a file is when it is a plain little-endian numeric raster, else null. */
async function elementWidth(path: string, blob: BlobObject, ctx: Ctx): Promise<2 | 4 | 8 | null> {
  const named = hintForPath(path);
  if (named.kind === "numeric") return named.bigEndian ? null : named.width;
  if (!/\.tiff?$/i.test(path)) return null;
  const head = await new BlobReader(ctx, blob).read(0, Math.min(blob.size, 1 << 20));
  const hint = tiffHint((offset, length) => (offset + length <= head.length ? head.subarray(offset, offset + length) : null));
  if (hint?.kind !== "numeric" || hint.bigEndian || head.subarray(0, 2).toString("latin1") !== "II") return null;
  return hint.width;
}

/** Repack the chunks that `commitId` adds to the files it changes. With `apply: false` it only measures. */
export async function repackCommit(ctx: Ctx, repo: RepoRow, commitId: string, opts: { apply?: boolean } = {}): Promise<RepackResult> {
  const apply = opts.apply ?? true;
  const result: RepackResult = { files: 0, chunks: 0, savedBytes: 0 };
  const commit = getObject<CommitObject>(ctx, repo, commitId, "commit");
  if (!commit.parents.length) return result;
  const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
  // The earlier versions of each file, nearest first: the parent's, then its parent's, and so on a few steps back. A
  // version whose chunks are themselves stored as differences cannot be a base, so a later one may use an earlier one.
  const trees = new Map<string, Map<string, string>>();
  const entriesAt = (id: string) => {
    let m = trees.get(id);
    if (!m) trees.set(id, (m = new Map(getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, id, "commit").tree, "tree").entries.map((e) => [e.path, e.blob]))));
    return m;
  };
  const ancestors: string[] = [];
  for (let id: string | undefined = commit.parents[0]; id && ancestors.length < LOOK_BACK; id = getObject<CommitObject>(ctx, repo, id, "commit").parents[0]) ancestors.push(id);
  const row = ctx.db.prepare("SELECT codec, stored_size FROM chunks WHERE hash = ?");
  const isBase = ctx.db.prepare("SELECT 1 FROM chunk_refs WHERE ref_hash = ?");

  for (const entry of tree.entries) {
    const blob = getObject<BlobObject>(ctx, repo, entry.blob, "blob");
    const olderIds = [...new Set(ancestors.map((id) => entriesAt(id).get(entry.path)).filter((id): id is string => Boolean(id) && id !== entry.blob))];
    if (!olderIds.length || !blob.size) continue;
    const olders: { blob: BlobObject; starts: number[] }[] = [];
    for (const id of olderIds) {
      try {
        const old = getObject<BlobObject>(ctx, repo, id, "blob");
        if (!old.size) continue;
        const starts: number[] = [];
        let at = 0;
        for (const c of old.chunks) (starts.push(at), (at += c.size));
        olders.push({ blob: old, starts });
      } catch {
        // An earlier version that is no longer in this repository cannot be a base.
      }
    }
    if (!olders.length) continue;
    const width = await elementWidth(entry.path, blob, ctx);
    if (!width) continue;

    const known = new Set(olders.flatMap((o) => o.blob.chunks.map((c) => c.hash)));
    let touched = false;
    let offset = 0;
    for (const c of blob.chunks) {
      const start = offset;
      offset += c.size;
      if (known.has(c.hash)) continue;
      const stored = row.get(c.hash) as { codec: string; stored_size: number } | undefined;
      // Only whole chunks become differences, and a chunk another difference is built on stays whole.
      if (!stored || stored.codec === "ref-delta" || stored.codec === "tiles" || stored.codec === "none" || stored.stored_size < SMALLEST || isBase.get(c.hash)) continue;

      let data: Buffer | null = null;
      for (const { blob: old, starts } of olders) {
        if (start >= old.size) continue;
        // That version's bytes at the same place, as slices of its chunks (all whole chunks).
        const end = Math.min(start + c.size, old.size);
        const refs: RefSlice[] = [];
        let usable = true;
        for (let i = 0; i < old.chunks.length && usable; i++) {
          const from = Math.max(start, starts[i]);
          const to = Math.min(end, starts[i] + old.chunks[i].size);
          if (to <= from) continue;
          const kind = (row.get(old.chunks[i].hash) as { codec: string } | undefined)?.codec;
          if (!kind || kind === "ref-delta" || kind === "tiles" || refs.length >= MAX_REFS) usable = false;
          else refs.push({ hash: old.chunks[i].hash, from: from - starts[i], to: to - starts[i] });
        }
        if (!usable || !refs.length) continue;

        data ??= await readChunk(ctx, c.hash);
        const parts: Buffer[] = [];
        for (const r of refs) parts.push((await readChunk(ctx, r.hash)).subarray(r.from, r.to));
        const refBytes = Buffer.concat(parts);
        const next = encodeRefDelta(data, refBytes, refs, width, start, Math.floor(stored.stored_size * WORTH_IT));
        if (!next) continue;
        // The new form must give back exactly this chunk, or nothing changes.
        if (sha256Hex(decodeRefDelta(next, refBytes)) !== c.hash) continue;

        result.chunks++;
        result.savedBytes += stored.stored_size - next.length;
        touched = true;
        if (apply) {
          for (const r of refs) ctx.db.prepare("INSERT OR IGNORE INTO chunk_refs (chunk_hash, ref_hash) VALUES (?, ?)").run(c.hash, r.hash);
          await ctx.store.replace(c.hash, next);
          ctx.db.prepare("UPDATE chunks SET stored_size = ?, codec = 'ref-delta' WHERE hash = ?").run(next.length, c.hash);
        }
        break;
      }
    }
    if (touched) result.files++;
  }
  return result;
}

/** Every commit of a repository, oldest first (each one is compared with its own first parent). */
export async function repackRepository(ctx: Ctx, repo: RepoRow, opts: { apply?: boolean } = {}): Promise<RepackResult> {
  const total: RepackResult = { files: 0, chunks: 0, savedBytes: 0 };
  const ids = ctx.db.prepare("SELECT id FROM commits WHERE repo_id = ? ORDER BY timestamp, id").all(repo.id) as { id: string }[];
  for (const { id } of ids) {
    const r = await repackCommit(ctx, repo, id, opts);
    total.files += r.files;
    total.chunks += r.chunks;
    total.savedBytes += r.savedBytes;
  }
  return total;
}

/** Verify that every chunk stored as a difference still decodes to its own hash (used by `craton doctor`-style checks and tests). */
export async function verifyDifferences(ctx: Ctx): Promise<{ checked: number; bad: string[] }> {
  const rows = ctx.db.prepare("SELECT hash FROM chunks WHERE codec = 'ref-delta'").all() as { hash: string }[];
  const bad: string[] = [];
  for (const { hash } of rows) {
    try {
      const stored = await ctx.store.get(hash);
      if (!stored || !isRefDelta(stored) || sha256Hex(await decodeStored(ctx, hash, stored)) !== hash) bad.push(hash);
    } catch {
      bad.push(hash);
    }
  }
  return { checked: rows.length, bad };
}

// After a branch moves, tidy the new commit's chunks off the request, one commit at a time.
let queue: Promise<unknown> = Promise.resolve();
/** Storage tidying runs one job at a time (a chunk must not be rewritten while another job reads it as a base); a failed job leaves the chunks as they were. */
export function enqueue(job: () => Promise<unknown>) {
  queue = queue.then(job).catch(() => undefined);
  return queue;
}
branchMovedListeners.push((ctx, repo, commit) => {
  if (!config.repack.auto) return;
  void enqueue(() => repackCommit(ctx, repo, commit));
});

/** Wait for the repacking already started (tests, shutdown). */
export const repackIdle = () => queue.then(() => undefined);
