// Read GeoTIFF pixels for previews: classic and BigTIFF, strips or tiles, uncompressed, Deflate
// or LZW, horizontal and floating-point predictors, 8/16/32/64-bit integer and float samples.
// Overviews (a COG's reduced-resolution images) are used when present, so a 2 GB DEM only reads
// the few hundred KB of its smallest overview that's still big enough.

import zlib from "node:zlib";

export type Read = (offset: number, length: number) => Promise<Buffer>;

type Ifd = {
  width: number;
  height: number;
  bits: number;
  format: number; // 1 uint, 2 int, 3 float
  samples: number;
  compression: number;
  predictor: number;
  planar: number;
  tileWidth: number | null;
  tileHeight: number | null;
  rowsPerStrip: number;
  offsets: number[];
  counts: number[];
  nodata: number | null;
  pixelScale: [number, number] | null;
  /** Map coordinates of the top-left corner of the top-left pixel (from the tiepoint), when the file has one. */
  origin: [number, number] | null;
  epsg: number | null;
  littleEndian: boolean;
};

export class UnsupportedTiffError extends Error {}

const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8, 17: 8, 18: 8 };

async function readIfds(read: Read, size: number): Promise<Ifd[]> {
  const head = await read(0, 16);
  const order = head.toString("latin1", 0, 2);
  if (order !== "II" && order !== "MM") throw new UnsupportedTiffError("Not a TIFF file");
  const le = order === "II";
  const u16 = (b: Buffer, o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (b: Buffer, o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));
  const u64 = (b: Buffer, o: number) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o));
  const f64 = (b: Buffer, o: number) => (le ? b.readDoubleLE(o) : b.readDoubleBE(o));
  const big = u16(head, 2) === 43;
  let next = big ? u64(head, 8) : u32(head, 4);
  const out: Ifd[] = [];

  for (let guard = 0; next > 0 && next < size && guard < 16; guard++) {
    const countBuf = await read(next, big ? 8 : 2);
    const count = big ? u64(countBuf, 0) : u16(countBuf, 0);
    const entrySize = big ? 20 : 12;
    const block = await read(next + (big ? 8 : 2), count * entrySize + (big ? 8 : 4));
    const entries = new Map<number, { type: number; n: number; inline: Buffer; offset: number }>();
    for (let i = 0; i < count; i++) {
      const o = i * entrySize;
      entries.set(u16(block, o), {
        type: u16(block, o + 2),
        n: big ? u64(block, o + 4) : u32(block, o + 4),
        inline: block.subarray(o + (big ? 12 : 8), o + entrySize),
        offset: big ? u64(block, o + 12) : u32(block, o + 8),
      });
    }
    next = big ? u64(block, count * entrySize) : u32(block, count * entrySize);

    const values = async (tag: number): Promise<number[] | null> => {
      const e = entries.get(tag);
      if (!e) return null;
      const sz = TYPE_SIZE[e.type] ?? 1;
      const len = sz * e.n;
      const b = len <= (big ? 8 : 4) ? e.inline.subarray(0, len) : await read(e.offset, len);
      const res: number[] = [];
      for (let i = 0; i < e.n; i++) {
        const o = i * sz;
        res.push(e.type === 3 ? u16(b, o) : e.type === 4 ? u32(b, o) : e.type === 16 ? u64(b, o) : e.type === 12 ? f64(b, o) : e.type === 1 ? b[o] : NaN);
      }
      return res;
    };
    const ascii = async (tag: number) => {
      const e = entries.get(tag);
      if (!e) return null;
      const b = e.n <= (big ? 8 : 4) ? e.inline.subarray(0, e.n) : await read(e.offset, e.n);
      return b.toString("latin1").replace(/\0+$/, "").trim();
    };
    const one = async (tag: number, dflt: number) => (await values(tag))?.[0] ?? dflt;

    const tiled = entries.has(322);
    const keys = await values(34735);
    let epsg: number | null = null;
    if (keys && keys.length >= 4) {
      for (let i = 0; i < keys[3]; i++) {
        const [id, loc, , v] = keys.slice(4 + i * 4, 8 + i * 4);
        if (loc === 0 && (id === 3072 || (id === 2048 && epsg === null))) epsg = v;
      }
    }
    const scale = await values(33550);
    const tie = await values(33922);
    const nodataText = await ascii(42113);
    out.push({
      width: await one(256, 0),
      height: await one(257, 0),
      bits: await one(258, 8),
      format: await one(339, 1),
      samples: await one(277, 1),
      compression: await one(259, 1),
      predictor: await one(317, 1),
      planar: await one(284, 1),
      tileWidth: tiled ? await one(322, 0) : null,
      tileHeight: tiled ? await one(323, 0) : null,
      rowsPerStrip: await one(278, 2 ** 32 - 1),
      offsets: (await values(tiled ? 324 : 273)) ?? [],
      counts: (await values(tiled ? 325 : 279)) ?? [],
      nodata: nodataText && !Number.isNaN(Number(nodataText)) ? Number(nodataText) : null,
      pixelScale: scale ? [scale[0], scale[1]] : null,
      origin: tie && tie.length >= 5 && scale ? [tie[3] - tie[0] * scale[0], tie[4] + tie[1] * scale[1]] : null,
      epsg,
      littleEndian: le,
    });
  }
  // Overviews inherit georeferencing and nodata from the full-resolution image.
  for (const ifd of out.slice(1)) {
    ifd.nodata ??= out[0].nodata;
    ifd.epsg ??= out[0].epsg;
    ifd.origin ??= out[0].origin;
    if (!ifd.pixelScale && out[0].pixelScale) ifd.pixelScale = [(out[0].pixelScale[0] * out[0].width) / ifd.width, (out[0].pixelScale[1] * out[0].height) / ifd.height];
  }
  return out;
}

/** TIFF LZW (MSB-first codes, 9–12 bits, with the "early change" quirk). */
function lzwDecode(input: Buffer): Buffer {
  const out: number[] = [];
  let dict: number[][] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push([i]);
    dict.push([], []); // 256 clear, 257 end
  };
  reset();
  let bitPos = 0;
  let width = 9;
  let prev: number[] | null = null;
  const readCode = () => {
    let code = 0;
    for (let i = 0; i < width; i++) {
      const byte = input[(bitPos + i) >> 3];
      if (byte === undefined) return 257;
      code = (code << 1) | ((byte >> (7 - ((bitPos + i) & 7))) & 1);
    }
    bitPos += width;
    return code;
  };
  for (;;) {
    const code = readCode();
    if (code === 257) break;
    if (code === 256) {
      reset();
      width = 9;
      prev = null;
      continue;
    }
    let entry: number[];
    if (code < dict.length && dict[code].length) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else break;
    out.push(...entry);
    if (prev) dict.push([...prev, entry[0]]);
    prev = entry;
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return Buffer.from(out);
}

function decompress(ifd: Ifd, data: Buffer) {
  if (ifd.compression === 1) return data;
  if (ifd.compression === 8 || ifd.compression === 32946) return zlib.inflateSync(data);
  if (ifd.compression === 5) return lzwDecode(data);
  throw new UnsupportedTiffError(`Compression ${ifd.compression} isn't supported for previews yet`);
}

/** Undo predictors on one decoded block (width × rows samples). */
function unpredict(ifd: Ifd, buf: Buffer, blockWidth: number, rows: number) {
  const bps = ifd.bits / 8;
  const spp = ifd.planar === 1 ? ifd.samples : 1;
  const rowBytes = blockWidth * spp * bps;
  if (ifd.predictor === 2) {
    for (let r = 0; r < rows; r++) {
      const o = r * rowBytes;
      if (bps === 1) for (let i = spp; i < rowBytes; i++) buf[o + i] = (buf[o + i] + buf[o + i - spp]) & 0xff;
      else if (bps === 2) for (let i = spp; i < blockWidth * spp; i++) buf.writeUInt16LE((buf.readUInt16LE(o + i * 2) + buf.readUInt16LE(o + (i - spp) * 2)) & 0xffff, o + i * 2);
      else if (bps === 4) for (let i = spp; i < blockWidth * spp; i++) buf.writeUInt32LE((buf.readUInt32LE(o + i * 4) + buf.readUInt32LE(o + (i - spp) * 4)) >>> 0, o + i * 4);
    }
  } else if (ifd.predictor === 3) {
    // Floating-point predictor: byte-wise differencing over byte planes (TIFF Technical Note 3).
    const tmp = Buffer.alloc(rowBytes);
    for (let r = 0; r < rows; r++) {
      const row = buf.subarray(r * rowBytes, (r + 1) * rowBytes);
      for (let i = spp; i < rowBytes; i++) row[i] = (row[i] + row[i - spp]) & 0xff;
      const n = blockWidth * spp;
      for (let x = 0; x < n; x++) for (let k = 0; k < bps; k++) tmp[x * bps + (bps - 1 - k)] = row[k * n + x];
      tmp.copy(row);
    }
  }
}

function sampleReader(ifd: Ifd): (b: Buffer, i: number) => number {
  if (ifd.format === 3) return ifd.bits === 64 ? (b, i) => b.readDoubleLE(i * 8) : (b, i) => b.readFloatLE(i * 4);
  if (ifd.format === 2) return ifd.bits === 8 ? (b, i) => b.readInt8(i) : ifd.bits === 16 ? (b, i) => b.readInt16LE(i * 2) : (b, i) => b.readInt32LE(i * 4);
  return ifd.bits === 8 ? (b, i) => b[i] : ifd.bits === 16 ? (b, i) => b.readUInt16LE(i * 2) : (b, i) => b.readUInt32LE(i * 4);
}

export type Grid = { width: number; height: number; values: Float32Array; cellSize: [number, number]; geographic: boolean; sourceWidth: number; sourceHeight: number };

/** A TIFF whose directories are read: every image in it (full resolution first, then any overviews). Parsed once, then reused for every window. */
export type OpenTiff = { read: Read; ifds: Ifd[]; full: Ifd };

export async function openTiff(read: Read, size: number): Promise<OpenTiff> {
  const ifds = (await readIfds(read, size)).filter((i) => i.width > 0 && i.height > 0 && i.offsets.length);
  if (!ifds.length) throw new UnsupportedTiffError("No image data");
  return { read, ifds, full: ifds[0] };
}

function assertReadable(ifd: Ifd) {
  if (ifd.bits % 8 || ifd.bits > 64) throw new UnsupportedTiffError(`${ifd.bits}-bit samples aren't supported`);
  // Decoded samples are read little-endian ("II", what GDAL writes by default).
  if (!ifd.littleEndian && ifd.bits > 8) throw new UnsupportedTiffError("Big-endian TIFFs aren't supported for previews yet");
}

/**
 * Decoded strips and tiles, kept per image while it is open, so the next window or map tile over the same part of a file does not decompress it
 * again. Bounded by count per image; the oldest go first. A block being decoded is shared, never decoded twice at once.
 */
const decodedBlocks = new WeakMap<Ifd, { done: Map<number, Buffer>; pending: Map<number, Promise<Buffer>> }>();
const BLOCKS_PER_IMAGE = 256;

/** First-band values of one image, a pixel at a time, decoding each strip or tile once. A pixel whose block is already decoded comes back as a number, not a promise. */
function sampler(ifd: Ifd, read: Read) {
  const get = sampleReader(ifd);
  const bps = ifd.bits / 8;
  const spp = ifd.planar === 1 ? ifd.samples : 1;
  let store = decodedBlocks.get(ifd);
  if (!store) decodedBlocks.set(ifd, (store = { done: new Map(), pending: new Map() }));
  const { done: cache, pending } = store;
  const block = (index: number, w: number, rows: number): Promise<Buffer> => {
    const ready = cache.get(index);
    if (ready) return Promise.resolve(ready);
    let p = pending.get(index);
    if (!p) {
      p = (async () => {
        const raw = await read(ifd.offsets[index], ifd.counts[index] ?? 0);
        let b = Buffer.from(decompress(ifd, raw));
        const need = w * rows * spp * bps;
        if (b.length < need) b = Buffer.concat([b, Buffer.alloc(need - b.length)]);
        unpredict(ifd, b, w, rows);
        cache.set(index, b);
        if (cache.size > BLOCKS_PER_IMAGE) cache.delete(cache.keys().next().value!);
        return b;
      })().finally(() => pending.delete(index));
      pending.set(index, p);
    }
    return p;
  };
  const finish = (v: number) => (ifd.nodata !== null && v === ifd.nodata ? NaN : Number.isFinite(v) ? v : NaN);
  return (x: number, y: number): number | Promise<number> => {
    let index: number, w: number, rows: number, at: number;
    if (ifd.tileWidth && ifd.tileHeight) {
      const across = Math.ceil(ifd.width / ifd.tileWidth);
      index = Math.floor(y / ifd.tileHeight) * across + Math.floor(x / ifd.tileWidth);
      w = ifd.tileWidth;
      rows = ifd.tileHeight;
      at = ((y % ifd.tileHeight) * ifd.tileWidth + (x % ifd.tileWidth)) * spp;
    } else {
      const rps = Math.min(ifd.rowsPerStrip, ifd.height);
      index = Math.floor(y / rps);
      w = ifd.width;
      rows = Math.min(rps, ifd.height - index * rps);
      at = ((y - index * rps) * ifd.width + x) * spp;
    }
    const b = cache.get(index);
    if (b) return finish(get(b, at));
    return block(index, w, rows).then((bb) => finish(get(bb, at)));
  };
}

/**
 * The mean of the valid pixels under the source rectangle [x0, x1) × [y0, y1), looked at on a grid of at most 3 × 3 points (so the cost is bounded
 * however far a file is shrunk). Nodata counts as missing; a rectangle that is mostly missing is missing. Where the rectangle is no bigger than
 * a pixel this is just the pixel under its centre, so zooming in shows the file's own values and nothing invented.
 */
function meanOver(at: ReturnType<typeof sampler>, x0: number, y0: number, x1: number, y1: number, width: number, height: number): number | Promise<number> {
  const nx = Math.min(3, Math.max(1, Math.round(x1 - x0))), ny = Math.min(3, Math.max(1, Math.round(y1 - y0)));
  let sum = 0, n = 0;
  const waits: Promise<number>[] = [];
  for (let j = 0; j < ny; j++) {
    const y = Math.floor(y0 + ((j + 0.5) * (y1 - y0)) / ny);
    if (y < 0 || y >= height) continue;
    for (let i = 0; i < nx; i++) {
      const x = Math.floor(x0 + ((i + 0.5) * (x1 - x0)) / nx);
      if (x < 0 || x >= width) continue;
      const p = at(x, y);
      if (typeof p !== "number") waits.push(p);
      else if (!Number.isNaN(p)) (sum += p), n++;
    }
  }
  // Every sample was already decoded: answered at once, with no promise to wait on (this is almost every pixel).
  if (!waits.length) return n * 2 >= nx * ny && n > 0 ? sum / n : NaN;
  return Promise.all(waits).then((vs) => {
    for (const v of vs) if (!Number.isNaN(v)) (sum += v), n++;
    return n * 2 >= nx * ny && n > 0 ? sum / n : NaN;
  });
}

/** Lets other requests run between rows of a long read: the work in between is synchronous. */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * First band of the image as a grid of at most `maxSide` pixels on the long side (nodata → NaN).
 * Picks the smallest overview that's still at least `maxSide`, then shrinks it by averaging the pixels under each output pixel.
 */
export async function readGrid(read: Read, size: number, maxSide = 512): Promise<Grid> {
  const { ifds, full } = await openTiff(read, size);
  const candidates = [...ifds].sort((a, b) => a.width - b.width);
  const ifd = candidates.find((i) => Math.max(i.width, i.height) >= maxSide) ?? candidates[candidates.length - 1];
  assertReadable(ifd);

  const scale = Math.min(1, maxSide / Math.max(ifd.width, ifd.height));
  const outW = Math.max(1, Math.round(ifd.width * scale));
  const outH = Math.max(1, Math.round(ifd.height * scale));
  const values = new Float32Array(outW * outH).fill(NaN);
  const at = sampler(ifd, read);
  for (let oy = 0; oy < outH; oy++) {
    if (oy % 64 === 63) await breathe();
    for (let ox = 0; ox < outW; ox++) {
      const v = meanOver(at, ox / scale, oy / scale, (ox + 1) / scale, (oy + 1) / scale, ifd.width, ifd.height);
      values[oy * outW + ox] = typeof v === "number" ? v : await v;
    }
  }
  const px = ifd.pixelScale ?? [1, 1];
  const geographic = ifd.epsg !== null && ifd.epsg >= 4000 && ifd.epsg < 5000;
  return { width: outW, height: outH, values, cellSize: [px[0] / scale, px[1] / scale], geographic, sourceWidth: full.width, sourceHeight: full.height };
}

/** What a viewer needs to lay out tiles: the size, the cell size, and how many overview levels the file carries. */
export function describeTiff(open: OpenTiff) {
  const px = open.full.pixelScale ?? [1, 1];
  return {
    width: open.full.width,
    height: open.full.height,
    cellSize: px as [number, number],
    origin: open.full.origin,
    geographic: open.full.epsg !== null && open.full.epsg >= 4000 && open.full.epsg < 5000,
    epsg: open.full.epsg,
    overviews: open.ifds.length - 1,
  };
}

/** A window needs more strips or tiles than a preview may read; the viewer should ask for a smaller area. */
export class TooManyBlocksError extends UnsupportedTiffError {}

/**
 * The pixels of a rectangle of the full-resolution image (`x`, `y`, `w`, `h` in full-resolution pixels, which may run past the edges: those
 * come back as NaN), resampled to `outW` × `outH` by averaging the pixels under each output pixel (the pixel under its centre when zoomed in). Uses the smallest overview
 * that still has at least one pixel per output pixel, so zoomed-out windows of a COG read little. `maxBlocks` bounds the strips or
 * tiles it will decode; a file without overviews, zoomed far out, needs the viewer to ask for less.
 */
export async function readWindow(open: OpenTiff, win: { x: number; y: number; w: number; h: number }, outW: number, outH: number, maxBlocks = 600): Promise<Float32Array> {
  const { full } = open;
  const perOut = win.w / outW; // full-resolution pixels per output pixel
  const ifd = [...open.ifds].sort((a, b) => a.width - b.width).find((i) => (i.width / full.width) * perOut >= 1) ?? full;
  assertReadable(ifd);
  const sx = ifd.width / full.width;
  const sy = ifd.height / full.height;
  // How many blocks lie under the window at that level?
  const x0 = Math.max(0, Math.floor(win.x * sx)), x1 = Math.min(ifd.width - 1, Math.ceil((win.x + win.w) * sx));
  const y0 = Math.max(0, Math.floor(win.y * sy)), y1 = Math.min(ifd.height - 1, Math.ceil((win.y + win.h) * sy));
  if (x1 >= x0 && y1 >= y0) {
    const blocks = ifd.tileWidth && ifd.tileHeight
      ? (Math.floor(x1 / ifd.tileWidth) - Math.floor(x0 / ifd.tileWidth) + 1) * (Math.floor(y1 / ifd.tileHeight) - Math.floor(y0 / ifd.tileHeight) + 1)
      : Math.floor(y1 / Math.min(ifd.rowsPerStrip, ifd.height)) - Math.floor(y0 / Math.min(ifd.rowsPerStrip, ifd.height)) + 1;
    if (blocks > maxBlocks) throw new TooManyBlocksError(`This area needs ${blocks} blocks of the file; zoom in (the file has ${open.ifds.length > 1 ? "few" : "no"} overviews).`);
  }
  const at = sampler(ifd, open.read);
  const values = new Float32Array(outW * outH).fill(NaN);
  for (let oy = 0; oy < outH; oy++) {
    if (oy % 64 === 63) await breathe();
    const fy = win.y + ((oy + 0.5) * win.h) / outH;
    if (fy < 0 || fy >= full.height) continue;
    const top = (win.y + (oy * win.h) / outH) * sy, bottom = (win.y + ((oy + 1) * win.h) / outH) * sy;
    for (let ox = 0; ox < outW; ox++) {
      const fx = win.x + ((ox + 0.5) * win.w) / outW;
      if (fx < 0 || fx >= full.width) continue;
      const v = meanOver(at, (win.x + (ox * win.w) / outW) * sx, top, (win.x + ((ox + 1) * win.w) / outW) * sx, bottom, ifd.width, ifd.height);
      values[oy * outW + ox] = typeof v === "number" ? v : await v;
    }
  }
  return values;
}

/** The value of one full-resolution pixel (NaN for nodata or outside the image), and where it is on the map when the file says. */
export async function readPixel(open: OpenTiff, col: number, row: number): Promise<{ value: number | null; x: number | null; y: number | null }> {
  const { full } = open;
  if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= full.width || row >= full.height) return { value: null, x: null, y: null };
  assertReadable(full);
  const p = sampler(full, open.read)(col, row);
  const v = typeof p === "number" ? p : await p;
  const px = full.pixelScale, o = full.origin;
  return { value: Number.isNaN(v) ? null : v, x: o && px ? o[0] + (col + 0.5) * px[0] : null, y: o && px ? o[1] - (row + 0.5) * px[1] : null };
}
