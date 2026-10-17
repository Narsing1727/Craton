// The cold tier for DEFLATE GeoTIFFs. A tile compressed with DEFLATE is incompressible and shares nothing with a slightly
// different version of itself. Kept as its pixels (and the zlib settings that made its stream) it is about 28% smaller, and a
// later version of it can be kept as the difference from an earlier one: a datum shift or a smooth recalibration then costs a
// few percent of a new copy (research/storage/README.md: 4 versions of a real DEM, 122 MB stored today, 31 MB this way).
//
// Nothing about what anyone downloads changes. A tile is only kept as pixels after its stream has been made again from them and
// compared byte for byte with the original; a chunk is only rewritten after it has been put back together from its pieces and
// hashed to its own SHA-256; and the original bytes are made again whenever a chunk is read. The price is CPU on reading an old
// version (tiles are compressed again, off the main thread, and kept in a cache for the chunks that follow), so this is only done
// for versions that are no longer the tip of any branch or any tag, and only when the operator turns it on (CRATON_RECODE=1) or
// runs `npm run recode`.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { branchMovedListeners, getObject } from "./history.ts";
import { enqueue } from "./repack.ts";
import { readChunk } from "./chunks.ts";
import { saveTile, tileKeyOf, tilePixels } from "./tiles.ts";
import { compressedSegments } from "../core/streams.ts";
import type { Segment } from "../core/tiff.ts";
import { findParams, inflateExact, type DeflateParams } from "../core/rezip.ts";
import { decodeTile, encodeDifference, encodeWhole, tileInfo, type TileWidth } from "../core/tilepayload.ts";
import { decodePieces, encodePieces, type Piece } from "../core/pieces.ts";
import { sha256Hex } from "../core/fastcdc.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { config } from "../config.ts";

/** A tile is kept as pixels only if that is at most this share of its compressed stream. */
const TILE_WORTH = 0.95;
/** A chunk is rewritten only if it then takes at most this share of what it took (its own bytes plus its share of the tiles). */
const CHUNK_WORTH = 0.9;
/** Pixels alone may be a little bigger than the stream (noisy floating point); they are kept anyway when the next cold version's tile is a tiny difference from them, and the chunks they replace are rewritten for that reason. */
const KEYFRAME_MAX = 1.15;
const KEYFRAME_NEXT_SHARE = 0.15;
const SMALLEST_FILE = 64 * 1024;
const WINDOW = 6;

export type RecodeResult = { tiles: number; reused: number; chunks: number; savedBytes: number; files: number };
const none = (): RecodeResult => ({ tiles: 0, reused: 0, chunks: 0, savedBytes: 0, files: 0 });

/** Reads a stored file in pieces, keeping the last few chunks. */
class Window {
  private readonly cache = new Map<number, Buffer>();
  private readonly starts: number[] = [];
  private readonly ctx: Ctx;
  private readonly blob: BlobObject;
  constructor(ctx: Ctx, blob: BlobObject) {
    this.ctx = ctx;
    this.blob = blob;
    let at = 0;
    for (const c of blob.chunks) (this.starts.push(at), (at += c.size));
  }
  private async chunk(i: number) {
    let b = this.cache.get(i);
    if (!b) {
      b = await readChunk(this.ctx, this.blob.chunks[i].hash);
      this.cache.set(i, b);
      if (this.cache.size > WINDOW) this.cache.delete(this.cache.keys().next().value!);
    }
    return b;
  }
  async read(offset: number, length: number): Promise<Buffer> {
    const end = Math.min(offset + length, this.blob.size);
    if (offset >= end) return Buffer.alloc(0);
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    const parts: Buffer[] = [];
    for (let i = lo; i < this.blob.chunks.length && this.starts[i] < end; i++) {
      const b = await this.chunk(i);
      parts.push(b.subarray(Math.max(offset, this.starts[i]) - this.starts[i], Math.min(end, this.starts[i] + b.length) - this.starts[i]));
    }
    return Buffer.concat(parts);
  }
}

type TileState = { key: string; stream: Buffer; payloadSize: number; ok: boolean; keyframe?: boolean };

/** Keep the DEFLATE tiles of one stored file as pixels and rewrite the chunks that contain them. `priors` are earlier versions of the same file (nearest first) that may supply a base for a difference; `hotChunks` are chunks something still read often is made of (a branch tip, a tag), which stay exactly as they were uploaded. `next` is the next cold version of the same file: a tile that is not smaller as pixels is still kept when `next`'s tile is a tiny difference from it. */
export async function recodeBlob(ctx: Ctx, repo: RepoRow, blobId: string, opts: { apply?: boolean; priors?: string[]; hotChunks?: Set<string>; next?: string } = {}): Promise<RecodeResult> {
  const apply = opts.apply ?? true;
  const result = none();
  const blob = getObject<BlobObject>(ctx, repo, blobId, "blob");
  if (blob.size < SMALLEST_FILE) return result;
  const reader = new Window(ctx, blob);
  const segments = await compressedSegments((o, l) => reader.read(o, l), blob.size);
  if (!segments?.length) return result;

  const starts: number[] = [];
  let at = 0;
  for (const c of blob.chunks) (starts.push(at), (at += c.size));
  const codecOf = ctx.db.prepare("SELECT codec, stored_size FROM chunks WHERE hash = ?");
  const isBase = ctx.db.prepare("SELECT 1 FROM chunk_refs WHERE ref_hash = ?");
  const baseRow = ctx.db.prepare("SELECT t.key AS key, t.raw_len AS raw_len FROM blob_tiles bt JOIN tiles t ON t.key = bt.tile_key WHERE bt.blob_id = ? AND bt.image = ? AND bt.idx = ? AND t.kind = 1");
  const known = ctx.db.prepare("SELECT stored_size FROM tiles WHERE key = ?");

  // The next cold version of this file, read only as far as it takes to compare one tile with this version's.
  let nextSegments: Segment[] | null | undefined;
  let nextReader: Window | null = null;
  const gainsForNext = async (seg: Segment, raw: Buffer, params: DeflateParams, width: TileWidth, shuffled: boolean): Promise<boolean> => {
    if (!opts.next || width === 1) return false;
    try {
      if (nextSegments === undefined) {
        nextReader = new Window(ctx, getObject<BlobObject>(ctx, repo, opts.next, "blob"));
        nextSegments = await compressedSegments((o, l) => nextReader!.read(o, l), getObject<BlobObject>(ctx, repo, opts.next, "blob").size);
      }
      const other = nextSegments?.find((s) => s.image === seg.image && s.index === seg.index);
      if (!other || !nextReader) return false;
      const stream = await nextReader.read(other.offset, other.count);
      const again = inflateExact(stream);
      if (!again || again.length !== raw.length) return false;
      const diff = encodeDifference(again, params, width, stream.length, { key: "0".repeat(64), raw }, stream.length * KEYFRAME_NEXT_SHARE, shuffled);
      return diff !== null;
    } catch {
      return false;
    }
  };

  const states = new Map<number, TileState>();
  let preferred: DeflateParams | undefined;
  let touched = false;

  const prepare = async (i: number): Promise<TileState> => {
    const hit = states.get(i);
    if (hit) return hit;
    const seg = segments[i];
    const stream = await reader.read(seg.offset, seg.count);
    const fail: TileState = { key: "", stream, payloadSize: 0, ok: false };
    const raw = inflateExact(stream);
    const params = raw ? findParams(stream, raw, preferred) : null;
    if (!raw || !params) return remember(i, fail);
    preferred = params;
    const key = tileKeyOf(stream);
    let keyframeFlag = false;
    const sample = seg.sampleBytes === 2 || seg.sampleBytes === 4 || seg.sampleBytes === 8;
    const width: TileWidth = (seg.shuffled || seg.predictor === 1) && sample ? (seg.sampleBytes as TileWidth) : 1;
    const shuffled = Boolean(seg.shuffled) && width > 1;
    const existing = known.get(key) as { stored_size: number } | undefined;
    let payloadSize = existing?.stored_size ?? 0;
    if (existing) result.reused++;
    else {
      let payload = encodeWhole(raw, params, width, stream.length, shuffled);
      for (const prior of opts.priors ?? []) {
        const base = baseRow.get(prior, seg.image, seg.index) as { key: string; raw_len: number } | undefined;
        if (!base || base.raw_len !== raw.length) continue;
        const diff = encodeDifference(raw, params, width, stream.length, { key: base.key, raw: (await tilePixels(ctx, base.key)).raw }, payload.length * 0.9, shuffled);
        if (diff) {
          payload = diff;
          break;
        }
      }
      if (payload.length >= stream.length * TILE_WORTH) {
        keyframeFlag = payload.length <= stream.length * KEYFRAME_MAX && (await gainsForNext(seg, raw, params, width, shuffled));
        if (!keyframeFlag) return remember(i, fail);
      }
      // The pixels must come back from what is about to be stored, or nothing is.
      const info = tileInfo(payload);
      const basePixels = info.baseKey ? (await tilePixels(ctx, info.baseKey)).raw : undefined;
      if (!decodeTile(payload, basePixels).equals(raw)) return remember(i, fail);
      if (apply) await saveTile(ctx, key, payload, info);
      payloadSize = payload.length;
      result.tiles++;
    }
    if (apply) ctx.db.prepare("INSERT OR IGNORE INTO blob_tiles (blob_id, image, idx, tile_key) VALUES (?, ?, ?, ?)").run(blobId, seg.image, seg.index, key);
    return remember(i, { key, stream, payloadSize, ok: true, keyframe: existing ? false : keyframeFlag });
  };
  const remember = (i: number, s: TileState) => (states.set(i, s), s);

  // Segments are sorted by position; the first one that ends after `offset`.
  const firstAfter = (offset: number) => {
    let lo = 0;
    let hi = segments.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].offset + segments[mid].count <= offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  for (let ci = 0; ci < blob.chunks.length; ci++) {
    const c = blob.chunks[ci];
    const start = starts[ci];
    const end = start + c.size;
    const first = firstAfter(start);
    const overlapping: number[] = [];
    for (let i = first; i < segments.length && segments[i].offset < end; i++) overlapping.push(i);
    // Tiles that end before this chunk starts are not needed again.
    for (const k of states.keys()) if (segments[k].offset + segments[k].count <= start) states.delete(k);
    if (!overlapping.length || opts.hotChunks?.has(c.hash)) continue;

    const row = codecOf.get(c.hash) as { codec: string; stored_size: number } | undefined;
    if (!row || row.codec === "tiles" || row.codec === "ref-delta" || isBase.get(c.hash)) {
      for (const i of overlapping) await prepare(i); // still record which tile of this version is which
      continue;
    }
    const prepared: TileState[] = [];
    for (const i of overlapping) prepared.push(await prepare(i));
    if (!prepared.some((s) => s.ok)) continue;

    const data = await readChunk(ctx, c.hash);
    const pieces: Piece[] = [];
    const literals: Buffer[] = [];
    let share = 0;
    let pos = start;
    const literal = (to: number) => {
      if (to <= pos) return;
      const last = pieces[pieces.length - 1];
      if (last?.kind === "literal") last.length += to - pos;
      else pieces.push({ kind: "literal", length: to - pos });
      literals.push(data.subarray(pos - start, to - start));
      pos = to;
    };
    overlapping.forEach((i, n) => {
      const seg: Segment = segments[i];
      const from = Math.max(seg.offset, start);
      const to = Math.min(seg.offset + seg.count, end);
      literal(from);
      const st = prepared[n];
      if (st.ok) {
        pieces.push({ kind: "tile", key: st.key, from: from - seg.offset, to: to - seg.offset });
        share += Math.ceil((st.payloadSize * (to - from)) / seg.count);
        pos = to;
      } else literal(to);
    });
    literal(end);
    const stored = encodePieces(pieces, Buffer.concat(literals));
    // Put together again from the original streams held here, it must be this chunk exactly.
    const streams = new Map(prepared.filter((s) => s.ok).map((s) => [s.key, s.stream]));
    const again = await decodePieces(stored, async (key) => streams.get(key)!);
    if (sha256Hex(again) !== c.hash) continue;
    const newSize = stored.length + share;
    if (newSize >= row.stored_size * (prepared.some((s) => s.keyframe) ? KEYFRAME_MAX : CHUNK_WORTH)) continue;

    result.chunks++;
    result.savedBytes += row.stored_size - newSize;
    touched = true;
    if (!apply) continue;
    for (const s of prepared) if (s.ok) ctx.db.prepare("INSERT OR IGNORE INTO chunk_tiles (chunk_hash, tile_key) VALUES (?, ?)").run(c.hash, s.key);
    await ctx.store.replace(c.hash, stored);
    ctx.db.prepare("UPDATE chunks SET stored_size = ?, codec = 'tiles' WHERE hash = ?").run(newSize, c.hash);
  }
  if (touched) result.files++;
  return result;
}

const add = (a: RecodeResult, b: RecodeResult) => {
  a.tiles += b.tiles;
  a.reused += b.reused;
  a.chunks += b.chunks;
  a.savedBytes += b.savedBytes;
  a.files += b.files;
};

/** The blobs of every branch tip and tag: the versions people read most, which stay exactly as they were uploaded (and so do the chunks they are made of, even when an old version shares them). */
function hotBlobs(ctx: Ctx, repo: RepoRow): { blobs: Set<string>; chunks: Set<string> } {
  const blobs = new Set<string>();
  const chunks = new Set<string>();
  const refs = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ?").all(repo.id) as { commit_id: string }[];
  for (const r of refs) {
    const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, r.commit_id, "commit").tree, "tree");
    for (const e of tree.entries) {
      if (blobs.has(e.blob)) continue;
      blobs.add(e.blob);
      for (const c of getObject<BlobObject>(ctx, repo, e.blob, "blob").chunks) chunks.add(c.hash);
    }
  }
  return { blobs, chunks };
}

/**
 * Recode the old versions of every TIFF in a repository. A file's versions are taken oldest first; each can be kept as a
 * difference from an earlier one that is whole. `includeHot` also recodes the tip of each branch (measuring, or a repository
 * nobody downloads from).
 */
export async function recodeRepository(ctx: Ctx, repo: RepoRow, opts: { apply?: boolean; includeHot?: boolean; force?: boolean } = {}): Promise<RecodeResult> {
  const total = none();
  const hot = opts.includeHot ? { blobs: new Set<string>(), chunks: new Set<string>() } : hotBlobs(ctx, repo);
  const versions = new Map<string, string[]>();
  const ids = ctx.db.prepare("SELECT id FROM commits WHERE repo_id = ? ORDER BY timestamp, id").all(repo.id) as { id: string }[];
  for (const { id } of ids) {
    const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, id, "commit").tree, "tree");
    for (const e of tree.entries) {
      if (!/\.(tiff?|h5|hdf5?|he5|nc4?|nc)$/i.test(e.path)) continue;
      const list = versions.get(e.path) ?? [];
      if (!list.includes(e.blob)) list.push(e.blob);
      versions.set(e.path, list);
    }
  }
  const attempted = ctx.db.prepare("SELECT 1 FROM blob_tiles WHERE blob_id = ? AND image = -1");
  for (const list of versions.values()) {
    const recoded: string[] = [];
    for (const blobId of list) {
      const seen = Boolean(attempted.get(blobId));
      if (hot.blobs.has(blobId) || (seen && !opts.force)) {
        if (seen) recoded.unshift(blobId);
        continue;
      }
      const later = list.slice(list.indexOf(blobId) + 1).find((b) => !hot.blobs.has(b));
      const r = await recodeBlob(ctx, repo, blobId, { apply: opts.apply, priors: recoded.slice(), hotChunks: hot.chunks, next: later });
      add(total, r);
      // Remember that this version was looked at, so a push does not read it again to find the same nothing.
      if (opts.apply ?? true) {
        ctx.db.prepare("INSERT OR IGNORE INTO blob_tiles (blob_id, image, idx, tile_key) VALUES (?, -1, -1, '')").run(blobId);
        recoded.unshift(blobId);
      }
    }
  }
  return total;
}

// With CRATON_RECODE=1, a push that moves a branch makes its old versions cold, one repository at a time after the answer.
branchMovedListeners.push((ctx, repo) => {
  if (!config.recode.auto) return;
  void enqueue(() => recodeRepository(ctx, repo));
});
