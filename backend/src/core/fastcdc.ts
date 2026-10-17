// FastCDC content-defined chunking (Xia et al., "FastCDC: a Fast and Efficient Content-Defined
// Chunking Approach for Data Deduplication", USENIX ATC 2016), with normalized chunking.
//
// Boundaries depend on the bytes, not on offsets, so inserting data near the start of a file only
// changes the chunks around the edit; every later chunk is identical and deduplicates.
// The CLI and the server share this file, so they always cut at the same places.

import { createHash } from "node:crypto";

export type ChunkingOptions = { min: number; avg: number; max: number };
export type ChunkSpan = { offset: number; length: number };

/** 256 pseudo-random 32-bit values, derived from SHA-256 so every build gets the same table. */
const GEAR: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = createHash("sha256").update(`craton-fastcdc-gear-${i}`).digest().readUInt32BE(0);
  }
  return table;
})();

/** A mask with `bits` ones spread over the high end of a 32-bit word (the well-mixed bits of the gear hash). */
function spreadMask(bits: number): number {
  let mask = 0;
  // Place ones at every other position from bit 31 down, then fill in, so they stay spread out.
  const positions: number[] = [];
  for (let p = 31; p >= 0 && positions.length < bits; p -= 2) positions.push(p);
  for (let p = 30; p >= 0 && positions.length < bits; p -= 2) positions.push(p);
  for (const p of positions) mask |= 1 << p;
  return mask >>> 0;
}

function masksFor(avg: number) {
  const bits = Math.round(Math.log2(avg));
  // Normalization level 2: harder to cut before the average size, easier after it.
  return { maskS: spreadMask(bits + 2), maskL: spreadMask(bits - 2) };
}

/**
 * Length of the next chunk starting at `start` in `buf[start, end)`.
 * If `final` is false and no cut point is found before `end`, returns -1 (need more data).
 */
export function nextCut(buf: Uint8Array, start: number, end: number, opts: ChunkingOptions, final: boolean): number {
  const { min, avg, max } = opts;
  const { maskS, maskL } = masksFor(avg);
  const available = end - start;
  if (available <= min) return final ? available : -1;

  const limit = Math.min(available, max);
  const normal = Math.min(avg, limit);
  let hash = 0;
  let i = min;
  for (; i < normal; i++) {
    hash = ((hash << 1) + GEAR[buf[start + i]]) >>> 0;
    if ((hash & maskS) === 0) return i + 1;
  }
  for (; i < limit; i++) {
    hash = ((hash << 1) + GEAR[buf[start + i]]) >>> 0;
    if ((hash & maskL) === 0) return i + 1;
  }
  // Reached max size: cut here. Below max without a cut point means we need more bytes.
  if (limit === max) return max;
  return final ? limit : -1;
}

/** Split a whole in-memory buffer into chunk spans. */
export function chunkBuffer(buf: Uint8Array, opts: ChunkingOptions): ChunkSpan[] {
  const spans: ChunkSpan[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const len = nextCut(buf, offset, buf.length, opts, true);
    spans.push({ offset, length: len });
    offset += len;
  }
  return spans;
}

export type Chunk = { offset: number; length: number; hash: string; data: Buffer };

/**
 * Chunk a stream of buffers (e.g. fs.createReadStream) without holding the whole file in memory.
 * Yields each chunk with its SHA-256.
 */
export async function* chunkStream(source: AsyncIterable<Buffer | Uint8Array>, opts: ChunkingOptions): AsyncGenerator<Chunk> {
  let pending: Buffer = Buffer.alloc(0);
  let fileOffset = 0;
  for await (const piece of source) {
    pending = pending.length ? Buffer.concat([pending, Buffer.from(piece)]) : Buffer.from(piece);
    let start = 0;
    while (true) {
      const len = nextCut(pending, start, pending.length, opts, false);
      if (len < 0) break;
      const data = pending.subarray(start, start + len);
      yield { offset: fileOffset, length: len, hash: sha256Hex(data), data: Buffer.from(data) };
      fileOffset += len;
      start += len;
    }
    pending = pending.subarray(start);
  }
  let start = 0;
  while (start < pending.length) {
    const len = nextCut(pending, start, pending.length, opts, true);
    const data = pending.subarray(start, start + len);
    yield { offset: fileOffset, length: len, hash: sha256Hex(data), data: Buffer.from(data) };
    fileOffset += len;
    start += len;
  }
}

export function sha256Hex(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}
