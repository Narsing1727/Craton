// Is this GeoTIFF laid out as a Cloud Optimized GeoTIFF? Read from the TIFF structure only (the image directories, not
// the pixels), following the layout in the COG specification (github.com/cogeotiff/cog-spec) and what GDAL's
// validate_cloud_optimized_geotiff checks:
//
//   - the image is tiled (strips are read badly over HTTP range requests),
//   - an image bigger than 512 pixels in either direction has overviews (otherwise a zoomed-out view reads everything),
//   - every image directory, with its out-of-line tag values, comes before the first byte of image data (so one small
//     range request at the start of the file answers "what is in here").
//
// It says what is wrong in words a data owner can act on.

import type { Read } from "./geotiff.ts";
import { NotTiffError } from "./geotiff.ts";

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };
const MAX_DIRECTORIES = 64;

export type CogDirectory = {
  offset: number;
  /** First byte after the directory's entries. */
  end: number;
  /** First byte after the last out-of-line tag value of this directory (arrays that do not fit in the entry). */
  metaEnd: number;
  width: number;
  height: number;
  tiled: boolean;
  /** NewSubfileType says this directory is a reduced-resolution copy of the main image (an overview). */
  reduced: boolean;
  /** Offset of the first tile or strip, null when the directory has none. */
  firstDataOffset: number | null;
};

export type CogLayout = { directories: CogDirectory[]; bigTiff: boolean };

export async function readCogLayout(read: Read, size: number): Promise<CogLayout> {
  const head = await read(0, 16);
  const order = head.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") throw new NotTiffError("Not a TIFF file");
  const le = order === "II";
  const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const u64 = (b: Buffer, o: number) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  const magic = u16(head, 2);
  const big = magic === 43;
  if (magic !== 42 && !big) throw new NotTiffError("Not a TIFF file");

  let next = big ? u64(head, 8) : u32(head, 4);
  const directories: CogDirectory[] = [];
  const entrySize = big ? 20 : 12;

  while (next > 0 && next < size && directories.length < MAX_DIRECTORIES) {
    const countBuf = await read(next, big ? 8 : 2);
    const count = big ? u64(countBuf, 0) : u16(countBuf, 0);
    if (count <= 0 || count > 4096) throw new Error("TIFF directory has an impossible number of entries");
    const entries = await read(next + (big ? 8 : 2), count * entrySize + (big ? 8 : 4));
    if (entries.length < count * entrySize) throw new Error("TIFF directory is truncated");

    let width = 0;
    let height = 0;
    let tiled = false;
    let subfile = 0;
    let firstData: number | null = null;
    let metaEnd = 0;
    for (let i = 0; i < count; i++) {
      const o = i * entrySize;
      const tag = u16(entries, o);
      const type = u16(entries, o + 2);
      const n = big ? u64(entries, o + 4) : u32(entries, o + 4);
      const valueSize = (TYPE_SIZE[type] ?? 1) * n;
      const inlineAt = o + (big ? 12 : 8);
      const inline = valueSize <= (big ? 8 : 4);
      const pointer = big ? u64(entries, o + 12) : u32(entries, o + 8);
      if (!inline) metaEnd = Math.max(metaEnd, pointer + valueSize);
      const first = async (): Promise<number | null> => {
        if (n === 0) return null;
        if (inline) return type === 3 ? u16(entries, inlineAt) : type === 16 ? u64(entries, inlineAt) : u32(entries, inlineAt);
        const w = type === 3 ? 2 : type === 16 ? 8 : 4;
        const b = await read(pointer, w);
        return type === 3 ? u16(b, 0) : type === 16 ? u64(b, 0) : u32(b, 0);
      };
      if (tag === 256) width = (await first()) ?? 0;
      else if (tag === 257) height = (await first()) ?? 0;
      else if (tag === 254) subfile = (await first()) ?? 0;
      else if (tag === 322 || tag === 323) tiled = true;
      else if (tag === 324 || tag === 273) {
        const v = await first();
        if (v !== null && (firstData === null || v < firstData)) firstData = v;
      }
    }
    const end = next + (big ? 8 : 2) + count * entrySize + (big ? 8 : 4);
    directories.push({ offset: next, end, metaEnd, width, height, tiled, reduced: (subfile & 1) === 1, firstDataOffset: firstData });
    next = big ? u64(entries, count * entrySize) : u32(entries, count * entrySize);
    if (directories.some((d) => d.offset === next)) break; // a loop in a damaged file
  }
  if (!directories.length) throw new Error("TIFF has no image directory");
  return { directories, bigTiff: big };
}

/** What stops this file being a Cloud Optimized GeoTIFF, in plain words; empty when it is one. */
export function cogProblems(layout: CogLayout): string[] {
  const problems: string[] = [];
  const main = layout.directories[0];
  if (!main.tiled) problems.push("stored in strips, not tiles");
  const overviews = layout.directories.slice(1).filter((d) => d.reduced).length;
  if ((main.width > 512 || main.height > 512) && overviews === 0) problems.push(`${main.width}×${main.height} pixels with no overviews`);
  const dataStarts = layout.directories.map((d) => d.firstDataOffset).filter((v): v is number => v !== null);
  const metaEnds = layout.directories.map((d) => Math.max(d.end, d.metaEnd));
  if (dataStarts.length && Math.max(...metaEnds) > Math.min(...dataStarts)) problems.push("image data comes before the directories, so a reader needs extra requests to find the layout");
  return problems;
}
