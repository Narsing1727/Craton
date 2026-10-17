// Chunk negotiation, upload and download: where deduplication and its privacy rule live.
//
// DECISIONS.md #3: "which of these chunks do you already have?" is answered only against chunks
// the requester may see (public, plus the repository owner's scope). Answering against every chunk
// would let anyone test whether some other customer stored a given file.

import type { Ctx } from "./context.ts";
import { badRequest, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { repoScope } from "./repos.ts";
import { codecOf, compressChunk, decompressChunk, type Hint } from "../core/compress.ts";
import { decodeRefDelta, isRefDelta, refDeltaInfo } from "../core/refdelta.ts";
import { sha256Hex } from "../core/fastcdc.ts";
import type { BlobObject } from "../core/objects.ts";
import { config } from "../config.ts";

const HASH = /^[0-9a-f]{64}$/;

/** Scopes whose chunks a push to `repo` may reference without uploading them. */
export function visibleScopes(repo: Pick<RepoRow, "visibility" | "owner_id">): string[] {
  return ["public", `owner:${repo.owner_id}`, repoScope(repo)].filter((v, i, a) => a.indexOf(v) === i);
}

function inScopes(ctx: Ctx, hashes: string[], scopes: string[]): Set<string> {
  const found = new Set<string>();
  const marks = scopes.map(() => "?").join(",");
  const stmt = ctx.db.prepare(`SELECT DISTINCT hash FROM chunk_scopes WHERE hash = ? AND scope IN (${marks})`);
  for (const h of hashes) if (stmt.get(h, ...scopes)) found.add(h);
  return found;
}

/** Of `hashes`, which must the client upload before it can push to `repo`? */
export function missingChunks(ctx: Ctx, repo: RepoRow, hashes: string[]): string[] {
  for (const h of hashes) if (!HASH.test(h)) throw badRequest(`Invalid chunk hash: ${h}`);
  const unique = [...new Set(hashes)];
  const have = inScopes(ctx, unique, visibleScopes(repo));
  return unique.filter((h) => !have.has(h));
}

/** Whether this repository can already reference the chunk (its own, its owner's, or public data). */
export function visibleToRepo(ctx: Ctx, repo: RepoRow, hash: string) {
  return inScopes(ctx, [hash], visibleScopes(repo)).has(hash);
}

/** Store one chunk after verifying its bytes hash to its claimed id. */
export async function putChunk(ctx: Ctx, repo: RepoRow, hash: string, data: Buffer, hint?: Hint) {
  if (!HASH.test(hash)) throw badRequest("Invalid chunk hash.");
  if (data.length > config.chunking.max) throw badRequest(`Chunks are at most ${config.chunking.max} bytes.`);
  if (sha256Hex(data) !== hash) throw badRequest("Chunk bytes don’t match their hash.");
  const exists = ctx.db.prepare("SELECT 1 FROM chunks WHERE hash = ?").get(hash);
  // Report dedup only against chunks this repository could already see: saying "someone else has
  // these bytes" would tell an uploader what's inside other people's private repositories.
  const deduplicated = visibleToRepo(ctx, repo, hash);
  let storedSize = 0;
  if (!exists) {
    // First time anyone uploads these bytes: compress (verified lossless) and store them.
    const { stored, codec } = compressChunk(data, hash, hint);
    storedSize = stored.length;
    await ctx.store.put(hash, stored);
    ctx.db.prepare("INSERT OR IGNORE INTO chunks (hash, size, stored_size, codec) VALUES (?, ?, ?, ?)").run(hash, data.length, stored.length, codec);
  }
  // The client proved it has the bytes, so it may now reference the chunk from this repository.
  ctx.db.prepare("INSERT OR IGNORE INTO chunk_scopes (hash, scope) VALUES (?, ?)").run(hash, repoScope(repo));
  return { hash, size: data.length, deduplicated, storedSize: exists ? null : storedSize };
}

/** How many chunk puts run at once: the setting, else 8 for local disk and 24 for an object store. */
export function storeConcurrency(ctx: Ctx): number {
  return config.storeConcurrency.override || (ctx.store.kind === "local-disk" || ctx.store.kind === "memory" ? 8 : 24);
}

/**
 * Run `fn` over `items` with at most `limit` in flight, results in the order of `items`. An object store answers a put
 * in tens of milliseconds, so storing a few hundred chunks one after another is seconds of waiting that overlapping
 * them removes; the first failure stops starting new work and is thrown.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  let failed: unknown = null;
  const worker = async () => {
    while (failed === null) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        failed = err ?? new Error("failed");
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed !== null) throw failed;
  return out;
}

/**
 * A chunk the client already encoded (the first byte names the encoding, as in storage). The bytes are decoded within the
 * size limit and re-hashed: the server never stores something it has not seen to be exactly the chunk its hash names.
 * When the chunk is already known the encoded bytes are not used.
 */
export async function putStored(ctx: Ctx, repo: RepoRow, hash: string, stored: Buffer) {
  if (!HASH.test(hash)) throw badRequest("Invalid chunk hash.");
  const codec = codecOf(stored);
  if (!codec) throw badRequest("Unknown chunk encoding.");
  let data: Buffer;
  try {
    data = decompressChunk(stored, config.chunking.max);
  } catch {
    throw badRequest(`Chunk ${hash.slice(0, 12)} could not be decoded, or is larger than ${config.chunking.max} bytes.`);
  }
  if (sha256Hex(data) !== hash) throw badRequest("Chunk bytes don’t match their hash.");
  const exists = ctx.db.prepare("SELECT 1 FROM chunks WHERE hash = ?").get(hash);
  const deduplicated = visibleToRepo(ctx, repo, hash);
  if (!exists) {
    await ctx.store.put(hash, stored);
    ctx.db.prepare("INSERT OR IGNORE INTO chunks (hash, size, stored_size, codec) VALUES (?, ?, ?, ?)").run(hash, data.length, stored.length, codec);
  }
  ctx.db.prepare("INSERT OR IGNORE INTO chunk_scopes (hash, scope) VALUES (?, ?)").run(hash, repoScope(repo));
  return { hash, size: data.length, deduplicated };
}

/** Raw bytes of a chunk, if `repo` may reference it. */
export async function getChunk(ctx: Ctx, repo: RepoRow, hash: string): Promise<Buffer> {
  if (!HASH.test(hash)) throw badRequest("Invalid chunk hash.");
  const allowed = ctx.db.prepare("SELECT 1 FROM repo_chunks WHERE repo_id = ? AND hash = ?").get(repo.id, hash);
  if (!allowed) throw notFound("Chunk");
  return readChunk(ctx, hash);
}

/** A chunk as stored (first byte = encoding), if `repo` may reference it; the client decodes and verifies it. */
export async function getStoredChunk(ctx: Ctx, repo: RepoRow, hash: string): Promise<Buffer> {
  if (!HASH.test(hash)) throw badRequest("Invalid chunk hash.");
  const allowed = ctx.db.prepare("SELECT 1 FROM repo_chunks WHERE repo_id = ? AND hash = ?").get(repo.id, hash);
  if (!allowed) throw notFound("Chunk");
  const stored = await ctx.store.get(hash);
  if (!stored) throw notFound("Chunk bytes");
  // A chunk kept as a difference is only readable next to the chunks it is a difference from, which a client does not
  // have: send it in an encoding that stands alone.
  if (isRefDelta(stored)) {
    const data = await decodeStored(ctx, hash, stored);
    return compressChunk(data, hash, { kind: "numeric", width: refDeltaInfo(stored).width }).stored;
  }
  return stored;
}

/** The chunk a stored difference stands for: the chunks it names are read (they are always whole chunks), then the difference is applied. */
async function decodeStored(ctx: Ctx, hash: string, stored: Buffer): Promise<Buffer> {
  const info = refDeltaInfo(stored);
  const parts: Buffer[] = [];
  for (const r of info.refs) {
    const base = await ctx.store.get(r.hash);
    if (!base) throw notFound(`Chunk bytes (a base of ${hash.slice(0, 12)})`);
    if (isRefDelta(base)) throw new Error(`Stored chunk ${hash} is built on ${r.hash}, which is itself a difference`);
    const whole = decompressChunk(base);
    if (sha256Hex(whole) !== r.hash) throw new Error(`Stored chunk ${r.hash} is corrupt`);
    parts.push(whole.subarray(r.from, r.to));
  }
  return decodeRefDelta(stored, Buffer.concat(parts));
}

export async function readChunk(ctx: Ctx, hash: string): Promise<Buffer> {
  const stored = await ctx.store.get(hash);
  if (!stored) throw notFound("Chunk bytes");
  const data = isRefDelta(stored) ? await decodeStored(ctx, hash, stored) : decompressChunk(stored);
  if (sha256Hex(data) !== hash) throw new Error(`Stored chunk ${hash} is corrupt`);
  return data;
}

/** Re-export for the repack service: decode a stored difference. */
export { decodeStored };

/** Random access into a stored file without reassembling all of it (used by the checks runner). */
export class BlobReader {
  private readonly ctx: Ctx;
  private readonly blob: BlobObject;
  private readonly starts: number[];
  private readonly cache = new Map<number, Buffer>();

  constructor(ctx: Ctx, blob: BlobObject) {
    this.ctx = ctx;
    this.blob = blob;
    this.starts = [];
    let offset = 0;
    for (const c of blob.chunks) {
      this.starts.push(offset);
      offset += c.size;
    }
  }

  get size() {
    return this.blob.size;
  }

  private async chunkAt(i: number) {
    let buf = this.cache.get(i);
    if (!buf) {
      buf = await readChunk(this.ctx, this.blob.chunks[i].hash);
      this.cache.set(i, buf);
    }
    return buf;
  }

  async read(offset: number, length: number): Promise<Buffer> {
    const end = Math.min(offset + length, this.blob.size);
    if (offset >= end) return Buffer.alloc(0);
    const parts: Buffer[] = [];
    // Find the first chunk containing `offset` (binary search on chunk start offsets).
    let lo = 0, hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    for (let i = lo; i < this.blob.chunks.length && this.starts[i] < end; i++) {
      const buf = await this.chunkAt(i);
      const from = Math.max(offset, this.starts[i]) - this.starts[i];
      const to = Math.min(end, this.starts[i] + buf.length) - this.starts[i];
      parts.push(buf.subarray(from, to));
    }
    return Buffer.concat(parts);
  }

  async readAll(): Promise<Buffer> {
    return this.read(0, this.blob.size);
  }
}
