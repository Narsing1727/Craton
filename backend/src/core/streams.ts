// The independently compressed pieces of a file the cold storage tier understands: the tiles and strips of a DEFLATE TIFF, and
// the chunks of a chunked HDF5 or NetCDF 4 dataset compressed with DEFLATE (alone, or after the shuffle filter). Nothing here
// changes a byte; it only says where each compressed stream starts and ends (services/recode.ts keeps them as pixels).

import { hdf5Chunks } from "../checks/hdf5.ts";
import { deflateSegments, type ReadAt, type Segment } from "./tiff.ts";

const HDF5 = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);

/** FNV-1a, so the same dataset path is the same small number in every version of a file. */
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
};

export async function compressedSegments(readAt: ReadAt, size: number): Promise<Segment[] | null> {
  const head = await readAt(0, 8);
  if (head.length >= 8 && head.equals(HDF5)) {
    const segments: Segment[] = [];
    try {
      for (const d of await hdf5Chunks((o, l) => readAt(o, l), size)) {
        const image = fnv(d.path);
        d.chunks.forEach((c, index) => {
          if (c.size > 2 && c.offset > 0 && c.offset + c.size <= size) segments.push({ image, index, offset: c.offset, count: c.size, sampleBytes: d.elementSize, predictor: 1, shuffled: d.shuffled });
        });
      }
    } catch {
      return null;
    }
    segments.sort((a, b) => a.offset - b.offset);
    const out: Segment[] = [];
    let end = 0;
    for (const s of segments) {
      if (s.offset < end) continue;
      out.push(s);
      end = s.offset + s.count;
    }
    return out;
  }
  return deflateSegments(readAt, size);
}
