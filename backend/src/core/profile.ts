// What kind of bytes a file holds, as far as the encoder needs to know (see compress.ts `Hint`). Decided from the
// file's name and, for TIFF, from its header; a wrong guess only costs compression, never correctness, because every
// stored chunk is verified lossless regardless.

import type { Hint } from "./compress.ts";

/** Formats whose bytes are already compressed: trying zstd on them is wasted work. */
const COMPRESSED = new Set(["laz", "zip", "gz", "tgz", "bz2", "xz", "7z", "zst", "rar", "png", "jpg", "jpeg", "webp", "gif", "jp2", "j2k", "mp4", "mov", "avi", "mkv", "webm", "mp3", "aac", "pdf", "parquet", "pmtiles", "docx", "xlsx", "pptx", "jar", "whl", "woff", "woff2"]);

/** Plain text, where a higher zstd level pays off. */
const TEXT = new Set(["csv", "tsv", "txt", "md", "json", "geojson", "kml", "gml", "xml", "inp", "rpt", "out", "prj", "asc", "yml", "yaml", "toml", "ini", "cfg", "log", "wkt", "sql", "html", "css", "js", "ts", "py", "r", "m", "bat", "sh"]);

/** Raw numeric rasters whose element width the extension implies. */
const NUMERIC_BY_EXT: Record<string, 2 | 4 | 8> = {
  hgt: 2, // SRTM tiles: big-endian int16 (see hintForPath)
  flt: 4, // ESRI binary float grid
  f32: 4,
  r4: 4,
  f64: 8,
  r8: 8,
  i16: 2,
  u16: 2,
};

/** Hint from the name alone. TIFF needs its header too (`tiffHint`); until then it is "auto". */
export function hintForPath(file: string): Hint {
  const lower = file.toLowerCase();
  const name = lower.split("/").pop() ?? lower;
  // HEC-RAS text files: plan, geometry, unsteady and steady flow (.p01, .g01, .u01, .f01) and their project file.
  if (/\.(p|g|u|f)\d\d$/.test(name) || name.endsWith(".prj")) return { kind: "text" };
  const ext = name.includes(".") ? name.split(".").pop()! : "";
  if (COMPRESSED.has(ext)) return { kind: "incompressible" };
  if (TEXT.has(ext)) return { kind: "text" };
  const width = NUMERIC_BY_EXT[ext];
  if (width) return { kind: "numeric", width, bigEndian: ext === "hgt" };
  return { kind: "auto" };
}

/**
 * Hint from a LAS header: the point records are fixed-length, so the bytes are shuffled by record. LAZ (point format
 * with the compression bit set) is already compressed and is left alone. Null when this is not a LAS file.
 */
export function lasHint(readAt: (offset: number, length: number) => Buffer | null): Hint | null {
  const h = readAt(0, 111);
  if (!h || h.length < 107 || h.toString("latin1", 0, 4) !== "LASF") return null;
  const format = h[104];
  if ((format & 0x80) !== 0 || (format & 0x40) !== 0) return { kind: "incompressible" };
  const recordLength = h.readUInt16LE(105);
  return recordLength >= 2 && recordLength <= 4096 ? { kind: "records", width: recordLength } : { kind: "auto" };
}

/**
 * Hint from a TIFF/BigTIFF header. `readAt` returns up to `length` bytes at `offset` (or null when the file is shorter
 * or cannot be read). Returns null when this is not a TIFF or its first image directory cannot be read.
 */
export function tiffHint(readAt: (offset: number, length: number) => Buffer | null): Hint | null {
  const head = readAt(0, 16);
  if (!head || head.length < 8) return null;
  const order = head.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") return null;
  const le = order === "II";
  const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const magic = u16(head, 2);
  const big = magic === 43;
  if (magic !== 42 && !big) return null;

  let ifd: number;
  let count: number;
  let entry: number;
  let dir: Buffer | null;
  if (big) {
    if (head.length < 16) return null;
    ifd = Number(le ? head.readBigUInt64LE(8) : head.readBigUInt64BE(8));
    const n = readAt(ifd, 8);
    if (!n || n.length < 8) return null;
    count = Number(le ? n.readBigUInt64LE(0) : n.readBigUInt64BE(0));
    entry = 20;
    if (count > 512) return null;
    dir = readAt(ifd + 8, count * entry);
  } else {
    ifd = u32(head, 4);
    const n = readAt(ifd, 2);
    if (!n || n.length < 2) return null;
    count = u16(n, 0);
    entry = 12;
    if (count > 512) return null;
    dir = readAt(ifd + 2, count * entry);
  }
  if (!dir || dir.length < count * entry) return null;

  // Only SHORT/LONG values that fit inline matter here (Compression, BitsPerSample for one sample, SamplesPerPixel).
  const tags = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const o = i * entry;
    const tag = u16(dir, o);
    const type = u16(dir, o + 2);
    const valueAt = big ? o + 12 : o + 8;
    if (type === 3) tags.set(tag, u16(dir, valueAt));
    else if (type === 4) tags.set(tag, u32(dir, valueAt));
  }
  const compression = tags.get(259) ?? 1;
  if (compression === 1) {
    const bits = tags.get(258);
    const samples = tags.get(277) ?? 1;
    if (bits === 16 || bits === 32 || bits === 64) return { kind: "numeric", width: (bits / 8) as 2 | 4 | 8, bigEndian: !le };
    // Several samples per pixel: BitsPerSample is an array stored elsewhere (count > 1), so it was not read above.
    if (bits === undefined && samples > 1) return { kind: "auto" };
    return { kind: "auto" };
  }
  if (compression === 32773) return { kind: "auto" }; // PackBits: weak, so there is something left to gain
  return { kind: "incompressible" }; // LZW, deflate, JPEG, zstd, LERC…
}
