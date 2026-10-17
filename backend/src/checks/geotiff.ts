// Minimal GeoTIFF reader: enough of TIFF (classic and BigTIFF) to read the first image's
// dimensions and GeoTIFF keys (EPSG code, vertical CRS) plus GDAL's nodata tag.
// Reads only the header bytes it needs through `read(offset, length)`.

export type Read = (offset: number, length: number) => Promise<Buffer>;

export type GeoTiffInfo = {
  width: number;
  height: number;
  bitsPerSample: number;
  sampleFormat: "uint" | "int" | "float" | "unknown";
  epsg: number | null;
  verticalEpsg: number | null;
  nodata: number | null;
  pixelScale: [number, number] | null;
  origin: [number, number] | null;
};

const TAG = {
  width: 256,
  height: 257,
  bits: 258,
  sampleFormat: 339,
  pixelScale: 33550,
  tiepoint: 33922,
  geoKeys: 34735,
  nodata: 42113,
};
const KEY = { geographic: 2048, projected: 3072, vertical: 4096 };
const USER_DEFINED = 32767;
// Byte sizes of TIFF field types (1 BYTE … 18 IFD8).
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

export class NotTiffError extends Error {}

export async function readGeoTiff(read: Read, size: number): Promise<GeoTiffInfo> {
  const head = await read(0, 16);
  const order = head.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") throw new NotTiffError("Not a TIFF file");
  const le = order === "II";
  const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const u64 = (b: Buffer, o: number) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  const f64 = (b: Buffer, o: number) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o));

  const magic = u16(head, 2);
  const big = magic === 43;
  if (magic !== 42 && !big) throw new NotTiffError("Not a TIFF file");
  const ifdOffset = big ? u64(head, 8) : u32(head, 4);
  if (ifdOffset <= 0 || ifdOffset >= size) throw new Error("TIFF directory offset is outside the file (truncated?)");

  const countBuf = await read(ifdOffset, big ? 8 : 2);
  const count = big ? u64(countBuf, 0) : u16(countBuf, 0);
  const entrySize = big ? 20 : 12;
  const entries = await read(ifdOffset + (big ? 8 : 2), count * entrySize);
  if (entries.length < count * entrySize) throw new Error("TIFF directory is truncated");

  type Entry = { tag: number; type: number; count: number; inline: Buffer; offset: number };
  const byTag = new Map<number, Entry>();
  for (let i = 0; i < count; i++) {
    const o = i * entrySize;
    const tag = u16(entries, o);
    const type = u16(entries, o + 2);
    const n = big ? u64(entries, o + 4) : u32(entries, o + 4);
    const inline = entries.subarray(o + (big ? 12 : 8), o + entrySize);
    const offset = big ? u64(entries, o + 12) : u32(entries, o + 8);
    byTag.set(tag, { tag, type, count: n, inline, offset });
  }

  const valueBytes = async (e: Entry) => {
    const len = (TYPE_SIZE[e.type] ?? 1) * e.count;
    return len <= (big ? 8 : 4) ? e.inline.subarray(0, len) : read(e.offset, len);
  };
  const numbers = async (tag: number): Promise<number[] | null> => {
    const e = byTag.get(tag);
    if (!e) return null;
    const b = await valueBytes(e);
    const size = TYPE_SIZE[e.type] ?? 1;
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) {
      const o = i * size;
      if (e.type === 3) out.push(u16(b, o));
      else if (e.type === 4) out.push(u32(b, o));
      else if (e.type === 12) out.push(f64(b, o));
      else if (e.type === 16) out.push(u64(b, o));
      else if (e.type === 1) out.push(b[o]);
      else out.push(NaN);
    }
    return out;
  };
  const ascii = async (tag: number) => {
    const e = byTag.get(tag);
    if (!e) return null;
    return (await valueBytes(e)).toString("latin1").replace(/\0+$/, "").trim();
  };

  const width = (await numbers(TAG.width))?.[0] ?? 0;
  const height = (await numbers(TAG.height))?.[0] ?? 0;
  const bitsPerSample = (await numbers(TAG.bits))?.[0] ?? 0;
  const fmt = (await numbers(TAG.sampleFormat))?.[0] ?? 1;
  const scale = await numbers(TAG.pixelScale);
  const tie = await numbers(TAG.tiepoint);

  // GeoKeyDirectory: [version, revision, minor, keyCount, then keyCount × (id, location, count, value)].
  let epsg: number | null = null;
  let verticalEpsg: number | null = null;
  const keys = await numbers(TAG.geoKeys);
  if (keys && keys.length >= 4) {
    const n = keys[3];
    for (let i = 0; i < n; i++) {
      const [id, location, , value] = keys.slice(4 + i * 4, 8 + i * 4);
      if (location !== 0 || value === USER_DEFINED) continue; // value stored inline as a code
      if (id === KEY.projected) epsg = value;
      else if (id === KEY.geographic && epsg === null) epsg = value;
      else if (id === KEY.vertical) verticalEpsg = value;
    }
  }

  const nodataText = await ascii(TAG.nodata);
  const nodata = nodataText !== null && nodataText !== "" && !Number.isNaN(Number(nodataText)) ? Number(nodataText) : null;

  return {
    width,
    height,
    bitsPerSample,
    sampleFormat: fmt === 1 ? "uint" : fmt === 2 ? "int" : fmt === 3 ? "float" : "unknown",
    epsg,
    verticalEpsg,
    nodata,
    pixelScale: scale ? [scale[0], scale[1]] : null,
    origin: tie && tie.length >= 5 ? [tie[3], tie[4]] : null,
  };
}
