// Lossless compression for chunks. There is deliberately no lossy or bounded-error mode
// (design doc: engineers won't trust a DEM that was altered to save space).
//
// Every compressed chunk is decompressed and re-hashed before it is accepted, so a codec bug
// can never store bytes that don't match the chunk's SHA-256.
//
// Which encoding is used depends on what the bytes are (a `Hint`, derived from the file's name and, for TIFF, its
// header: see profile.ts). The decoder never needs the hint: the first byte of a stored chunk names the encoding.
//
//   0  raw        bytes as they are (already-compressed data: LAZ, JPEG, deflate'd TIFF tiles, ZIP…)
//   1  zstd       zstd (level 3, or 9 for text)
//   2  shuffle2   byte-shuffle with 2-byte elements, then zstd   (int16 rasters, SRTM .hgt)
//   3  shuffle4   byte-shuffle with 4-byte elements, then zstd   (float32 / int32 rasters)
//   4  shuffle8   byte-shuffle with 8-byte elements, then zstd   (float64 grids)
//   9  records    byte-shuffle with a record width stored in the encoding (two bytes), then zstd: for files made of
//                 fixed-length records (LAS point records, 34 bytes in point format 3). Measured on a real 110,000
//                 point LAS file: 1.93x with plain zstd, 3.21x shuffled by its 34-byte records.
//   5-8 delta     each element minus the one before it (as an unsigned integer, wrapping), then the byte shuffle, then
//                 zstd; for 2- and 4-byte elements in either byte order. In a smooth surface neighbouring cells differ
//                 in the low bits only, so the shuffled high bytes become long runs of zero.
//
// A byte shuffle gathers the 1st bytes of every element together, then the 2nd, and so on. In smooth numeric data the
// high bytes barely change from one cell to the next, so zstd finds long runs it cannot see in the interleaved form.
// Measured on real float32 geoid grids (uncompressed, 128 KB chunks): 2.7x became 4.3x, 1.65x became 1.9x, 4.25x
// became 6.7x; with the delta in front, 2.96x became 6.5x on a second grid and 1.67x became 2.27x on the first.
// It is lossless: the same bytes come back, only stored in a different form.

import zlib from "node:zlib";
import { sha256Hex } from "./fastcdc.ts";

export type Codec = "none" | "zstd" | "records+zstd" | "shuffle2+zstd" | "shuffle4+zstd" | "shuffle8+zstd" | "delta2+shuffle2+zstd" | "delta4+shuffle4+zstd" | "delta2be+shuffle2+zstd" | "delta4be+shuffle4+zstd";

/** What the caller knows about the bytes, so the encoder can skip attempts that cannot help. */
export type Hint =
  | { kind: "auto" }
  /** Already compressed (LAZ, JPEG, ZIP, deflate'd TIFF…): store as is, do not even try. */
  | { kind: "incompressible" }
  /** Plain text (CSV, INP, HEC-RAS text files…): a higher zstd level pays off. */
  | { kind: "text" }
  /** Fixed-width numbers (an uncompressed raster): try the byte shuffle for this element width. `bigEndian` is the byte order of the elements (TIFF "MM", SRTM .hgt); it matters for the delta. */
  | { kind: "numeric"; width: 2 | 4 | 8; bigEndian?: boolean }
  /** Fixed-length records of `width` bytes (a LAS point cloud): try the byte shuffle by record. */
  | { kind: "records"; width: number };

const RAW = 0;
const ZSTD = 1;
const SHUFFLE2 = 2;
const SHUFFLE4 = 3;
const SHUFFLE8 = 4;
const RECORDS = 9;
const DELTA2_LE = 5;
const DELTA4_LE = 6;
const DELTA2_BE = 7;
const DELTA4_BE = 8;

const CODEC_BY_KIND: Record<number, Codec> = {
  [RAW]: "none",
  [ZSTD]: "zstd",
  [SHUFFLE2]: "shuffle2+zstd",
  [SHUFFLE4]: "shuffle4+zstd",
  [SHUFFLE8]: "shuffle8+zstd",
  [RECORDS]: "records+zstd",
  [DELTA2_LE]: "delta2+shuffle2+zstd",
  [DELTA4_LE]: "delta4+shuffle4+zstd",
  [DELTA2_BE]: "delta2be+shuffle2+zstd",
  [DELTA4_BE]: "delta4be+shuffle4+zstd",
};
/** Delta kinds: element width and byte order. */
const DELTA: Record<number, { width: 2 | 4; bigEndian: boolean }> = {
  [DELTA2_LE]: { width: 2, bigEndian: false },
  [DELTA4_LE]: { width: 4, bigEndian: false },
  [DELTA2_BE]: { width: 2, bigEndian: true },
  [DELTA4_BE]: { width: 4, bigEndian: true },
};
const KIND_BY_WIDTH = { 2: SHUFFLE2, 4: SHUFFLE4, 8: SHUFFLE8 } as const;
const WIDTH_BY_KIND: Record<number, number> = { [SHUFFLE2]: 2, [SHUFFLE4]: 4, [SHUFFLE8]: 8 };

const zstd = (data: Uint8Array, level: number) =>
  zlib.zstdCompressSync(data, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level, [zlib.constants.ZSTD_c_checksumFlag]: 1 } });

/** Gather byte k of every `width`-byte element together. A trailing partial element is copied unchanged. */
export function shuffle(data: Uint8Array, width: number): Buffer {
  const count = Math.floor(data.length / width);
  const out = Buffer.allocUnsafe(data.length);
  for (let k = 0; k < width; k++) {
    let o = k * count;
    for (let i = k; i < count * width; i += width) out[o++] = data[i];
  }
  out.set(data.subarray(count * width), count * width);
  return out;
}

export function unshuffle(data: Uint8Array, width: number): Buffer {
  const count = Math.floor(data.length / width);
  const out = Buffer.allocUnsafe(data.length);
  for (let k = 0; k < width; k++) {
    let s = k * count;
    for (let i = k; i < count * width; i += width) out[i] = data[s++];
  }
  out.set(data.subarray(count * width), count * width);
  return out;
}

/** The elements of `data` as unsigned integers in host byte order (little endian on every platform Craton runs on), in a fresh aligned array. */
function elements(data: Uint8Array, width: 2 | 4, bigEndian: boolean): Uint16Array | Uint32Array {
  const count = Math.floor(data.length / width);
  const bytes = new Uint8Array(count * width);
  bytes.set(data.subarray(0, count * width));
  const buf = Buffer.from(bytes.buffer);
  if (bigEndian) (width === 4 ? buf.swap32() : buf.swap16());
  return width === 4 ? new Uint32Array(bytes.buffer, 0, count) : new Uint16Array(bytes.buffer, 0, count);
}

function bytesOf(values: Uint16Array | Uint32Array, width: 2 | 4, bigEndian: boolean, tail: Uint8Array): Buffer {
  const buf = Buffer.from(values.buffer, values.byteOffset, values.length * width);
  if (bigEndian) (width === 4 ? buf.swap32() : buf.swap16());
  return Buffer.concat([buf, tail]);
}

/** Replace each element with its difference from the one before it (modulo the element size). A trailing partial element is copied. */
export function deltaEncode(data: Uint8Array, width: 2 | 4, bigEndian: boolean): Buffer {
  const v = elements(data, width, bigEndian);
  for (let i = v.length - 1; i > 0; i--) v[i] = v[i] - v[i - 1];
  return bytesOf(v, width, bigEndian, data.subarray(v.length * width));
}

export function deltaDecode(data: Uint8Array, width: 2 | 4, bigEndian: boolean): Buffer {
  const v = elements(data, width, bigEndian);
  for (let i = 1; i < v.length; i++) v[i] = v[i] + v[i - 1];
  return bytesOf(v, width, bigEndian, data.subarray(v.length * width));
}

/** Below this size an attempt at a second encoding costs more than it can save. */
const TRY_MORE_ABOVE = 4096;

function encode(data: Buffer, hint: Hint): { stored: Buffer; codec: Codec } {
  const raw = () => ({ stored: Buffer.concat([Buffer.from([RAW]), data]), codec: "none" as Codec });
  if (hint.kind === "incompressible" || data.length === 0) return raw();

  let best: { kind: number; body: Buffer } | null = null;
  const consider = (kind: number, body: Buffer) => {
    if (body.length < data.length && (!best || body.length < best.body.length)) best = { kind, body };
  };

  if (hint.kind === "numeric") {
    if (data.length >= TRY_MORE_ABOVE) {
      consider(KIND_BY_WIDTH[hint.width], zstd(shuffle(data, hint.width), 3));
      if (hint.width !== 8) {
        const kind = hint.width === 4 ? (hint.bigEndian ? DELTA4_BE : DELTA4_LE) : hint.bigEndian ? DELTA2_BE : DELTA2_LE;
        consider(kind, zstd(shuffle(deltaEncode(data, hint.width, Boolean(hint.bigEndian)), hint.width), 3));
      }
    }
    // Plain zstd only when the numeric encodings did not help: for numbers it almost never wins, and it is the costly part.
    if (!best || (best as { body: Buffer }).body.length > data.length * 0.95) consider(ZSTD, zstd(data, 3));
  } else if (hint.kind === "records") {
    consider(ZSTD, zstd(data, 3));
    if (data.length >= TRY_MORE_ABOVE && hint.width >= 2 && hint.width <= 4096) {
      const packed = zstd(shuffle(data, hint.width), 3);
      const head = Buffer.alloc(2);
      head.writeUInt16LE(hint.width, 0);
      consider(RECORDS, Buffer.concat([head, packed]));
    }
  } else if (hint.kind === "text") {
    consider(ZSTD, zstd(data, 9));
  } else {
    // Unknown bytes: plain zstd first. If it helped only a little or moderately, the data may be numbers with a stride
    // (a raster stored without a header we recognised), so one shuffle attempt is worth its cost; if it helped a lot
    // (text, repeated structure) or not at all (already compressed), more attempts would be wasted work.
    const plain = zstd(data, 3);
    consider(ZSTD, plain);
    const ratio = data.length / plain.length;
    if (data.length >= TRY_MORE_ABOVE && ratio > 1.03 && ratio < 3.5) consider(SHUFFLE4, zstd(shuffle(data, 4), 3));
  }
  const chosen = best as { kind: number; body: Buffer } | null;
  if (!chosen) return raw();
  return { stored: Buffer.concat([Buffer.from([chosen.kind]), chosen.body]), codec: CODEC_BY_KIND[chosen.kind] };
}

export function compressChunk(data: Buffer, expectedHash: string, hint: Hint = { kind: "auto" }): { stored: Buffer; codec: Codec } {
  const result = encode(data, hint);
  const roundTrip = decompressChunk(result.stored);
  if (sha256Hex(roundTrip) !== expectedHash) {
    throw new Error(`Lossless check failed for chunk ${expectedHash}`);
  }
  return result;
}

/**
 * Decode a stored chunk. `maxLength` bounds the decoded size, so bytes from an untrusted sender cannot expand into
 * more memory than a chunk may hold.
 */
export function decompressChunk(stored: Buffer, maxLength?: number): Buffer {
  const kind = stored[0];
  const body = stored.subarray(1);
  if (kind === RAW) {
    if (maxLength !== undefined && body.length > maxLength) throw new Error("Chunk is larger than allowed.");
    return Buffer.from(body);
  }
  if (kind === RECORDS) {
    if (body.length < 2) throw new Error("Truncated record-shuffled chunk");
    const width = body.readUInt16LE(0);
    if (width < 2 || width > 4096) throw new Error("Bad record width");
    const options = maxLength === undefined ? undefined : { maxOutputLength: maxLength };
    return unshuffle(zlib.zstdDecompressSync(body.subarray(2), options), width);
  }
  if (kind === ZSTD || kind in WIDTH_BY_KIND || kind in DELTA) {
    const options = maxLength === undefined ? undefined : { maxOutputLength: maxLength };
    const decoded = zlib.zstdDecompressSync(body, options);
    if (kind === ZSTD) return decoded;
    if (kind in DELTA) {
      const { width, bigEndian } = DELTA[kind];
      return deltaDecode(unshuffle(decoded, width), width, bigEndian);
    }
    return unshuffle(decoded, WIDTH_BY_KIND[kind]);
  }
  throw new Error(`Unknown chunk encoding ${kind}`);
}

/** The codec name of an already stored chunk, or null when its first byte is not one this build knows. */
export function codecOf(stored: Buffer): Codec | null {
  return CODEC_BY_KIND[stored[0]] ?? null;
}
