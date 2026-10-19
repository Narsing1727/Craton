// Previews drawn from real bytes: the TIFF decoder (compression, predictors, tiles, overviews),
// hillshade thumbnails, elevation-change heatmaps and shapefile SVGs through the API.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { catchments, levees, shapefile } from "../src/dev/fixtures.ts";
import { openTiff, readGrid, readPixel, readWindow, TooManyBlocksError } from "../src/render/tiff.ts";
import { encodePng } from "../src/render/png.ts";
import { warmCommit } from "../src/render/previews.ts";

// ── A small TIFF writer, so the decoder is tested against encodings the fixtures don't produce ──

/** TIFF LZW encoder (MSB-first, 9–12 bit codes), mirroring libtiff's code-width changes. */
function lzwEncode(data: Buffer) {
  const out: number[] = [];
  let acc = 0, nbits = 0, width = 9, next = 258;
  const dict = new Map<number, number>();
  const put = (code: number) => {
    for (let i = width - 1; i >= 0; i--) {
      acc = (acc << 1) | ((code >> i) & 1);
      if (++nbits === 8) {
        out.push(acc);
        acc = nbits = 0;
      }
    }
  };
  put(256);
  let prefix = data[0];
  for (let i = 1; i < data.length; i++) {
    const key = prefix * 256 + data[i];
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    put(prefix);
    dict.set(key, next++);
    if (next >= 1 << width) width++;
    prefix = data[i];
  }
  put(prefix);
  next++;
  if (next >= 1 << width) width++;
  put(257);
  if (nbits) out.push(acc << (8 - nbits));
  return Buffer.from(out);
}

type Image = { width: number; height: number; values: number[]; kind: "f32" | "i16"; compression: 1 | 5 | 8; predictor: 1 | 2 | 3; tile?: number; rowsPerStrip?: number; nodata?: number };

function encodeBlock(img: Image, xs: number, ys: number, w: number, h: number) {
  const bps = img.kind === "f32" ? 4 : 2;
  const buf = Buffer.alloc(w * h * bps);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = xs + x, sy = ys + y;
    const v = sx < img.width && sy < img.height ? img.values[sy * img.width + sx] : 0;
    if (img.kind === "f32") buf.writeFloatLE(v, (y * w + x) * 4);
    else buf.writeInt16LE(v, (y * w + x) * 2);
  }
  for (let y = 0; y < h; y++) {
    const row = buf.subarray(y * w * bps, (y + 1) * w * bps);
    if (img.predictor === 2) for (let x = w - 1; x > 0; x--) row.writeInt16LE(((row.readInt16LE(x * 2) - row.readInt16LE((x - 1) * 2) + 0x8000) & 0xffff) - 0x8000, x * 2);
    if (img.predictor === 3) {
      const planes = Buffer.alloc(row.length);
      for (let x = 0; x < w; x++) for (let k = 0; k < bps; k++) planes[k * w + x] = row[x * bps + (bps - 1 - k)];
      for (let i = planes.length - 1; i > 0; i--) planes[i] = (planes[i] - planes[i - 1]) & 0xff;
      planes.copy(row);
    }
  }
  return img.compression === 8 ? zlib.deflateSync(buf) : img.compression === 5 ? lzwEncode(buf) : buf;
}

/** Little-endian TIFF with one IFD per image (the first is full resolution, the rest overviews). */
function writeTiff(images: Image[]) {
  const parts: Buffer[] = [Buffer.alloc(8)];
  let offset = 8;
  const add = (b: Buffer) => {
    const at = offset;
    parts.push(b);
    offset += b.length;
    if (offset % 2) {
      parts.push(Buffer.alloc(1));
      offset++;
    }
    return at;
  };
  const ifdOffsets: number[] = [];
  const patches: { at: number; value: number }[] = [];
  images.forEach((img, index) => {
    const blocks: Buffer[] = [];
    if (img.tile) {
      for (let ty = 0; ty < img.height; ty += img.tile) for (let tx = 0; tx < img.width; tx += img.tile) blocks.push(encodeBlock(img, tx, ty, img.tile, img.tile));
    } else {
      const rps = img.rowsPerStrip ?? img.height;
      for (let y = 0; y < img.height; y += rps) blocks.push(encodeBlock(img, 0, y, img.width, Math.min(rps, img.height - y)));
    }
    const blockOffsets = blocks.map(add);
    const longs = (v: number[]) => {
      const b = Buffer.alloc(v.length * 4);
      v.forEach((n, i) => b.writeUInt32LE(n, i * 4));
      return b;
    };
    const offsetsAt = add(longs(blockOffsets));
    const countsAt = add(longs(blocks.map((b) => b.length)));
    const nodataAt = img.nodata !== undefined ? add(Buffer.from(`${img.nodata}\0`, "latin1")) : 0;
    // Only the full-resolution image carries georeferencing, as in a COG.
    const scaleAt = index === 0 ? add(Buffer.from(new Float64Array([2, 2, 0]).buffer)) : 0;
    const tieAt = index === 0 ? add(Buffer.from(new Float64Array([0, 0, 0, 1000, 5000, 0]).buffer)) : 0;
    const e: [number, number, number, number][] = [
      [256, 4, 1, img.width],
      [257, 4, 1, img.height],
      [258, 3, 1, img.kind === "f32" ? 32 : 16],
      [259, 3, 1, img.compression],
      [262, 3, 1, 1],
      [277, 3, 1, 1],
      [317, 3, 1, img.predictor],
      [339, 3, 1, img.kind === "f32" ? 3 : 2],
    ];
    if (scaleAt) e.push([33550, 12, 3, scaleAt], [33922, 12, 6, tieAt]);
    if (img.tile) e.push([322, 3, 1, img.tile], [323, 3, 1, img.tile], [324, 4, blocks.length, blocks.length === 1 ? blockOffsets[0] : offsetsAt], [325, 4, blocks.length, blocks.length === 1 ? blocks[0].length : countsAt]);
    else e.push([273, 4, blocks.length, blocks.length === 1 ? blockOffsets[0] : offsetsAt], [278, 4, 1, img.rowsPerStrip ?? img.height], [279, 4, blocks.length, blocks.length === 1 ? blocks[0].length : countsAt]);
    if (img.nodata !== undefined) e.push([42113, 2, String(img.nodata).length + 1, nodataAt]);
    e.sort((a, b) => a[0] - b[0]);
    const ifd = Buffer.alloc(2 + e.length * 12 + 4);
    ifd.writeUInt16LE(e.length, 0);
    e.forEach(([tag, type, n, v], i) => {
      const o = 2 + i * 12;
      ifd.writeUInt16LE(tag, o);
      ifd.writeUInt16LE(type, o + 2);
      ifd.writeUInt32LE(n, o + 4);
      if (type === 3 && n === 1) ifd.writeUInt16LE(v, o + 8);
      else ifd.writeUInt32LE(v, o + 8);
    });
    const at = add(ifd);
    ifdOffsets.push(at);
    patches.push({ at: at + 2 + e.length * 12, value: 0 });
  });
  const file = Buffer.concat(parts);
  file.write("II", 0, "latin1");
  file.writeUInt16LE(42, 2);
  file.writeUInt32LE(ifdOffsets[0], 4);
  patches.forEach((p, i) => file.writeUInt32LE(ifdOffsets[i + 1] ?? 0, p.at));
  return file;
}

const readerOf = (b: Buffer) => async (o: number, l: number) => b.subarray(o, o + l);

test("decodes Deflate with the floating-point predictor, in tiles that overhang the edge", async () => {
  const width = 40, height = 24;
  const values = Array.from({ length: width * height }, (_, i) => 100 + Math.sin(i / 7) * 12.5 + i / 1000);
  values[5] = -9999;
  const file = writeTiff([{ width, height, values, kind: "f32", compression: 8, predictor: 3, tile: 16, nodata: -9999 }]);
  const g = await readGrid(readerOf(file), file.length, 4096);
  assert.equal(g.width, 40);
  assert.equal(g.height, 24);
  assert.ok(Number.isNaN(g.values[5]), "nodata becomes NaN");
  for (const i of [0, 17, 39, 40, 500, 959]) assert.equal(g.values[i], Math.fround(values[i]), `pixel ${i}`);
});

test("decodes LZW with the horizontal predictor, in multi-row strips", async () => {
  const width = 30, height = 17;
  const values = Array.from({ length: width * height }, (_, i) => ((i * 37) % 900) - 300);
  const file = writeTiff([{ width, height, values, kind: "i16", compression: 5, predictor: 2, rowsPerStrip: 5 }]);
  const g = await readGrid(readerOf(file), file.length, 4096);
  assert.deepEqual(Array.from(g.values), values);
});

test("reads the smallest overview that is still big enough", async () => {
  const full = { width: 64, height: 64, values: new Array(64 * 64).fill(10), kind: "i16" as const, compression: 8 as const, predictor: 1 as const, rowsPerStrip: 16 };
  const overview = { ...full, width: 16, height: 16, values: new Array(256).fill(20) };
  const file = writeTiff([full, overview]);
  const small = await readGrid(readerOf(file), file.length, 16);
  assert.deepEqual([small.width, small.sourceWidth, small.values[0]], [16, 64, 20]);
  assert.deepEqual(small.cellSize, [8, 8], "cell size comes from the full image's scale");
  const big = await readGrid(readerOf(file), file.length, 32);
  assert.deepEqual([big.width, big.values[0]], [32, 10], "no overview is big enough, so the full image is downsampled");
});

// ── Through the API, on the sample project ──

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function get(path: string, who: string | null) {
  const headers: Record<string, string> = who ? { authorization: `Bearer ${tokens[who]}` } : {};
  const res = await app.request(`/v1${path}`, { headers });
  const body = Buffer.from(await res.arrayBuffer());
  const meta = res.headers.get("x-craton-render");
  return { status: res.status, type: res.headers.get("content-type"), body, meta: meta ? JSON.parse(meta) : null };
}

/** Decode an 8-bit RGB or RGBA PNG (all five filters) to RGBA. */
function decodePng(png: Buffer) {
  const width = png.readUInt32BE(16), height = png.readUInt32BE(20), colour = png[25];
  assert.ok(colour === 2 || colour === 6, `unexpected colour type ${colour}`);
  const bpp = colour === 2 ? 3 : 4, stride = width * bpp;
  const idat: Buffer[] = [];
  for (let o = 8; o < png.length;) {
    const len = png.readUInt32BE(o);
    if (png.toString("latin1", o + 4, o + 8) === "IDAT") idat.push(png.subarray(o + 8, o + 8 + len));
    o += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = new Uint8Array(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const x = raw[y * (stride + 1) + 1 + i];
      const a = i >= bpp ? px[y * stride + i - bpp] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = i >= bpp && y > 0 ? px[(y - 1) * stride + i - bpp] : 0;
      px[y * stride + i] = (x + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0)) & 255;
    }
  }
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = px[i * bpp];
    rgba[i * 4 + 1] = px[i * bpp + 1];
    rgba[i * 4 + 2] = px[i * bpp + 2];
    rgba[i * 4 + 3] = bpp === 4 ? px[i * bpp + 3] : 255;
  }
  return { width, height, colour, rgba };
}

/** RGBA pixel of a PNG written by our encoder. */
function pixel(png: Buffer, x: number, y: number) {
  const d = decodePng(png);
  const at = (y * d.width + x) * 4;
  return [...d.rgba.subarray(at, at + 4)];
}

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "sol"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  const res = await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private", sample: true }) });
  assert.equal(res.status, 201, await res.text());
});

test("a GeoTIFF renders as a hillshade PNG, with nodata transparent", async () => {
  const r = await get("/repos/rhea/basin/render/main/terrain/basin_dem.tif?size=256", "rhea");
  assert.equal(r.status, 200);
  assert.equal(r.type, "image/png");
  assert.deepEqual([...r.body.subarray(1, 4)].map((c) => String.fromCharCode(c)).join(""), "PNG");
  assert.deepEqual([r.meta.width, r.meta.height, r.meta.sourceWidth], [256, 256, 512]);
  assert.ok(r.meta.max > r.meta.min, "a real elevation range");
  assert.equal(pixel(r.body, 0, 0)[3], 0, "the nodata corner is transparent");
  assert.equal(pixel(r.body, 128, 128)[3], 255);
  // Shading varies across the terrain; it isn't a flat fill.
  const tones = new Set([10, 60, 120, 200].map((v) => pixel(r.body, v, v)[0]));
  assert.ok(tones.size > 1);
});

test("an elevation-change heatmap marks exactly the re-surveyed rows", async () => {
  const r = await get("/repos/rhea/basin/render/sample-resurvey/terrain/basin_dem.tif?base=main", "rhea");
  assert.equal(r.status, 200);
  // Rows 420–480 of 512 changed by −0.35 m.
  assert.ok(Math.abs(r.meta.changedPercent - (60 / 512) * 100) < 0.5, String(r.meta.changedPercent));
  assert.ok(Math.abs(r.meta.minChange + 0.35) < 1e-3 && Math.abs(r.meta.maxChange + 0.35) < 1e-3);
  const lowered = pixel(r.body, 256, 450), unchanged = pixel(r.body, 256, 100);
  assert.ok(lowered[0] > lowered[2] + 40, `losses are red: ${lowered}`);
  assert.ok(Math.abs(unchanged[0] - unchanged[1]) < 12, `unchanged ground is neutral: ${unchanged}`);
});

test("a shapefile renders as SVG, and a diff counts added, changed and unchanged features", async () => {
  const plain = await get("/repos/rhea/basin/render/main/vectors/catchment.shp", "rhea");
  assert.equal(plain.type, "image/svg+xml");
  assert.equal(plain.meta.features, 6);
  assert.equal(plain.body.toString().match(/<path /g)?.length, 6);
  assert.ok(!plain.body.toString().includes("<style"), "no style block, so a strict CSP can't blank it");

  const features = catchments(7);
  features[2].ring = features[2].ring.map(([x, y]) => [x + 300, y]);
  const set = shapefile(features);
  const owner = await ctx.db.get("SELECT o.id FROM owners o WHERE o.handle = 'rhea'") as { id: number };
  await commitFiles(ctx, await getRepoFor(ctx, "rhea", "basin", owner.id), {
    branch: "catchments-v2",
    from: "main",
    author: "rhea",
    message: "Split catchment 7, move catchment 3",
    timestamp: new Date(),
    changes: Object.fromEntries(Object.entries(set).map(([ext, buf]) => [`vectors/catchment.${ext}`, buf])),
  });
  const diff = await get("/repos/rhea/basin/render/catchments-v2/vectors/catchment.shp?base=main", "rhea");
  assert.deepEqual(diff.meta.diff, { added: 1, removed: 0, changed: 1, same: 5 });
  assert.ok(diff.body.toString().includes("#e0837d") === false, "nothing removed, so nothing drawn as removed");
});

test("a change only in the attribute table still counts as a changed feature", async () => {
  const owner = await ctx.db.get("SELECT o.id FROM owners o WHERE o.handle = 'rhea'") as { id: number };
  const repo = await getRepoFor(ctx, "rhea", "basin", owner.id);
  const files = (crest: number) => Object.fromEntries(Object.entries(shapefile(levees(crest))).map(([ext, buf]) => [`vectors/levees.${ext}`, buf]));
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Levees", timestamp: new Date(), changes: files(4.0) });
  await commitFiles(ctx, repo, { branch: "raise-crest", from: "main", author: "rhea", message: "Raise crest", timestamp: new Date(), changes: files(4.5) });
  const r = await get("/repos/rhea/basin/render/raise-crest/vectors/levees.shp?base=main", "rhea");
  assert.deepEqual(r.meta.diff, { added: 0, removed: 0, changed: 6, same: 0 });
});

test("files without a preview, and repositories you can't see", async () => {
  const readme = await get("/repos/rhea/basin/render/main/README.md", "rhea");
  assert.equal(readme.status, 415);
  assert.equal(JSON.parse(readme.body.toString()).error.code, "no_preview");
  assert.equal((await get("/repos/rhea/basin/render/main/terrain/basin_dem.tif", "sol")).status, 404);
  assert.equal((await get("/repos/rhea/basin/render/main/terrain/basin_dem.tif", null)).status, 404);
});

test("PNG encoding round-trips every pixel, including transparent ones", () => {
  const w = 96, h = 64;
  const img = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = Math.round(110 + 80 * Math.sin(x / 9) * Math.cos(y / 7));
    img.set([v, v + 6, Math.min(255, v + 18), x < 8 && y < 8 ? 0 : 255], (y * w + x) * 4);
  }
  const d = decodePng(encodePng(w, h, img));
  assert.equal(d.colour, 6);
  assert.deepEqual(d.rgba, img);
});

// ── Caching and compression ────────────────────────────────────────────────

async function raw(path: string, headers: Record<string, string> = {}) {
  return app.request(`/v1${path}`, { headers: { authorization: `Bearer ${tokens.rhea}`, ...headers } });
}

test("a preview carries a content ETag, answers If-None-Match with a body-less 304, and only commit-pinned ones are immutable", async () => {
  const url = "/repos/rhea/basin/render/main/terrain/basin_dem.tif?size=128";
  const first = await raw(url);
  assert.equal(first.status, 200);
  const tag = first.headers.get("etag");
  assert.match(tag ?? "", /^"[0-9a-f]{32}"$/);
  assert.equal(first.headers.get("cache-control"), "private, max-age=300", "behind a branch name it can change after a push");

  const again = await raw(url, { "if-none-match": tag! });
  assert.equal(again.status, 304);
  assert.equal((await again.arrayBuffer()).byteLength, 0);
  assert.equal(again.headers.get("etag"), tag);

  assert.equal((await raw(url, { "if-none-match": '"someone-elses"' })).status, 200, "a stale tag just gets the image");
  assert.notEqual((await raw("/repos/rhea/basin/render/main/terrain/basin_dem.tif?size=256")).headers.get("etag"), tag, "a different size is a different preview");

  // Pinned to the commit id, the same bytes can never change: cache for a year.
  const branches = (await (await raw("/repos/rhea/basin/refs")).json()) as { branches: { name: string; commit_id: string }[] };
  const sha = branches.branches.find((b) => b.name === "main")!.commit_id;
  const pinned = await raw(`/repos/rhea/basin/render/${sha}/terrain/basin_dem.tif?size=128`);
  assert.equal(pinned.headers.get("cache-control"), "private, max-age=31536000, immutable");
  assert.equal(pinned.headers.get("etag"), tag, "same bytes, same preview, whichever way the ref is spelled");
});

test("a re-survey changes the preview's ETag; a private repository's preview is still refused to others", async () => {
  const a = (await raw("/repos/rhea/basin/render/main/terrain/basin_dem.tif?size=128")).headers.get("etag");
  const b = (await raw("/repos/rhea/basin/render/sample-resurvey/terrain/basin_dem.tif?size=128")).headers.get("etag");
  assert.ok(a && b && a !== b);
  const denied = await app.request("/v1/repos/rhea/basin/render/main/terrain/basin_dem.tif?size=128", { headers: { authorization: `Bearer ${tokens.sol}`, "if-none-match": a! } });
  assert.notEqual(denied.status, 304, "knowing a tag must not reveal that a private file exists");
  assert.ok(denied.status === 403 || denied.status === 404);
});

test("JSON is compressed when asked (never otherwise), PNGs are left alone, and reads get ETags", async () => {
  const gz = await raw("/repos/rhea/basin/commits", { "accept-encoding": "gzip" });
  assert.equal(gz.status, 200);
  assert.equal(gz.headers.get("content-encoding"), "gzip");
  assert.match(gz.headers.get("vary") ?? "", /accept-encoding/i);
  assert.ok(JSON.parse(zlib.gunzipSync(Buffer.from(await gz.arrayBuffer())).toString()), "decodes back to the same JSON");

  const plain = await raw("/repos/rhea/basin/commits");
  assert.equal(plain.headers.get("content-encoding"), null, "no Accept-Encoding, no compression");

  const tag = plain.headers.get("etag");
  assert.match(tag ?? "", /^W\/"/);
  const cond = await raw("/repos/rhea/basin/commits", { "if-none-match": tag! });
  assert.equal(cond.status, 304);

  const png = await raw("/repos/rhea/basin/render/main/terrain/basin_dem.tif?size=128", { "accept-encoding": "gzip" });
  assert.equal(png.headers.get("content-encoding"), null, "PNG is already compressed");
});

test("warming a pushed commit draws its previews ahead of the first viewer", async () => {
  const refs = (await (await raw("/repos/rhea/basin/refs")).json()) as { branches: { name: string; commit_id: string }[] };
  const tip = refs.branches.find((b) => b.name === "sample-resurvey")!.commit_id;
  const ownerId = (await ctx.db.get("SELECT id FROM owners WHERE handle = ?", "rhea") as { id: number }).id;
  const repo = await getRepoFor(ctx, "rhea", "basin", ownerId);
  const timed = async (size: number) => {
    const t = performance.now();
    const res = await raw(`/repos/rhea/basin/render/sample-resurvey/terrain/basin_dem.tif?base=main&size=${size}`);
    assert.equal(res.status, 200);
    await res.arrayBuffer();
    return performance.now() - t;
  };
  const cold = await timed(320); // a size the warm-up doesn't cover
  await warmCommit(ctx, repo, tip);
  const warmed = await timed(384);
  assert.ok(warmed < cold / 2, `warmed ${warmed.toFixed(0)}ms should be well under cold ${cold.toFixed(0)}ms`);
});

test("raster statistics describe both versions and the re-survey change exactly", async () => {
  const r = await app.request("/v1/repos/rhea/basin/raster-stats/sample-resurvey/terrain/basin_dem.tif?base=main", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  assert.equal(r.status, 200);
  const s = (await r.json()) as {
    sameGrid: boolean; before: { validCells: number; min: number; max: number; mean: number; p50: number };
    after: { validCells: number; mean: number }; histogram: { before: number[]; after: number[] };
    change: { meanChange: number; rmse: number; raisedPercent: number; loweredPercent: number; changedCells: number; comparedCells: number };
  };
  assert.equal(s.sameGrid, true);
  assert.ok(s.before.validCells > 0 && s.before.max > s.before.min && s.before.p50 >= s.before.min && s.before.p50 <= s.before.max);
  assert.equal(s.histogram.before.reduce((x, y) => x + y, 0), s.before.validCells, "every valid cell is in one bin");
  assert.equal(s.histogram.after.reduce((x, y) => x + y, 0), s.after.validCells);
  // Rows 420-480 of 512 were lowered by 0.35 m; nothing was raised.
  assert.equal(s.change.raisedPercent, 0);
  assert.ok(Math.abs(s.change.loweredPercent - (60 / 512) * 100) < 0.5, String(s.change.loweredPercent));
  assert.ok(s.change.meanChange < 0 && s.after.mean < s.before.mean, "the mean ground level dropped");
  // Mean change is -0.35 m over the lowered share of the compared cells; RMSE follows from the same numbers.
  const share = s.change.changedCells / s.change.comparedCells;
  assert.ok(Math.abs(s.change.meanChange + 0.35 * share) < 1e-3, String(s.change.meanChange));
  assert.ok(Math.abs(s.change.rmse - 0.35 * Math.sqrt(share)) < 1e-3, String(s.change.rmse));
});

test("raster statistics need a base version and a GeoTIFF", async () => {
  const noBase = await app.request("/v1/repos/rhea/basin/raster-stats/main/terrain/basin_dem.tif", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  assert.equal(noBase.status, 400);
  const shp = await app.request("/v1/repos/rhea/basin/raster-stats/main/vectors/catchment.shp?base=main", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  assert.equal(shp.status, 415);
});

test("a shapefile's file info lists its attribute fields from the dBase header", async () => {
  const r = await app.request("/v1/repos/rhea/basin/file/main/vectors/catchment.shp", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  assert.equal(r.status, 200);
  const info = (await r.json()) as { vector: { features: number; fields: { name: string; type: string; length: number }[] } };
  assert.equal(info.vector.features, 6);
  assert.deepEqual(info.vector.fields, [{ name: "NAME", type: "C", length: 32, decimals: 0 }]);
});

test("windows: zoomed in reads exact pixels, zoomed out reads an overview, outside the image is empty, and a huge area is refused", async () => {
  const width = 64, height = 48;
  const values = Array.from({ length: width * height }, (_, i) => (i % width) * 10 + Math.floor(i / width));
  const overview = { width: 16, height: 12, values: Array.from({ length: 16 * 12 }, () => 7777), kind: "i16" as const, compression: 8 as const, predictor: 1 as const, rowsPerStrip: 12 };
  const full = { width, height, values, kind: "i16" as const, compression: 8 as const, predictor: 1 as const, tile: 16 };
  const file = writeTiff([full, overview]);
  const open = await openTiff(readerOf(file), file.length);

  // 8 × 8 pixels at (20, 10), one image pixel per output pixel: the exact values.
  const near = await readWindow(open, { x: 20, y: 10, w: 8, h: 8 }, 8, 8);
  assert.equal(near[0], 20 * 10 + 10);
  assert.equal(near[7], 27 * 10 + 10);
  assert.equal(near[63], 27 * 10 + 17);

  // Zoomed far out (4 image pixels per output pixel) the 16 × 12 overview is the right level.
  const far = await readWindow(open, { x: 0, y: 0, w: 64, h: 48 }, 16, 12);
  assert.ok(far.every((v) => v === 7777), "drawn from the overview");

  // Half outside the image on the left and the top: those pixels are empty, the rest are real.
  const edge = await readWindow(open, { x: -4, y: -4, w: 8, h: 8 }, 8, 8);
  assert.ok(Number.isNaN(edge[0]) && Number.isNaN(edge[3]));
  assert.equal(edge[4 * 8 + 4], 0);

  // Asked for more blocks than allowed.
  await assert.rejects(readWindow(open, { x: 0, y: 0, w: 64, h: 48 }, 64, 48, 3), TooManyBlocksError);
});

test("a raster can be zoomed: layout first, then tiles that cover the image, join without seams, and are cached", async () => {
  const info = await get("/repos/rhea/basin/tileinfo/main/terrain/basin_dem.tif", "rhea");
  assert.equal(info.status, 200);
  const layout = JSON.parse(info.body.toString());
  assert.deepEqual([layout.width, layout.height, layout.tileSize, layout.maxZoom], [512, 512, 256, 1]);
  assert.ok(layout.max > layout.min);

  const whole = await get("/repos/rhea/basin/tiles/main/0/0/0/terrain/basin_dem.tif", "rhea");
  assert.equal(whole.status, 200);
  assert.equal(whole.type, "image/png");
  assert.deepEqual([whole.body.readUInt32BE(16), whole.body.readUInt32BE(20)], [256, 256]);

  const topLeft = await get("/repos/rhea/basin/tiles/main/1/0/0/terrain/basin_dem.tif", "rhea");
  const topRight = await get("/repos/rhea/basin/tiles/main/1/1/0/terrain/basin_dem.tif", "rhea");
  assert.deepEqual([topLeft.body.readUInt32BE(16), topLeft.body.readUInt32BE(20)], [256, 256]);
  assert.equal(pixel(topLeft.body, 0, 0)[3], 0, "the nodata corner is transparent at full detail");
  // Across the seam between two tiles the shading continues: no jump the size of a different tile.
  const a = pixel(topLeft.body, 255, 100)[0], b = pixel(topRight.body, 0, 100)[0];
  assert.ok(Math.abs(a - b) < 40, `tiles join (${a} next to ${b})`);

  assert.equal((await get("/repos/rhea/basin/tiles/main/1/2/0/terrain/basin_dem.tif", "rhea")).status, 404, "past the right edge");
  assert.equal((await get("/repos/rhea/basin/tiles/main/2/0/0/terrain/basin_dem.tif", "rhea")).status, 404, "deeper than the image");
  assert.equal((await get("/repos/rhea/basin/tiles/main/x/0/0/terrain/basin_dem.tif", "rhea")).status, 400);
  assert.equal((await get("/repos/rhea/basin/tiles/main/0/0/0/terrain/basin_dem.tif", "sol")).status, 404, "a private repository stays private");
  assert.equal((await get("/repos/rhea/basin/tiles/main/0/0/0/README.md", "rhea")).status, 415);

  const first = await app.request("/v1/repos/rhea/basin/tiles/main/1/0/0/terrain/basin_dem.tif", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  const etag = first.headers.get("etag");
  assert.ok(etag);
  const again = await app.request("/v1/repos/rhea/basin/tiles/main/1/0/0/terrain/basin_dem.tif", { headers: { authorization: `Bearer ${tokens.rhea}`, "if-none-match": etag! } });
  assert.equal(again.status, 304);
});

test("shrinking averages the pixels it covers, and a pixel probe reports the value and where it is on the map", async () => {
  // A checkerboard of 0 and 100 averages to 50 at every scale it is shrunk to; point-sampling would give 0 or 100 and a moiré.
  const width = 64, height = 64;
  const board = Array.from({ length: width * height }, (_, i) => (((i % width) + Math.floor(i / width)) % 2 ? 100 : 0));
  const file = writeTiff([{ width, height, values: board, kind: "i16", compression: 8, predictor: 1, rowsPerStrip: 16 }]);
  const small = await readGrid(readerOf(file), file.length, 16);
  assert.equal(small.width, 16);
  assert.ok(small.values.every((v) => Math.abs(v - 50) <= 25 && v !== 0 && v !== 100), "averaged, not sampled");
  assert.ok(Math.abs(small.values.reduce((s, v) => s + v, 0) / small.values.length - 50) < 15);
  const open = await openTiff(readerOf(file), file.length);
  const far = await readWindow(open, { x: 0, y: 0, w: 64, h: 64 }, 8, 8);
  assert.ok(far.every((v) => v > 0 && v < 100));

  // The tiepoint and pixel size give the map position of a pixel's centre; the row counts down from the top, so the northing falls.
  assert.deepEqual(open.full.origin, [1000, 5000]);
  assert.deepEqual(await readPixel(open, 0, 0), { value: 0, x: 1001, y: 4999 });
  assert.deepEqual(await readPixel(open, 3, 2), { value: 100, x: 1007, y: 4995 });
  assert.deepEqual(await readPixel(open, 64, 0), { value: null, x: null, y: null }, "outside the image");
});

test("the pixel endpoint answers for a column and row, and refuses nonsense and non-rasters", async () => {
  const ok = await get("/repos/rhea/basin/pixel/main/terrain/basin_dem.tif?column=100&row=100", "rhea");
  assert.equal(ok.status, 200);
  const body = JSON.parse(ok.body.toString());
  assert.deepEqual([body.column, body.row], [100, 100]);
  assert.equal(typeof body.value, "number");
  const outside = JSON.parse((await get("/repos/rhea/basin/pixel/main/terrain/basin_dem.tif?column=99999&row=0", "rhea")).body.toString());
  assert.equal(outside.value, null);
  assert.equal((await get("/repos/rhea/basin/pixel/main/terrain/basin_dem.tif?column=x&row=0", "rhea")).status, 400);
  assert.equal((await get("/repos/rhea/basin/pixel/main/terrain/basin_dem.tif", "rhea")).status, 400);
  assert.equal((await get("/repos/rhea/basin/pixel/main/README.md?column=0&row=0", "rhea")).status, 415);
  assert.equal((await get("/repos/rhea/basin/pixel/main/terrain/basin_dem.tif?column=1&row=1", "sol")).status, 404, "a private repository stays private");
});

test("a shapefile's features come as data: geometry, and each row of its attribute table", async () => {
  const r = await get("/repos/rhea/basin/features/main/vectors/catchment.shp", "rhea");
  assert.equal(r.status, 200);
  const data = JSON.parse(r.body.toString()) as { count: number; shown: number; thinned: boolean; bbox: number[]; fields: { name: string }[]; features: { i: number; kind: string; parts: number[][]; props: Record<string, unknown> }[] };
  assert.equal(data.count, 6);
  assert.equal(data.shown, 6);
  assert.equal(data.thinned, false);
  assert.deepEqual(data.fields.map((f) => f.name), ["NAME"]);
  assert.deepEqual(data.features.map((f) => f.props.NAME), ["Sub-catchment 1", "Sub-catchment 2", "Sub-catchment 3", "Sub-catchment 4", "Sub-catchment 5", "Sub-catchment 6"]);
  const first = data.features[0];
  assert.equal(first.kind, "polygon");
  assert.equal(first.parts.length, 1);
  assert.equal(first.parts[0].length, 13 * 2, "13 points of an x and a y");
  assert.ok(first.parts[0][0] >= data.bbox[0] && first.parts[0][0] <= data.bbox[2]);

  const again = await app.request("/v1/repos/rhea/basin/features/main/vectors/catchment.shp", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  assert.ok(again.headers.get("etag"));
  assert.equal((await app.request("/v1/repos/rhea/basin/features/main/vectors/catchment.shp", { headers: { authorization: `Bearer ${tokens.rhea}`, "if-none-match": again.headers.get("etag")! } })).status, 304);
  assert.equal((await get("/repos/rhea/basin/features/main/README.md", "rhea")).status, 415);
  assert.equal((await get("/repos/rhea/basin/features/main/vectors/catchment.shp", "sol")).status, 404, "a private repository stays private");
});
