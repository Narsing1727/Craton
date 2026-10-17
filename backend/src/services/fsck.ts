// Checking the whole store: every chunk is read and decoded and must hash to its own name, every stored difference and every tile must
// make what it stands for again, every file's chunks must add up to the file's size, and every commit's Merkle root must match its
// tree. Nothing is changed; the report names what is wrong. Run `npm run fsck` (OPERATING.md) after a restore, a disk problem, or
// before and after turning on the cold tier.

import type { Ctx } from "./context.ts";
import { mapLimit, decodeAny } from "./chunks.ts";
import { verifyTiles, forgetRebuiltTiles } from "./tiles.ts";
import { codecOf } from "../core/compress.ts";
import { isPieces } from "../core/pieces.ts";
import { isRefDelta } from "../core/refdelta.ts";
import { sha256Hex } from "../core/fastcdc.ts";
import { treeMerkleRoot, type BlobObject, type CommitObject, type TreeObject } from "../core/objects.ts";

export type FsckReport = {
  chunks: { checked: number; bytes: number; missing: string[]; corrupt: string[]; wrongForm: string[] };
  bases: { checked: number; bad: string[] };
  tiles: { checked: number; bad: string[] };
  files: { checked: number; bad: string[] };
  commits: { checked: number; bad: string[] };
  ok: boolean;
};

/** `quick` skips reading any bytes: only the structure (files add up, Merkle roots match) is checked. */
export async function fsck(ctx: Ctx, opts: { quick?: boolean; concurrency?: number; progress?: (done: number, total: number) => void } = {}): Promise<FsckReport> {
  const report: FsckReport = {
    chunks: { checked: 0, bytes: 0, missing: [], corrupt: [], wrongForm: [] },
    bases: { checked: 0, bad: [] },
    tiles: { checked: 0, bad: [] },
    files: { checked: 0, bad: [] },
    commits: { checked: 0, bad: [] },
    ok: true,
  };

  const rows = ctx.db.prepare("SELECT hash, size, codec FROM chunks").all() as { hash: string; size: number; codec: string }[];
  const known = new Set(rows.map((r) => r.hash));

  // Every chunk: its bytes are there, decode, and hash to the name; the form the database says is the form the bytes are in.
  if (!opts.quick) {
    let done = 0;
    forgetRebuiltTiles();
    await mapLimit(rows, opts.concurrency ?? 4, async (row) => {
      try {
        const stored = await ctx.store.get(row.hash);
        if (!stored) report.chunks.missing.push(row.hash);
        else {
          const data = await decodeAny(ctx, row.hash, stored);
          if (sha256Hex(data) !== row.hash || data.length !== row.size) report.chunks.corrupt.push(row.hash);
          else report.chunks.bytes += data.length;
          const form = codecOf(stored);
          const says = row.codec;
          const consistent = form === says || (form !== "ref-delta" && form !== "tiles" && says !== "ref-delta" && says !== "tiles");
          if (!consistent) report.chunks.wrongForm.push(`${row.hash.slice(0, 12)}: the database says ${says}, the bytes are ${form}`);
        }
      } catch {
        report.chunks.corrupt.push(row.hash);
      }
      report.chunks.checked++;
      opts.progress?.(++done, rows.length);
    });
  } else report.chunks.checked = rows.length;

  // What stored differences and cold chunks are built on.
  const refs = ctx.db.prepare("SELECT chunk_hash, ref_hash FROM chunk_refs").all() as { chunk_hash: string; ref_hash: string }[];
  for (const r of refs) {
    report.bases.checked++;
    if (!known.has(r.ref_hash)) report.bases.bad.push(`${r.chunk_hash.slice(0, 12)} is built on ${r.ref_hash.slice(0, 12)}, which is not stored`);
    else if (!opts.quick) {
      const base = await ctx.store.get(r.ref_hash);
      if (base && (isRefDelta(base) || isPieces(base))) report.bases.bad.push(`${r.chunk_hash.slice(0, 12)} is built on ${r.ref_hash.slice(0, 12)}, which is itself stored as a difference or in pieces`);
    }
  }
  const tileRows = ctx.db.prepare("SELECT key FROM tiles").all() as { key: string }[];
  const tileKeys = new Set(tileRows.map((t) => t.key));
  for (const m of ctx.db.prepare("SELECT chunk_hash, tile_key FROM chunk_tiles").all() as { chunk_hash: string; tile_key: string }[]) {
    if (!tileKeys.has(m.tile_key)) report.tiles.bad.push(`chunk ${m.chunk_hash.slice(0, 12)} needs tile ${m.tile_key.slice(0, 12)}, which is not stored`);
  }
  if (!opts.quick) {
    const t = await verifyTiles(ctx);
    report.tiles.checked = t.checked;
    report.tiles.bad.push(...t.bad.map((k) => `tile ${k.slice(0, 12)} does not make its original stream again`));
  } else report.tiles.checked = tileRows.length;

  // Every file (blob): its chunks are all stored, in sizes that add up to the file's.
  const blobs = ctx.db.prepare("SELECT o.id, o.body FROM objects o WHERE o.type = 'blob'").all() as { id: string; body: string }[];
  for (const b of blobs) {
    report.files.checked++;
    try {
      const blob = JSON.parse(b.body) as BlobObject;
      const total = blob.chunks.reduce((n, c) => n + c.size, 0);
      const missing = blob.chunks.filter((c) => !known.has(c.hash));
      if (total !== blob.size) report.files.bad.push(`${b.id.slice(0, 12)}: its chunks add up to ${total} bytes, the file says ${blob.size}`);
      else if (missing.length) report.files.bad.push(`${b.id.slice(0, 12)}: ${missing.length} of its chunks are not stored`);
    } catch {
      report.files.bad.push(`${b.id.slice(0, 12)}: its record cannot be read`);
    }
  }

  // Every commit: the Merkle root over its tree.
  const objects = new Map((ctx.db.prepare("SELECT id, type, body FROM objects WHERE type IN ('tree', 'commit')").all() as { id: string; type: string; body: string }[]).map((o) => [o.id, o]));
  for (const o of objects.values()) {
    if (o.type !== "commit") continue;
    report.commits.checked++;
    try {
      const commit = JSON.parse(o.body) as CommitObject;
      const tree = objects.get(commit.tree);
      if (!tree) report.commits.bad.push(`${o.id.slice(0, 12)}: its tree is not stored`);
      else if (treeMerkleRoot(JSON.parse(tree.body) as TreeObject) !== commit.merkleRoot) report.commits.bad.push(`${o.id.slice(0, 12)}: its Merkle root does not match its tree`);
    } catch {
      report.commits.bad.push(`${o.id.slice(0, 12)}: its record cannot be read`);
    }
  }

  report.ok = [report.chunks.missing, report.chunks.corrupt, report.chunks.wrongForm, report.bases.bad, report.tiles.bad, report.files.bad, report.commits.bad].every((l) => l.length === 0);
  return report;
}
