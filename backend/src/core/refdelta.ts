// A chunk stored as its difference from the bytes at the same place in the previous version of the file (encoding 10).
//
// When every number in a raster moves by the same amount (a vertical datum shift) or by a smooth amount (a recalibration),
// the new file shares no bytes with the old one, so deduplication finds nothing; but the *difference* of the two is almost
// all zeros and compresses to a few percent. Measured on a real 3600 x 3600 float32 DEM, a +0.25 m shift: 30.8 MB stored
// alone, 0.12 MB stored against the old version (research/storage/README.md).
//
// The stored form names the chunks it is a difference from (`refs`: a slice of each), so it can only be decoded where those
// chunks are; the server resolves them. It is never sent to a client as it is (clients decode a chunk without a store): the
// server decodes it and sends it in a standalone encoding. A reference chunk is always a full chunk, never itself a
// difference, so a read costs at most a few extra chunk reads and a chain can never form.
//
//   10, version(1), mode(1), width(1), phase(1), length u32, refCount(1), refs[ hash(32) from u32 to u32 ] , zstd(diff)
//   version 2 (point clouds): 10, 2, mode(2), 0, phase u16, recordLength u16, length u32, refCount(1), refs..., zstd(diff)
//
//   mode  0: each element is XORed with the reference's;   1: each element minus the reference's, wrapping
//   width the element size in bytes (2, 4 or 8, little endian); `phase` is how many bytes at the start of the chunk come
//   before its first whole element (chunks are cut anywhere; elements are counted from the start of the file). The head and
//   tail bytes that are not whole elements are always XORed. The reference is the previous version's bytes at the same
//   file offsets; where that file was shorter the rest of the reference is zeros.

import zlib from "node:zlib";
import { shuffle, unshuffle } from "./shuffle.ts";

export const REF_DELTA = 10;
const VERSION = 1;
const MAX_REFS = 4;
const HEADER = 10;
const HEADER2 = 13;

export type RefSlice = { hash: string; from: number; to: number };
/** `mode` 2 is a LAS point cloud: `width` is then the length of one point record, not of a number. */
export type RefDeltaInfo = { mode: 0 | 1 | 2; width: number; phase: number; length: number; refs: RefSlice[]; records: boolean };

const zstd = (data: Uint8Array, level: number) => zlib.zstdCompressSync(data, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } });

function elementsOf(buf: Uint8Array, width: 2 | 4 | 8) {
  const bytes = new Uint8Array(buf.length);
  bytes.set(buf);
  return width === 2 ? new Uint16Array(bytes.buffer) : width === 4 ? new Uint32Array(bytes.buffer) : new BigUint64Array(bytes.buffer);
}

/** The bytes of the difference: head (XOR), whole elements (XOR or difference, then byte-shuffled), tail (XOR). */
type WordLayout = { mode: 0 | 1; width: 2 | 4 | 8; phase: number };

function difference(data: Uint8Array, ref: Uint8Array, info: WordLayout): Buffer {
  const { mode, width, phase } = info;
  const count = Math.floor((data.length - phase) / width);
  const bodyEnd = phase + count * width;
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < phase; i++) out[i] = data[i] ^ ref[i];
  for (let i = bodyEnd; i < data.length; i++) out[i] = data[i] ^ ref[i];
  if (count > 0) {
    const a = elementsOf(data.subarray(phase, bodyEnd), width);
    const b = elementsOf(ref.subarray(phase, bodyEnd), width);
    const d = width === 8 ? new BigUint64Array(count) : width === 4 ? new Uint32Array(count) : new Uint16Array(count);
    if (width === 8) for (let i = 0; i < count; i++) (d as BigUint64Array)[i] = mode === 0 ? (a as BigUint64Array)[i] ^ (b as BigUint64Array)[i] : BigInt.asUintN(64, (a as BigUint64Array)[i] - (b as BigUint64Array)[i]);
    else if (mode === 0) for (let i = 0; i < count; i++) (d as Uint32Array)[i] = (a as Uint32Array)[i] ^ (b as Uint32Array)[i];
    else if (width === 4) for (let i = 0; i < count; i++) (d as Uint32Array)[i] = ((a as Uint32Array)[i] - (b as Uint32Array)[i]) >>> 0;
    else for (let i = 0; i < count; i++) (d as Uint16Array)[i] = ((a as Uint16Array)[i] - (b as Uint16Array)[i]) & 0xffff;
    const bytes = Buffer.from(d.buffer, 0, count * width);
    // Byte shuffle: all first bytes together, then all second bytes, and so on.
    for (let k = 0; k < width; k++) {
      let o = phase + k * count;
      for (let i = k; i < count * width; i += width) out[o++] = bytes[i];
    }
  }
  return out;
}

function reconstruct(diff: Uint8Array, ref: Uint8Array, info: WordLayout): Buffer {
  const { mode, width, phase } = info;
  const length = diff.length;
  const count = Math.floor((length - phase) / width);
  const bodyEnd = phase + count * width;
  const out = Buffer.alloc(length);
  for (let i = 0; i < phase; i++) out[i] = diff[i] ^ ref[i];
  for (let i = bodyEnd; i < length; i++) out[i] = diff[i] ^ ref[i];
  if (count > 0) {
    const bytes = Buffer.alloc(count * width);
    for (let k = 0; k < width; k++) {
      let s = phase + k * count;
      for (let i = k; i < count * width; i += width) bytes[i] = diff[s++];
    }
    const d = elementsOf(bytes, width);
    const b = elementsOf(ref.subarray(phase, bodyEnd), width);
    const r = width === 8 ? new BigUint64Array(count) : width === 4 ? new Uint32Array(count) : new Uint16Array(count);
    if (width === 8) for (let i = 0; i < count; i++) (r as BigUint64Array)[i] = mode === 0 ? (d as BigUint64Array)[i] ^ (b as BigUint64Array)[i] : BigInt.asUintN(64, (d as BigUint64Array)[i] + (b as BigUint64Array)[i]);
    else if (mode === 0) for (let i = 0; i < count; i++) (r as Uint32Array)[i] = (d as Uint32Array)[i] ^ (b as Uint32Array)[i];
    else if (width === 4) for (let i = 0; i < count; i++) (r as Uint32Array)[i] = ((d as Uint32Array)[i] + (b as Uint32Array)[i]) >>> 0;
    else for (let i = 0; i < count; i++) (r as Uint16Array)[i] = ((d as Uint16Array)[i] + (b as Uint16Array)[i]) & 0xffff;
    out.set(Buffer.from(r.buffer, 0, count * width), phase);
  }
  return out;
}

/**
 * Point records (LAS): each record's three coordinates (the first twelve bytes: X, Y, Z as 32-bit integers) are subtracted from the
 * reference's, every other byte is XORed, and the result is byte-shuffled by record so each field of every point lies together. A
 * vertical shift is then a column of one repeated number; a reclassification is a column that is zero but for a few bytes.
 */
function recordDifference(data: Uint8Array, ref: Uint8Array, phase: number, width: number): Buffer {
  const count = Math.floor((data.length - phase) / width);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < phase; i++) out[i] = data[i] ^ ref[i];
  const body = phase + count * width;
  for (let i = body; i < data.length; i++) out[i] = data[i] ^ ref[i];
  const a = Buffer.from(data.buffer, data.byteOffset, data.length);
  const b = Buffer.from(ref.buffer, ref.byteOffset, ref.length);
  for (let k = 0; k < count; k++) {
    const at = phase + k * width;
    let j = 0;
    if (width >= 12) {
      for (; j < 12; j += 4) out.writeInt32LE((a.readInt32LE(at + j) - b.readInt32LE(at + j)) | 0, at + j);
    }
    for (; j < width; j++) out[at + j] = data[at + j] ^ ref[at + j];
  }
  if (count > 0) shuffle(out.subarray(phase, body), width).copy(out, phase);
  return out;
}

function recordReconstruct(diff: Uint8Array, ref: Uint8Array, phase: number, width: number): Buffer {
  const count = Math.floor((diff.length - phase) / width);
  const body = phase + count * width;
  const work = Buffer.from(diff);
  if (count > 0) unshuffle(work.subarray(phase, body), width).copy(work, phase);
  const out = Buffer.alloc(diff.length);
  const b = Buffer.from(ref.buffer, ref.byteOffset, ref.length);
  for (let i = 0; i < phase; i++) out[i] = work[i] ^ ref[i];
  for (let i = body; i < diff.length; i++) out[i] = work[i] ^ ref[i];
  for (let k = 0; k < count; k++) {
    const at = phase + k * width;
    let j = 0;
    if (width >= 12) {
      for (; j < 12; j += 4) out.writeInt32LE((work.readInt32LE(at + j) + b.readInt32LE(at + j)) | 0, at + j);
    }
    for (; j < width; j++) out[at + j] = work[at + j] ^ ref[at + j];
  }
  return out;
}

/**
 * A chunk of a point cloud as its difference from the previous version's records at the same positions. `phase` is how many bytes
 * of the chunk come before its first whole record.
 */
export function encodeRecordDelta(data: Buffer, ref: Uint8Array, refs: RefSlice[], recordWidth: number, phase: number, mustBeBelow: number): Buffer | null {
  if (refs.length === 0 || refs.length > MAX_REFS || data.length < 256 || recordWidth < 2 || recordWidth > 4096 || phase < 0 || phase >= recordWidth) return null;
  const body = zstd(recordDifference(data, fitted(ref, data.length), phase, recordWidth), 3);
  const header = Buffer.alloc(HEADER2 + refs.length * 40);
  header[0] = REF_DELTA;
  header[1] = 2;
  header[2] = 2;
  header.writeUInt16LE(phase, 4);
  header.writeUInt16LE(recordWidth, 6);
  header.writeUInt32LE(data.length, 8);
  header[12] = refs.length;
  refs.forEach((r, i) => {
    Buffer.from(r.hash, "hex").copy(header, HEADER2 + i * 40);
    header.writeUInt32LE(r.from, HEADER2 + i * 40 + 32);
    header.writeUInt32LE(r.to, HEADER2 + i * 40 + 36);
  });
  const stored = Buffer.concat([header, body]);
  return stored.length < mustBeBelow ? stored : null;
}

/** `ref` padded with zeros (or cut) to exactly `length` bytes. */
const fitted = (ref: Uint8Array, length: number) => {
  if (ref.length === length) return ref;
  const out = new Uint8Array(length);
  out.set(ref.subarray(0, length));
  return out;
};

/**
 * The stored form of `data` as a difference from `ref` (the previous version's bytes at the same offsets), or null when it
 * is not worth it. `refs` says which stored chunks `ref` is made of; `fileOffset` is where `data` starts in its file.
 */
export function encodeRefDelta(data: Buffer, ref: Uint8Array, refs: RefSlice[], width: 2 | 4 | 8, fileOffset: number, mustBeBelow: number): Buffer | null {
  if (refs.length === 0 || refs.length > MAX_REFS || data.length < 64) return null;
  const reference = fitted(ref, data.length);
  const phase = (width - (fileOffset % width)) % width;
  let best: Buffer | null = null;
  for (const mode of [0, 1] as const) {
    const body = zstd(difference(data, reference, { mode, width, phase }), 3);
    if (!best || body.length < best.length) best = Buffer.concat([Buffer.from([mode]), body]);
  }
  const mode = best![0] as 0 | 1;
  const header = Buffer.alloc(HEADER + refs.length * 40);
  header[0] = REF_DELTA;
  header[1] = VERSION;
  header[2] = mode;
  header[3] = width;
  header[4] = phase;
  header.writeUInt32LE(data.length, 5);
  header[9] = refs.length;
  refs.forEach((r, i) => {
    Buffer.from(r.hash, "hex").copy(header, HEADER + i * 40);
    header.writeUInt32LE(r.from, HEADER + i * 40 + 32);
    header.writeUInt32LE(r.to, HEADER + i * 40 + 36);
  });
  const stored = Buffer.concat([header, best!.subarray(1)]);
  return stored.length < mustBeBelow ? stored : null;
}

export const isRefDelta = (stored: Buffer) => stored[0] === REF_DELTA;

/** What a stored difference is made of, without decoding it. */
export function refDeltaInfo(stored: Buffer): RefDeltaInfo {
  if (stored[0] !== REF_DELTA || stored.length < HEADER) throw new Error("Not a stored difference");
  if (stored[1] === 2) {
    if (stored.length < HEADER2) throw new Error("Damaged stored difference");
    const count = stored[12];
    const width = stored.readUInt16LE(6);
    const phase = stored.readUInt16LE(4);
    if (stored[2] !== 2 || width < 2 || width > 4096 || phase >= width || count < 1 || count > MAX_REFS || stored.length < HEADER2 + count * 40) throw new Error("Damaged stored difference");
    const refs: RefSlice[] = [];
    for (let i = 0; i < count; i++) {
      const at = HEADER2 + i * 40;
      refs.push({ hash: stored.subarray(at, at + 32).toString("hex"), from: stored.readUInt32LE(at + 32), to: stored.readUInt32LE(at + 36) });
    }
    return { mode: 2, width, phase, length: stored.readUInt32LE(8), refs, records: true };
  }
  if (stored[1] !== VERSION) throw new Error(`Unknown stored-difference version ${stored[1]}`);
  const mode = stored[2];
  const width = stored[3];
  const count = stored[9];
  if ((mode !== 0 && mode !== 1) || (width !== 2 && width !== 4 && width !== 8) || stored[4] >= width || count < 1 || count > MAX_REFS || stored.length < HEADER + count * 40) throw new Error("Damaged stored difference");
  const refs: RefSlice[] = [];
  for (let i = 0; i < count; i++) {
    const at = HEADER + i * 40;
    refs.push({ hash: stored.subarray(at, at + 32).toString("hex"), from: stored.readUInt32LE(at + 32), to: stored.readUInt32LE(at + 36) });
  }
  return { mode, width, phase: stored[4], length: stored.readUInt32LE(5), refs, records: false };
}

/** Rebuild the chunk. `refBytes` is the concatenation of the named slices (see `refDeltaInfo`), in order. */
export function decodeRefDelta(stored: Buffer, refBytes: Uint8Array, maxLength?: number): Buffer {
  const info = refDeltaInfo(stored);
  if (maxLength !== undefined && info.length > maxLength) throw new Error("Chunk is larger than allowed.");
  const diff = zlib.zstdDecompressSync(stored.subarray((info.records ? HEADER2 : HEADER) + info.refs.length * 40), { maxOutputLength: info.length });
  if (diff.length !== info.length) throw new Error("Damaged stored difference");
  if (info.records) return recordReconstruct(diff, fitted(refBytes, info.length), info.phase, info.width);
  return reconstruct(diff, fitted(refBytes, info.length), info as WordLayout);
}

/** The same difference and its inverse, for other formats that store one block as its difference from another (tile payloads). */
export { difference as differenceBytes, reconstruct as reconstructBytes };
