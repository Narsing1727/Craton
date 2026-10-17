// Where the compressed pieces of a TIFF are. A GeoTIFF with DEFLATE compression is a header, a directory, and one
// independently compressed stream per tile (or strip); knowing where each stream starts and ends is all the cold storage
// tier needs (core/rezip.ts, services/recode.ts). Nothing here changes a byte.
//
// Only what is needed is read: the directory entries, and the two arrays that give each stream's offset and length.
// Classic TIFF and BigTIFF, either byte order, every image in the file (overviews have tiles of their own).

export type ReadAt = (offset: number, length: number) => Promise<Buffer>;

export type Segment = {
  /** Which image of the file (0 is the full-resolution one) and which tile or strip of it. */
  image: number;
  index: number;
  /** Where its compressed stream lies in the file. */
  offset: number;
  count: number;
  /** Bytes in one sample of the decompressed data, and whether a predictor was applied (2 horizontal difference, 3 floating point). */
  sampleBytes: number;
  predictor: number;
  /** The bytes inside the stream are byte-shuffled by `sampleBytes` (HDF5's shuffle filter ran before DEFLATE). */
  shuffled?: boolean;
};

const DEFLATE = [8, 32946];
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
const MAX_IMAGES = 64;
const MAX_SEGMENTS = 2_000_000;

/** The DEFLATE-compressed tiles and strips of a TIFF, sorted by position, or null when this is not a TIFF. Streams that overlap each other or leave the file are left out. */
export async function deflateSegments(readAt: ReadAt, size: number): Promise<Segment[] | null> {
  const head = await readAt(0, 16);
  if (head.length < 8) return null;
  const order = head.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const u64 = (b: Buffer, o: number) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  const magic = u16(head, 2);
  const big = magic === 43;
  if (magic !== 42 && !big) return null;
  if (big && (head.length < 16 || u16(head, 4) !== 8)) return null;

  const inline = big ? 8 : 4;
  const entrySize = big ? 20 : 12;
  let next = big ? u64(head, 8) : u32(head, 4);
  const found: Segment[] = [];
  const seen = new Set<number>();

  for (let image = 0; next > 0 && next + 8 <= size && image < MAX_IMAGES && !seen.has(next); image++) {
    seen.add(next);
    const countBytes = await readAt(next, big ? 8 : 2);
    const n = big ? u64(countBytes, 0) : u16(countBytes, 0);
    if (n < 1 || n > 4096) return found.length ? finish(found, size) : null;
    const table = await readAt(next + (big ? 8 : 2), n * entrySize + (big ? 8 : 4));
    if (table.length < n * entrySize + (big ? 8 : 4)) return null;

    const tags = new Map<number, { type: number; count: number; at: number }>();
    for (let i = 0; i < n; i++) {
      const e = i * entrySize;
      const tag = u16(table, e);
      const type = u16(table, e + 2);
      const count = big ? u64(table, e + 4) : u32(table, e + 4);
      const valueAt = e + (big ? 12 : 8);
      const bytes = (TYPE_SIZE[type] ?? 0) * count;
      const at = bytes <= inline ? -(valueAt + 1) : big ? u64(table, valueAt) : u32(table, valueAt);
      tags.set(tag, { type, count, at });
    }
    const values = async (tag: number, limit = 64): Promise<number[] | null> => {
      const t = tags.get(tag);
      if (!t || t.count < 1 || t.count > Math.max(limit, 0) || !(t.type in TYPE_SIZE)) return null;
      const width = TYPE_SIZE[t.type];
      const buf = t.at < 0 ? table.subarray(-t.at - 1, -t.at - 1 + width * t.count) : await readAt(t.at, width * t.count);
      if (buf.length < width * t.count) return null;
      const out: number[] = [];
      for (let k = 0; k < t.count; k++) out.push(width === 1 ? buf[k] : width === 2 ? u16(buf, k * 2) : width === 4 ? u32(buf, k * 4) : u64(buf, k * 8));
      return out;
    };

    const compression = (await values(259, 1))?.[0] ?? 1;
    if (DEFLATE.includes(compression)) {
      const bits = (await values(258, 16))?.[0] ?? 8;
      const predictor = (await values(317, 1))?.[0] ?? 1;
      const tiled = tags.has(324);
      const offsets = await values(tiled ? 324 : 273, MAX_SEGMENTS);
      const counts = await values(tiled ? 325 : 279, MAX_SEGMENTS);
      if (offsets && counts && offsets.length === counts.length) {
        for (let index = 0; index < offsets.length && found.length < MAX_SEGMENTS; index++) {
          found.push({ image, index, offset: offsets[index], count: counts[index], sampleBytes: Math.max(1, Math.floor(bits / 8)), predictor });
        }
      }
    }
    const link = table.subarray(n * entrySize, n * entrySize + (big ? 8 : 4));
    next = big ? u64(link, 0) : u32(link, 0);
  }
  return finish(found, size);
}

function finish(found: Segment[], size: number): Segment[] {
  const inside = found.filter((s) => s.count > 2 && s.offset > 0 && s.offset + s.count <= size).sort((a, b) => a.offset - b.offset);
  const out: Segment[] = [];
  let end = 0;
  for (const s of inside) {
    if (s.offset < end) continue; // a stream claiming bytes an earlier one already owns is left out
    out.push(s);
    end = s.offset + s.count;
  }
  return out;
}
