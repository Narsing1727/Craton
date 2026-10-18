// Making a DEFLATE stream again, byte for byte. GeoTIFF tiles are compressed with zlib; given the pixels and the settings the
// writer used, zlib produces the same bytes every time. So a tile can be kept as its pixels (smaller, and comparable with another
// version of the tile) plus those settings, and the original stream rebuilt exactly when it is wanted.
//
// This only works with the same compressor, so it is pinned: `pako` 2.1.0 is a plain JavaScript port of zlib 1.2.x and behaves
// identically on every machine, which Node's own zlib (Chromium's tuned fork) does not. Measured on real files: it rebuilt every
// tile of Copernicus DEMs, PROJ geoid grids and GDAL 3.10 output (research/storage/README.md). Files written by compressors it
// does not match (libdeflate, for one) are simply not recoded: a tile is only kept as pixels after it has been rebuilt and
// compared with the original stream.

import zlib from "node:zlib";
import pako from "pako";

export type DeflateParams = { level: number; memLevel: 8 | 9; strategy: 0 | 1 };

/** The compressed bytes of `raw` with these settings (a zlib stream, as TIFF's "Adobe deflate" uses). */
export function deflateWith(raw: Uint8Array, p: DeflateParams): Buffer {
  const out = pako.deflate(raw, { level: p.level as 1, memLevel: p.memLevel, strategy: p.strategy, windowBits: 15 });
  return Buffer.from(out.buffer, out.byteOffset, out.byteLength);
}

/** The most a single tile or chunk may decompress to. Real tiles are a few megabytes; a stream of a few kilobytes that claims a gigabyte is an attack on the server's memory, and is left as uploaded. */
export const MAX_INFLATED = 128 * 1024 * 1024;

/** The bytes a zlib stream decompresses to, or null when it is not one, is larger than `MAX_INFLATED`, or has anything after its end. */
export function inflateExact(stream: Buffer): Buffer | null {
  if (stream.length < 6 || (stream[0] & 0x0f) !== 8 || ((stream[0] << 8) | stream[1]) % 31 !== 0 || (stream[1] & 0x20) !== 0) return null;
  try {
    return zlib.inflateSync(stream, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: MAX_INFLATED });
  } catch {
    return null;
  }
}

/** The settings worth trying for a stream, most likely first: the header names the effort class the writer asked for. */
function candidates(stream: Buffer, preferred?: DeflateParams): DeflateParams[] {
  const classOf = stream[1] >> 6; // 0: fastest, 1: fast, 2: default, 3: maximum
  const levels = classOf === 0 ? [1] : classOf === 1 ? [5, 4, 3, 2] : classOf === 2 ? [6] : [9, 8, 7];
  const out: DeflateParams[] = [];
  const add = (p: DeflateParams) => {
    if (!out.some((q) => q.level === p.level && q.memLevel === p.memLevel && q.strategy === p.strategy)) out.push(p);
  };
  if (preferred) add(preferred);
  for (const level of levels) for (const memLevel of [8, 9] as const) add({ level, memLevel, strategy: 0 });
  add({ level: levels[0], memLevel: 8, strategy: 1 });
  return out;
}

/**
 * The settings that make `raw` compress to exactly `stream`, or null. `preferred` (what the previous tile of the same file
 * used) is tried first, so a whole file usually costs one attempt per tile; `attempts` bounds the search for a tile that
 * matches nothing.
 */
export function findParams(stream: Buffer, raw: Uint8Array, preferred?: DeflateParams, attempts = 4): DeflateParams | null {
  for (const p of candidates(stream, preferred).slice(0, attempts)) {
    const again = deflateWith(raw, p);
    if (again.length === stream.length && again.equals(stream)) return p;
  }
  return null;
}
