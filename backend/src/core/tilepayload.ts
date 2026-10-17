// A tile kept as its pixels. The cold storage tier (services/recode.ts) keeps each DEFLATE tile of a GeoTIFF as what it
// decompresses to, shuffled and compressed with zstd (about 28% smaller than the DEFLATE it came from), together with the zlib
// settings that make the original stream again (core/rezip.ts). A later version of the same tile can be kept as its
// difference from an earlier one that is whole, which for a datum shift or a smooth recalibration is a few percent.
//
//   0xC1, version(1), kind(1 whole, 2 difference), level, memLevel-8 | strategy<<1, width, rawLength u32, streamLength u32,
//   [kind 2: baseKey(32), mode(1)], zstd(body)
//
// `width` is the byte width of one sample (1 when the bytes are not plain samples: a predictor was applied, or 8-bit data).
// `shuffled` (bit 2 of the settings byte) says the decompressed bytes are already byte-shuffled by `width`, as HDF5's shuffle filter
// leaves them; a difference is then taken between the samples themselves (unshuffled), which is what makes it small.

import zlib from "node:zlib";
import { shuffle, unshuffle } from "./compress.ts";
import { differenceBytes, reconstructBytes } from "./refdelta.ts";
import type { DeflateParams } from "./rezip.ts";

export const TILE_MAGIC = 0xc1;
const VERSION = 1;
const HEADER = 14;

export type TileWidth = 1 | 2 | 4 | 8;
export type TileInfo = { kind: 1 | 2; params: DeflateParams; width: TileWidth; shuffled: boolean; rawLength: number; streamLength: number; baseKey: string | null; mode: 0 | 1 };

const zstd = (data: Uint8Array, level = 9) => zlib.zstdCompressSync(data, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });

function header(kind: 1 | 2, params: DeflateParams, width: TileWidth, shuffled: boolean, rawLength: number, streamLength: number): Buffer {
  const h = Buffer.alloc(HEADER);
  h[0] = TILE_MAGIC;
  h[1] = VERSION;
  h[2] = kind;
  h[3] = params.level;
  h[4] = (params.memLevel - 8) | (params.strategy << 1) | (shuffled ? 4 : 0);
  h[5] = width;
  h.writeUInt32LE(rawLength, 6);
  h.writeUInt32LE(streamLength, 10);
  return h;
}

/** The pixels as a whole payload. */
export function encodeWhole(raw: Buffer, params: DeflateParams, width: TileWidth, streamLength: number, shuffled = false): Buffer {
  const body = zstd(width > 1 && !shuffled ? shuffle(raw, width) : raw);
  return Buffer.concat([header(1, params, width, shuffled && width > 1, raw.length, streamLength), body]);
}

/** The pixels as their difference from `baseRaw` (an earlier version of this tile, same size), or null when that is not smaller than `mustBeBelow`. */
export function encodeDifference(raw: Buffer, params: DeflateParams, width: TileWidth, streamLength: number, base: { key: string; raw: Buffer }, mustBeBelow: number, shuffled = false): Buffer | null {
  if (width === 1 || base.raw.length !== raw.length) return null;
  const samples = shuffled ? unshuffle(raw, width) : raw;
  const baseSamples = shuffled ? unshuffle(base.raw, width) : base.raw;
  let best: { mode: 0 | 1; body: Buffer } | null = null;
  for (const mode of [0, 1] as const) {
    const body = zstd(differenceBytes(samples, baseSamples, { mode, width, phase: 0 }));
    if (!best || body.length < best.body.length) best = { mode, body };
  }
  const out = Buffer.concat([header(2, params, width, shuffled, raw.length, streamLength), Buffer.from(base.key, "hex"), Buffer.from([best!.mode]), best!.body]);
  return out.length < mustBeBelow ? out : null;
}

export function tileInfo(payload: Buffer): TileInfo {
  if (payload.length < HEADER || payload[0] !== TILE_MAGIC) throw new Error("Not a stored tile");
  if (payload[1] !== VERSION) throw new Error(`Unknown stored-tile version ${payload[1]}`);
  const kind = payload[2];
  const width = payload[5];
  if ((kind !== 1 && kind !== 2) || ![1, 2, 4, 8].includes(width)) throw new Error("Damaged stored tile");
  if (kind === 2 && payload.length < HEADER + 33) throw new Error("Damaged stored tile");
  return {
    kind,
    params: { level: payload[3], memLevel: ((payload[4] & 1) + 8) as 8 | 9, strategy: ((payload[4] >> 1) & 1) as 0 | 1 },
    width: width as TileWidth,
    shuffled: (payload[4] & 4) !== 0,
    rawLength: payload.readUInt32LE(6),
    streamLength: payload.readUInt32LE(10),
    baseKey: kind === 2 ? payload.subarray(HEADER, HEADER + 32).toString("hex") : null,
    mode: kind === 2 ? ((payload[HEADER + 32] & 1) as 0 | 1) : 0,
  };
}

/** The pixels back. A difference needs the pixels of its base (`tileInfo(payload).baseKey`). */
export function decodeTile(payload: Buffer, baseRaw?: Buffer): Buffer {
  const info = tileInfo(payload);
  const body = payload.subarray(info.kind === 2 ? HEADER + 33 : HEADER);
  const bytes = zlib.zstdDecompressSync(body, { maxOutputLength: info.rawLength });
  if (bytes.length !== info.rawLength) throw new Error("Damaged stored tile");
  if (info.kind === 1) return info.width > 1 && !info.shuffled ? unshuffle(bytes, info.width) : bytes;
  if (!baseRaw || baseRaw.length !== info.rawLength) throw new Error("A stored difference needs the tile it is a difference from");
  const samples = reconstructBytes(bytes, info.shuffled ? unshuffle(baseRaw, info.width) : baseRaw, { mode: info.mode, width: info.width as 2 | 4 | 8, phase: 0 });
  return info.shuffled ? shuffle(samples, info.width) : samples;
}
