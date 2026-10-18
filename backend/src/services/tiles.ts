// Tiles of the cold tier: each kept once as its pixels (core/tilepayload.ts), found by the hash of the compressed stream it
// stands for, and made into that exact stream again when a chunk that contains part of it is read.
//
// The key is a hash of the stream with a fixed prefix, so a tile can never have the same name as a chunk (a chunk can be exactly
// one tile's bytes). The key is also how a rebuilt stream is checked: rebuilt wrongly, it would not hash to its own name.

import { createHash } from "node:crypto";
import type { Ctx } from "./context.ts";
import { notFound } from "./context.ts";
import { deflateAsync } from "./deflatepool.ts";
import { decodeTile, tileInfo, type TileInfo } from "../core/tilepayload.ts";
import { config } from "../config.ts";

export const tileKeyOf = (stream: Uint8Array) => createHash("sha256").update("craton-tile\0").update(stream).digest("hex");

/** Recently rebuilt streams, newest last; the oldest go first when the total passes the limit. A big file is read tile after tile, so this is what makes reading it cost one rebuild per tile and not one per chunk. */
class StreamCache {
  private readonly map = new Map<string, Buffer>();
  private bytes = 0;
  get(key: string) {
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit);
    }
    return hit;
  }
  set(key: string, stream: Buffer) {
    if (stream.length > config.recode.cacheBytes / 2 || this.map.has(key)) return;
    this.map.set(key, stream);
    this.bytes += stream.length;
    for (const [k, v] of this.map) {
      if (this.bytes <= config.recode.cacheBytes) break;
      this.map.delete(k);
      this.bytes -= v.length;
    }
  }
  clear() {
    this.map.clear();
    this.bytes = 0;
  }
}
const cache = new StreamCache();
const inFlight = new Map<string, Promise<Buffer>>();
const stats = { rebuilt: 0, readAhead: 0 };

/** How many tiles were made again, and how many of those were started before anyone asked for them (diagnostics, tests). */
export const tileStats = () => ({ ...stats });
export const resetTileStats = () => ((stats.rebuilt = 0), (stats.readAhead = 0));

/**
 * Reading a file from the start asks for its tiles one after another, and each takes a good part of a second to make again.
 * When a tile is asked for right after the one before it in the same file, the next few are started at once, so the worker
 * threads work in parallel and the reader finds them ready. A tile asked for out of order (a range from the middle) starts nothing.
 */
const lastAsked = new Map<string, number>();
const READ_AHEAD = 3;
const placeOf = new Map<string, { blob_id: string; image: number; idx: number } | null>();
function readAhead(ctx: Ctx, key: string) {
  let here = placeOf.get(key);
  if (here === undefined) {
    here = (ctx.db.prepare("SELECT blob_id, image, idx FROM blob_tiles WHERE tile_key = ? AND image >= 0 LIMIT 1").get(key) as { blob_id: string; image: number; idx: number } | undefined) ?? null;
    placeOf.set(key, here);
    if (placeOf.size > 4096) placeOf.delete(placeOf.keys().next().value!);
  }
  if (!here) return;
  const id = `${here.blob_id}:${here.image}`;
  const previous = lastAsked.get(id);
  if (previous === here.idx) return; // another chunk of the tile already being read
  lastAsked.delete(id);
  lastAsked.set(id, here.idx);
  if (lastAsked.size > 256) lastAsked.delete(lastAsked.keys().next().value!);
  if (!(previous === here.idx - 1 || (previous === undefined && here.idx === 0))) return;
  const next = ctx.db.prepare("SELECT tile_key FROM blob_tiles WHERE blob_id = ? AND image = ? AND idx > ? ORDER BY idx LIMIT ?").all(here.blob_id, here.image, here.idx, READ_AHEAD) as { tile_key: string }[];
  for (const n of next) {
    if (cache.get(n.tile_key) || inFlight.has(n.tile_key)) continue;
    stats.readAhead++;
    void tileStream(ctx, n.tile_key, true).catch(() => undefined);
  }
}

export const forgetRebuiltTiles = () => cache.clear();

/** A tile's pixels, and how it was stored. A difference is made from the whole tile it names; that one is never itself a difference. */
export async function tilePixels(ctx: Ctx, key: string): Promise<{ raw: Buffer; info: TileInfo }> {
  const payload = await ctx.store.get(key);
  if (!payload) throw notFound(`Tile ${key.slice(0, 12)}`);
  const info = tileInfo(payload);
  if (info.kind === 1) return { raw: decodeTile(payload), info };
  const base = await ctx.store.get(info.baseKey!);
  if (!base) throw notFound(`Tile ${info.baseKey!.slice(0, 12)} (the base of ${key.slice(0, 12)})`);
  if (tileInfo(base).kind !== 1) throw new Error(`Stored tile ${key} is built on ${info.baseKey}, which is itself a difference`);
  return { raw: decodeTile(payload, decodeTile(base)), info };
}

/** The original compressed stream of a tile, made again from its pixels and checked against its own name. */
export function tileStream(ctx: Ctx, key: string, ahead = false): Promise<Buffer> {
  if (!ahead) readAhead(ctx, key);
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    stats.rebuilt++;
    const { raw, info } = await tilePixels(ctx, key);
    const stream = await deflateAsync(raw, info.params);
    if (stream.length !== info.streamLength || tileKeyOf(stream) !== key) throw new Error(`Stored tile ${key} is corrupt: it does not make its original stream again`);
    cache.set(key, stream);
    return stream;
  })().finally(() => inFlight.delete(key));
  inFlight.set(key, job);
  return job;
}

/** Keep a tile (idempotent: a tile already stored is left as it is). */
export async function saveTile(ctx: Ctx, key: string, payload: Buffer, info: TileInfo) {
  if (ctx.db.prepare("SELECT 1 FROM tiles WHERE key = ?").get(key)) return false;
  await ctx.store.put(key, payload);
  ctx.db.prepare("INSERT OR IGNORE INTO tiles (key, stream_len, raw_len, stored_size, kind, base_key) VALUES (?, ?, ?, ?, ?, ?)").run(key, info.streamLength, info.rawLength, payload.length, info.kind, info.baseKey);
  return true;
}

/** Make every stored tile's stream again and check it (used by the operator command and tests). */
export async function verifyTiles(ctx: Ctx): Promise<{ checked: number; bad: string[] }> {
  const rows = ctx.db.prepare("SELECT key FROM tiles").all() as { key: string }[];
  const bad: string[] = [];
  for (const { key } of rows) {
    try {
      cache.clear();
      await tileStream(ctx, key);
    } catch {
      bad.push(key);
    }
  }
  return { checked: rows.length, bad };
}
