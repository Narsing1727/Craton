// Real previews from stored bytes: a hillshaded thumbnail of a raster, an elevation-change heatmap
// between two versions, and an SVG of a shapefile's geometry (with changed features highlighted).
// Results are cached in memory by blob id, since blobs never change.

import type { Ctx } from "../services/context.ts";
import { notFound, badRequest } from "../services/context.ts";
import type { RepoRow } from "../services/repos.ts";
import { BlobReader, readChunk } from "../services/chunks.ts";
import { readLasHeader } from "../checks/las.ts";
import { getObject, resolveRef } from "../services/history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { encodePng } from "./png.ts";
import { getCache } from "../cache/cache.ts";
import { readDbfFields, type DbfField } from "../services/files.ts";
import { epsgFromWkt } from "../checks/vector.ts";
import { lit, ramp } from "./ramps.ts";
import { projector } from "./geo.ts";
import { describeTiff, openTiff, readGrid, readPixel, readWindow, UnsupportedTiffError, type Grid, type OpenTiff } from "./tiff.ts";

const cache = new Map<string, { at: number; value: unknown }>();
/** How many pictures and numbers were actually drawn (not served from the cache): what a test of the warm-up looks at. */
export const drawn = { count: 0 };
function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) {
    hit.at = Date.now();
    return Promise.resolve(hit.value as T);
  }
  drawn.count++;
  return make().then((value) => {
    cache.set(key, { at: Date.now(), value });
    if (cache.size > 200) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0][0];
      cache.delete(oldest);
    }
    return value;
  });
}

/**
 * Rendered images are a pure function of the stored data, so they never go stale and are worth sharing: with Redis configured, a tile
 * one server drew is served by every server, and survives a restart. (With only in-process memory there is nothing to share, and the
 * local copy above is the cache.)
 */
const sharedImages = () => (getCache().kind === "redis" ? getCache() : null);
const IMAGE_TTL_SECONDS = 24 * 60 * 60;

/** A picture with its numbers, as one value: the numbers (JSON) on the first line, then the PNG. */
const packImage = (meta: object, png: Buffer) => Buffer.concat([Buffer.from(`${JSON.stringify(meta)}
`), png]);
function unpackImage<M>(bytes: Buffer): { meta: M; png: Buffer } {
  const end = bytes.indexOf(10);
  return { meta: JSON.parse(bytes.subarray(0, end).toString("utf8")) as M, png: bytes.subarray(end + 1) };
}

/** Bump when a preview's pixels or SVG would change for the same bytes, so cached copies are replaced. */
export const RENDER_VERSION = 5;

/**
 * What a preview is made of, without drawing it: the blobs involved plus the size. Previews are a
 * pure function of this, so it is the cache identity, and the basis of the HTTP ETag. Null when
 * the file doesn't exist or has no preview (the caller then lets the render path explain why).
 */
export async function previewKey(ctx: Ctx, repo: RepoRow, ref: string, path: string, opts: { base?: string; size: number }): Promise<string | null> {
  const head = await blobAt(ctx, repo, ref, path);
  if (!head) return null;
  const before = opts.base ? await blobAt(ctx, repo, opts.base, path) : null;
  if (opts.base && !before) return null;
  if (/\.tiff?$/i.test(path)) return `v${RENDER_VERSION}:${before ? `diff:${before.id}:${head.id}` : `thumb:${head.id}`}:${opts.size}`;
  if (/\.las$/i.test(path)) return `v${RENDER_VERSION}:cloud:${head.id}:${opts.size}`;
  if (/\.shp$/i.test(path)) {
    const dbf = path.replace(/\.shp$/i, ".dbf");
    const dbfIds = (await Promise.all([ref, opts.base].map(async (r) => (r ? (await blobAt(ctx, repo, r, dbf))?.id ?? "" : "")))).join(":");
    return `v${RENDER_VERSION}:svg:${head.id}:${before?.id ?? ""}:${dbfIds}`;
  }
  return null;
}

/**
 * Draw the previews a push is about to be looked at through, so the first viewer doesn't pay for
 * it: each new or changed raster and shapefile, plain and as a change from the previous commit.
 * Results land in the same cache the render route reads. Never throws.
 */
export async function warmCommit(ctx: Ctx, repo: RepoRow, commitId: string) {
  try {
    const commit = await getObject<CommitObject>(ctx, repo, commitId, "commit");
    const parent = commit.parents[0];
    const entriesOf = async (c: CommitObject) => (await getObject<TreeObject>(ctx, repo, c.tree, "tree")).entries;
    const before = new Map(parent ? (await entriesOf(await getObject<CommitObject>(ctx, repo, parent, "commit"))).map((e) => [e.path, e.blob] as const) : []);
    const changed = (await entriesOf(commit)).filter((e) => /\.(tiff?|shp|las)$/i.test(e.path) && before.get(e.path) !== e.blob).slice(0, 8);
    for (const e of changed) {
      const hadBefore = Boolean(parent) && before.has(e.path);
      try {
        if (/\.las$/i.test(e.path)) {
          await pointCloudPng(ctx, repo, commitId, e.path, 512);
        } else if (/\.shp$/i.test(e.path)) {
          await vectorSvg(ctx, repo, commitId, e.path);
          if (hadBefore) await vectorSvg(ctx, repo, commitId, e.path, parent);
        } else {
          for (const size of [384, 512]) {
            await rasterThumbnail(ctx, repo, commitId, e.path, size);
            if (hadBefore) await rasterDiff(ctx, repo, parent, commitId, e.path, size).catch(() => {}); // differing sizes: a normal 400 when viewed
          }
        }
      } catch {
        // Not previewable: it will say so when someone opens it.
      }
      await new Promise((resolve) => setImmediate(resolve)); // let real requests through between files
    }
  } catch (err) {
    console.error("preview warm-up failed", err);
  }
}

export async function blobAt(ctx: Ctx, repo: RepoRow, ref: string, path: string) {
  const commit = await getObject<CommitObject>(ctx, repo, await resolveRef(ctx, repo, ref), "commit");
  const tree = await getObject<TreeObject>(ctx, repo, commit.tree, "tree");
  const entry = tree.entries.find((e) => e.path === path);
  if (!entry) return null;
  return { id: entry.blob, blob: await getObject<BlobObject>(ctx, repo, entry.blob, "blob"), tree };
}

async function gridOf(ctx: Ctx, blob: BlobObject, id: string, maxSide: number) {
  return cached(`grid:${id}:${maxSide}`, async () => {
    const reader = new BlobReader(ctx, blob);
    return readGrid((o, l) => reader.read(o, l), blob.size, maxSide);
  });
}

// Colours from the Craton theme (blue hue ~255 in OKLCH), pre-converted to sRGB.
const GAIN: [number, number, number] = [95, 136, 207]; // chart-2: ground got higher
const LOSS: [number, number, number] = [224, 131, 125]; // destructive: ground got lower

function range(v: Float32Array) {
  let min = Infinity, max = -Infinity;
  for (const x of v) if (!Number.isNaN(x)) {
    if (x < min) min = x;
    if (x > max) max = x;
  }
  return { min, max };
}

/**
 * Hillshade (azimuth 315°, altitude 45°) on the grid, 0..1, from Horn's slope and aspect (the 3 × 3 weighted neighbourhood GDAL and ArcGIS use), which
 * ignores single-pixel noise that a two-neighbour difference turns into speckle.
 */
export function hillshade(g: Grid) {
  const { width: w, height: h, values: z } = g;
  // Degrees to metres (approximate) so geographic DEMs shade like projected ones.
  const cx = g.geographic ? g.cellSize[0] * 111_320 : g.cellSize[0];
  const cy = g.geographic ? g.cellSize[1] * 110_540 : g.cellSize[1];
  const az = (315 * Math.PI) / 180, alt = (45 * Math.PI) / 180;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const centre = z[y * w + x];
    if (Number.isNaN(centre)) {
      out[y * w + x] = NaN;
      continue;
    }
    // A missing neighbour takes the centre's height, so the edge of a nodata area doesn't shade as a cliff.
    const at = (dx: number, dy: number) => {
      const v = z[Math.min(h - 1, Math.max(0, y + dy)) * w + Math.min(w - 1, Math.max(0, x + dx))];
      return Number.isNaN(v) ? centre : v;
    };
    const dzdx = (at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1)) / (8 * cx);
    const dzdy = (at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1)) / (8 * cy);
    const slope = Math.atan(Math.hypot(dzdx, dzdy) * 2);
    const aspect = Math.atan2(dzdy, -dzdx);
    const shade = Math.cos(alt) * Math.cos(slope) + Math.sin(alt) * Math.sin(slope) * Math.cos(az - aspect);
    out[y * w + x] = Math.max(0, Math.min(1, shade));
  }
  return out;
}

/** The sampled grid whose elevations set the colour range of every picture of a raster (a file up to this size on its longest side is read exactly). */
const RANGE_SIDE = 1024;

const mix = (a: number, b: number, t: number) => Math.round(a + (b - a) * t);

/** Elevation tint under hillshade, RGBA; nodata is transparent. `min` and `max` set the colour ramp: the terrain map, as on the map viewer. */
function colorize(g: Grid, shade: Float32Array, min: number, max: number) {
  const colours = ramp("terrain");
  const rgba = new Uint8Array(g.width * g.height * 4);
  for (let i = 0; i < g.values.length; i++) {
    const v = g.values[i];
    if (Number.isNaN(v)) continue; // transparent nodata
    const t = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0.5;
    const c = colours[Math.round(t * 255)];
    const s = lit(shade[i]);
    rgba[i * 4] = Math.min(255, Math.round(c[0] * s));
    rgba[i * 4 + 1] = Math.min(255, Math.round(c[1] * s));
    rgba[i * 4 + 2] = Math.min(255, Math.round(c[2] * s));
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Hillshaded, elevation-tinted PNG of a raster at `ref`. */
export async function rasterThumbnail(ctx: Ctx, repo: RepoRow, ref: string, path: string, maxSide = 512) {
  const found = await blobAt(ctx, repo, ref, path);
  if (!found) throw notFound(`File ${path}`);
  return cached(`thumb:${found.id}:${maxSide}`, async () => {
    type Thumb = { width: number; height: number; min: number; max: number; sourceWidth: number; sourceHeight: number };
    const shared = sharedImages();
    const sharedKey = `thumb:v${RENDER_VERSION}:${found.id}:${maxSide}`;
    const hit = shared ? await shared.get(sharedKey) : null;
    if (hit) {
      const { meta, png } = unpackImage<Thumb>(hit);
      return { png, ...meta };
    }
    const g = await gridOf(ctx, found.blob, found.id, maxSide);
    const shade = hillshade(g);
    // The colours span the same range at every size and in every tile, so a picture does not change colour as it is zoomed.
    const { min, max } = range((await gridOf(ctx, found.blob, found.id, RANGE_SIDE)).values);
    const out = { png: encodePng(g.width, g.height, colorize(g, shade, min, max)), width: g.width, height: g.height, min, max, sourceWidth: g.sourceWidth, sourceHeight: g.sourceHeight };
    if (shared) {
      const { png, ...meta } = out;
      void shared.set(sharedKey, packImage(meta, Buffer.from(png)), IMAGE_TTL_SECONDS);
    }
    return out;
  });
}

// ── Zoomable raster: tiles in the image's own pixel space ───────────────────────────────────────────────────────────────────────────
// Zoom 0 is the whole image in one 256-pixel tile; each zoom doubles the detail until the last, where a tile pixel is an image pixel.
// Tiles are drawn from the nearest overview the file has, so a Cloud Optimized GeoTIFF reads little however far it is zoomed out.

export const TILE_SIZE = 256;

const tileCache = new Map<string, { at: number; png: Buffer }>();
const openCache = new Map<string, Promise<OpenTiff>>();

export async function openedTiff(ctx: Ctx, blob: BlobObject, id: string) {
  let open = openCache.get(id);
  if (!open) {
    open = openTiff(((reader) => (o: number, l: number) => reader.read(o, l))(new BlobReader(ctx, blob)), blob.size);
    openCache.set(id, open);
    open.catch(() => openCache.delete(id));
    if (openCache.size > 50) openCache.delete(openCache.keys().next().value!);
  }
  return open;
}

export type RasterTileInfo = { width: number; height: number; tileSize: number; maxZoom: number; min: number; max: number; cellSize: [number, number]; origin: [number, number] | null; geographic: boolean; epsg: number | null; overviews: number; histogram: number[] };

/** How a viewer lays the raster out, and the elevation range its colours span (the same for every tile). */
export async function rasterTileInfo(ctx: Ctx, repo: RepoRow, ref: string, path: string): Promise<RasterTileInfo> {
  const found = await blobAt(ctx, repo, ref, path);
  if (!found) throw notFound(`File ${path}`);
  return cached(`tileinfo:${found.id}`, async () => {
    const open = await openedTiff(ctx, found.blob, found.id);
    const d = describeTiff(open);
    const grid = await gridOf(ctx, found.blob, found.id, RANGE_SIDE);
    const { min, max } = range(grid.values);
    return { ...d, tileSize: TILE_SIZE, maxZoom: Math.max(0, Math.ceil(Math.log2(Math.max(d.width, d.height) / TILE_SIZE))), min, max, histogram: histogram(grid.values, min, max, 48) };
  });
}

export type RasterPixel = { column: number; row: number; value: number | null; x: number | null; y: number | null };

/** What is at one pixel of the full-resolution image (counted from the top-left corner): its value, and its place on the map when the file has one. */
export async function rasterPixel(ctx: Ctx, repo: RepoRow, ref: string, path: string, column: number, row: number): Promise<RasterPixel> {
  const found = await blobAt(ctx, repo, ref, path);
  if (!found) throw notFound(`File ${path}`);
  const open = await openedTiff(ctx, found.blob, found.id);
  return { column, row, ...(await readPixel(open, column, row)) };
}

export const tileKey = async (ctx: Ctx, repo: RepoRow, ref: string, path: string, z: number, x: number, y: number) => {
  const found = await blobAt(ctx, repo, ref, path);
  return found ? `v${RENDER_VERSION}:tile:${found.id}:${z}:${x}:${y}` : null;
};

/** One 256-pixel tile (smaller at the right and bottom edges): hillshade and elevation tint, coloured by the whole file's range. */
export async function rasterTile(ctx: Ctx, repo: RepoRow, ref: string, path: string, z: number, x: number, y: number) {
  const found = await blobAt(ctx, repo, ref, path);
  if (!found) throw notFound(`File ${path}`);
  const key = `${found.id}:${z}:${x}:${y}`;
  const hit = tileCache.get(key);
  if (hit) {
    hit.at = Date.now();
    return hit.png;
  }
  const shared = sharedImages();
  const sharedKey = `tile:v${RENDER_VERSION}:${key}`;
  const sharedHit = shared ? await shared.get(sharedKey) : null;
  if (sharedHit) {
    tileCache.set(key, { at: Date.now(), png: sharedHit });
    return sharedHit;
  }
  const info = await rasterTileInfo(ctx, repo, ref, path);
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > info.maxZoom || x < 0 || y < 0) throw notFound("Tile");
  const f = 2 ** (info.maxZoom - z); // image pixels per tile pixel
  const x0 = x * TILE_SIZE * f, y0 = y * TILE_SIZE * f;
  if (x0 >= info.width || y0 >= info.height) throw notFound("Tile");
  const outW = Math.min(TILE_SIZE, Math.ceil((info.width - x0) / f));
  const outH = Math.min(TILE_SIZE, Math.ceil((info.height - y0) / f));
  // One extra pixel on every side, so the hillshade of an edge pixel looks at its real neighbours and tiles join without seams.
  const open = await openedTiff(ctx, found.blob, found.id);
  const values = await readWindow(open, { x: x0 - f, y: y0 - f, w: (outW + 2) * f, h: (outH + 2) * f }, outW + 2, outH + 2);
  const padded: Grid = { width: outW + 2, height: outH + 2, values, cellSize: [info.cellSize[0] * f, info.cellSize[1] * f], geographic: info.geographic, sourceWidth: info.width, sourceHeight: info.height };
  const shade = hillshade(padded);
  const rgba = colorize(padded, shade, info.min, info.max);
  const cropped = new Uint8Array(outW * outH * 4);
  for (let r = 0; r < outH; r++) cropped.set(rgba.subarray(((r + 1) * (outW + 2) + 1) * 4, ((r + 1) * (outW + 2) + 1 + outW) * 4), r * outW * 4);
  const png = encodePng(outW, outH, cropped);
  tileCache.set(key, { at: Date.now(), png });
  if (shared) void shared.set(sharedKey, Buffer.from(png), IMAGE_TTL_SECONDS);
  if (tileCache.size > 600) tileCache.delete([...tileCache.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
  return png;
}

/**
 * Elevation change between two versions of a raster: gains blue, losses red, unchanged shown as
 * a faint hillshade of the new version. Stats say how much changed and by how much.
 */
export async function rasterDiff(ctx: Ctx, repo: RepoRow, base: string, head: string, path: string, maxSide = 512) {
  const a = await blobAt(ctx, repo, base, path);
  const b = await blobAt(ctx, repo, head, path);
  if (!a || !b) throw notFound(`File ${path} in both versions`);
  return cached(`diff:${a.id}:${b.id}:${maxSide}`, async () => {
    const [ga, gb] = await Promise.all([gridOf(ctx, a.blob, a.id, maxSide), gridOf(ctx, b.blob, b.id, maxSide)]);
    if (ga.width !== gb.width || ga.height !== gb.height) throw badRequest("The two versions have different dimensions, so they can't be compared pixel by pixel.");
    const shade = hillshade(gb);
    const n = gb.values.length;
    const d = new Float32Array(n);
    let maxAbs = 0, changed = 0, valid = 0, minD = Infinity, maxD = -Infinity;
    for (let i = 0; i < n; i++) {
      const va = ga.values[i], vb = gb.values[i];
      if (Number.isNaN(va) || Number.isNaN(vb)) {
        d[i] = NaN;
        continue;
      }
      valid++;
      d[i] = vb - va;
      if (Math.abs(d[i]) > 1e-4) {
        changed++;
        if (d[i] < minD) minD = d[i];
        if (d[i] > maxD) maxD = d[i];
        maxAbs = Math.max(maxAbs, Math.abs(d[i]));
      }
    }
    const rgba = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      if (Number.isNaN(d[i])) continue;
      const sh = Number.isNaN(shade[i]) ? 0.5 : shade[i];
      const base = Math.round(40 + 70 * sh);
      let r = base, g = base, bl = Math.round(base * 1.08);
      if (Math.abs(d[i]) > 1e-4 && maxAbs > 0) {
        // Strength by magnitude; the terrain's shading still shows through the colour.
        const t = Math.min(1, 0.35 + (0.65 * Math.abs(d[i])) / maxAbs);
        const c = d[i] > 0 ? GAIN : LOSS;
        const lit = 0.7 + 0.45 * sh;
        r = Math.min(255, mix(r, c[0], t) * lit);
        g = Math.min(255, mix(g, c[1], t) * lit);
        bl = Math.min(255, mix(bl, c[2], t) * lit);
      }
      rgba[i * 4] = r;
      rgba[i * 4 + 1] = g;
      rgba[i * 4 + 2] = Math.min(255, bl);
      rgba[i * 4 + 3] = 255;
    }
    return {
      png: encodePng(gb.width, gb.height, rgba),
      width: gb.width,
      height: gb.height,
      stats: {
        changedPercent: valid ? Math.round((changed / valid) * 10_000) / 100 : 0,
        minChange: changed ? minD : 0,
        maxChange: changed ? maxD : 0,
        sampledPixels: valid,
      },
    };
  });
}

// ── Raster statistics ───────────────────────────────────────────────────────

type Summary = { validCells: number; nodataCells: number; min: number; max: number; mean: number; stdDev: number; p5: number; p50: number; p95: number };

/** Summary numbers of a sampled grid. Percentiles are of the valid cells; everything is NaN-safe. */
function summarize(values: Float32Array): Summary {
  let n = 0, nodata = 0, mean = 0, m2 = 0, min = Infinity, max = -Infinity;
  const valid: number[] = [];
  for (const v of values) {
    if (Number.isNaN(v)) { nodata++; continue; }
    n++;
    const dx = v - mean;
    mean += dx / n;
    m2 += dx * (v - mean);
    if (v < min) min = v;
    if (v > max) max = v;
    valid.push(v);
  }
  if (!n) return { validCells: 0, nodataCells: nodata, min: 0, max: 0, mean: 0, stdDev: 0, p5: 0, p50: 0, p95: 0 };
  const sorted = Float64Array.from(valid).sort();
  const pct = (q: number) => sorted[Math.min(n - 1, Math.max(0, Math.round(q * (n - 1))))];
  return { validCells: n, nodataCells: nodata, min, max, mean, stdDev: Math.sqrt(m2 / n), p5: pct(0.05), p50: pct(0.5), p95: pct(0.95) };
}

function histogram(values: Float32Array, lo: number, hi: number, bins: number) {
  const out = new Array<number>(bins).fill(0);
  const span = hi - lo;
  for (const v of values) {
    if (Number.isNaN(v)) continue;
    const i = span > 0 ? Math.min(bins - 1, Math.max(0, Math.floor(((v - lo) / span) * bins))) : 0;
    out[i]++;
  }
  return out;
}

/**
 * Numbers behind a raster change: the summary of each version, a shared-range histogram of both (so a
 * shift of the whole distribution is visible), and the cell-by-cell change (mean, RMSE, area gained and
 * lost, volume). Computed on the same sampled grids the heatmap is drawn from, so they are estimates
 * of the full raster when the file is larger than `maxSide`; `sampled.factor` says how much larger.
 */
export async function rasterStats(ctx: Ctx, repo: RepoRow, base: string, head: string, path: string, maxSide = 512) {
  const a = await blobAt(ctx, repo, base, path);
  const b = await blobAt(ctx, repo, head, path);
  if (!a || !b) throw notFound(`File ${path} in both versions`);
  return cached(`stats:${a.id}:${b.id}:${maxSide}`, async () => {
    const [ga, gb] = await Promise.all([gridOf(ctx, a.blob, a.id, maxSide), gridOf(ctx, b.blob, b.id, maxSide)]);
    const before = summarize(ga.values), after = summarize(gb.values);
    const lo = Math.min(before.validCells ? before.min : Infinity, after.validCells ? after.min : Infinity);
    const hi = Math.max(before.validCells ? before.max : -Infinity, after.validCells ? after.max : -Infinity);
    const bins = 24;
    const range = Number.isFinite(lo) && Number.isFinite(hi) ? { min: lo, max: hi } : { min: 0, max: 0 };
    const hist = { min: range.min, max: range.max, before: histogram(ga.values, range.min, range.max, bins), after: histogram(gb.values, range.min, range.max, bins) };

    let change: null | { comparedCells: number; changedCells: number; meanChange: number; meanAbsChange: number; rmse: number; raisedPercent: number; loweredPercent: number; volumeChange: number | null } = null;
    if (ga.width === gb.width && ga.height === gb.height) {
      let n = 0, sum = 0, sumAbs = 0, sumSq = 0, up = 0, down = 0, changed = 0;
      for (let i = 0; i < gb.values.length; i++) {
        const va = ga.values[i], vb = gb.values[i];
        if (Number.isNaN(va) || Number.isNaN(vb)) continue;
        const d = vb - va;
        n++;
        sum += d;
        sumAbs += Math.abs(d);
        sumSq += d * d;
        if (d > 1e-4) { up++; changed++; } else if (d < -1e-4) { down++; changed++; }
      }
      // Volume needs a ground area per sampled cell, which only a projected grid (metres) gives without a latitude.
      const volumeChange = n && !gb.geographic ? sum * gb.cellSize[0] * gb.cellSize[1] : null;
      change = {
        comparedCells: n,
        changedCells: changed,
        meanChange: n ? sum / n : 0,
        meanAbsChange: n ? sumAbs / n : 0,
        rmse: n ? Math.sqrt(sumSq / n) : 0,
        raisedPercent: n ? (up / n) * 100 : 0,
        loweredPercent: n ? (down / n) * 100 : 0,
        volumeChange,
      };
    }
    return {
      sampled: { width: gb.width, height: gb.height, sourceWidth: gb.sourceWidth, sourceHeight: gb.sourceHeight, factor: gb.sourceWidth / gb.width },
      sameGrid: ga.width === gb.width && ga.height === gb.height,
      before,
      after,
      change,
      histogram: hist,
    };
  });
}

// ── Vectors ─────────────────────────────────────────────────────────────────

type Shape = { kind: "point" | "line" | "polygon"; parts: [number, number][][] };

/** Parse .shp records (points, multipoints, polylines, polygons and their Z/M variants). */
function parseShp(buf: Buffer) {
  if (buf.length < 100 || buf.readInt32BE(0) !== 9994) throw badRequest("Not a shapefile");
  const bbox = [buf.readDoubleLE(36), buf.readDoubleLE(44), buf.readDoubleLE(52), buf.readDoubleLE(60)] as [number, number, number, number];
  const shapes: { shape: Shape | null; bytes: Buffer }[] = [];
  let o = 100;
  while (o + 8 <= buf.length) {
    const len = buf.readInt32BE(o + 4) * 2;
    const content = buf.subarray(o + 8, o + 8 + len);
    o += 8 + len;
    if (content.length < 4) break;
    const type = content.readInt32LE(0) % 10; // 1/11/21 → 1, 3/13/23 → 3, 5/15/25 → 5, 8/18/28 → 8
    if (type === 0) shapes.push({ shape: null, bytes: content });
    else if (type === 1) shapes.push({ shape: { kind: "point", parts: [[[content.readDoubleLE(4), content.readDoubleLE(12)]]] }, bytes: content });
    else if (type === 8) {
      const n = content.readInt32LE(36);
      const pts: [number, number][] = [];
      for (let i = 0; i < n; i++) pts.push([content.readDoubleLE(40 + i * 16), content.readDoubleLE(48 + i * 16)]);
      shapes.push({ shape: { kind: "point", parts: pts.map((p) => [p]) }, bytes: content });
    } else if (type === 3 || type === 5) {
      const numParts = content.readInt32LE(36);
      const numPoints = content.readInt32LE(40);
      const starts: number[] = [];
      for (let i = 0; i < numParts; i++) starts.push(content.readInt32LE(44 + i * 4));
      const base = 44 + numParts * 4;
      const parts: [number, number][][] = starts.map((s, i) => {
        const end = i + 1 < numParts ? starts[i + 1] : numPoints;
        const pts: [number, number][] = [];
        for (let k = s; k < end; k++) pts.push([content.readDoubleLE(base + k * 16), content.readDoubleLE(base + k * 16 + 8)]);
        return pts;
      });
      shapes.push({ shape: { kind: type === 5 ? "polygon" : "line", parts }, bytes: content });
    } else shapes.push({ shape: null, bytes: content });
  }
  return { bbox, shapes };
}

const STYLE = {
  f: { fill: "rgba(95,136,207,0.18)", stroke: "#8fb0e3", width: 1.4, dash: "" },
  same: { fill: "rgba(143,176,227,0.08)", stroke: "rgba(143,176,227,0.45)", width: 1.2, dash: "" },
  // Matches the page legend: added chart-2, changed chart-1, removed destructive.
  changed: { fill: "rgba(169,193,230,0.3)", stroke: "#a9c1e6", width: 2, dash: "" },
  added: { fill: "rgba(95,136,207,0.5)", stroke: "#5f88cf", width: 2, dash: "" },
  removed: { fill: "rgba(224,131,125,0.18)", stroke: "#e0837d", width: 1.6, dash: "5 4" },
};

/** Raw .dbf records, one buffer per row (deleted rows included, so indexes match the .shp). */
function dbfRecords(buf: Buffer) {
  if (buf.length < 32) return [];
  const n = buf.readUInt32LE(4), headerLen = buf.readUInt16LE(8), recordLen = buf.readUInt16LE(10);
  const out: Buffer[] = [];
  for (let i = 0; i < n && headerLen + (i + 1) * recordLen <= buf.length; i++) out.push(buf.subarray(headerLen + i * recordLen, headerLen + (i + 1) * recordLen));
  return out;
}

const sameRow = (a: Buffer | undefined, b: Buffer | undefined) => (!a && !b) || (!!a && !!b && a.equals(b));

const fmt = (n: number) => (Math.round(n * 10) / 10).toString();

/**
 * SVG of a shapefile at `ref`. With `base`, features that differ from that version are drawn in
 * the "changed" colour, new ones as added and deleted ones (dashed) as removed.
 */
export async function vectorSvg(ctx: Ctx, repo: RepoRow, ref: string, path: string, base?: string) {
  const head = await blobAt(ctx, repo, ref, path);
  if (!head) throw notFound(`File ${path}`);
  const before = base ? await blobAt(ctx, repo, base, path) : null;
  const dbfIds = (await Promise.all([ref, base].map(async (r) => (r ? (await blobAt(ctx, repo, r, path.replace(/\.shp$/i, ".dbf")))?.id ?? "" : "")))).join(":");
  return cached(`svg:${head.id}:${before?.id ?? ""}:${dbfIds}`, async () => {
    const read = async (b: BlobObject) => new BlobReader(ctx, b).readAll();
    const cur = parseShp(await read(head.blob));
    const old = before ? parseShp(await read(before.blob)) : null;
    // Attributes live in the .dbf beside the .shp: a feature whose row changed counts as changed.
    const dbfPath = path.replace(/\.shp$/i, ".dbf");
    const rows = async (r: string) => {
      const f = await blobAt(ctx, repo, r, dbfPath);
      return f ? dbfRecords(await read(f.blob)) : [];
    };
    const [curRows, oldRows] = old && base ? await Promise.all([rows(ref), rows(base)]) : [[], []];
    const [minX, minY, maxX, maxY] = old
      ? [Math.min(cur.bbox[0], old.bbox[0]), Math.min(cur.bbox[1], old.bbox[1]), Math.max(cur.bbox[2], old.bbox[2]), Math.max(cur.bbox[3], old.bbox[3])]
      : cur.bbox;
    const W = 800;
    const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
    const H = Math.max(200, Math.min(800, Math.round((W * spanY) / spanX)));
    const pad = 16;
    const k = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
    const ox = (W - spanX * k) / 2, oy = (H - spanY * k) / 2;
    const px = ([x, y]: [number, number]) => `${fmt(ox + (x - minX) * k)},${fmt(H - (oy + (y - minY) * k))}`;
    // Presentation attributes, not a <style> block, so the SVG renders under a strict CSP.
    const draw = (s: Shape, cls: keyof typeof STYLE) => {
      if (s.kind === "point") {
        return s.parts.map((p) => {
          const [x, y] = px(p[0]).split(",");
          return `<circle cx="${x}" cy="${y}" r="3" fill="${STYLE[cls].stroke}"/>`;
        }).join("");
      }
      const d = s.parts.map((pts) => `M${pts.map(px).join("L")}${s.kind === "polygon" ? "Z" : ""}`).join("");
      const st = STYLE[cls];
      return `<path d="${d}" fill="${s.kind === "line" ? "none" : st.fill}" stroke="${st.stroke}" stroke-width="${st.width}"${st.dash ? ` stroke-dasharray="${st.dash}"` : ""} stroke-linejoin="round" vector-effect="non-scaling-stroke"/>`;
    };

    let added = 0, removed = 0, changed = 0, same = 0;
    const layers: string[] = [];
    cur.shapes.forEach((f, i) => {
      if (!f.shape) return;
      if (!old) return void layers.push(draw(f.shape, "f"));
      const prev = old.shapes[i];
      if (!prev) {
        added++;
        layers.push(draw(f.shape, "added"));
      } else if (!prev.bytes.equals(f.bytes) || !sameRow(curRows[i], oldRows[i])) {
        changed++;
        layers.push(draw(f.shape, "changed"));
      } else {
        same++;
        layers.push(draw(f.shape, "same"));
      }
    });
    if (old) old.shapes.slice(cur.shapes.length).forEach((f) => f.shape && (removed++, layers.push(draw(f.shape, "removed"))));

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${layers.join("")}</svg>`;
    return { svg, features: cur.shapes.filter((s) => s.shape).length, diff: old ? { added, removed, changed, same } : null };
  });
}

// ── Vector features for the interactive viewer ─────────────────────────────────────────────────────────────────────────────────────

export type VectorFeature = { i: number; kind: "point" | "line" | "polygon"; /** Each part's coordinates flattened: x0, y0, x1, y1, … */ parts: number[][]; props: Record<string, string | number | boolean | null> };
export type VectorFeatures = { bbox: [number, number, number, number]; fields: DbfField[]; count: number; shown: number; thinned: boolean; features: VectorFeature[]; /** The coordinate system the coordinates are in: the file's own, or 4326 when asked for longitude and latitude. */ epsg: number | null };

const FEATURE_LIMIT = 5000;
const POINT_BUDGET = 150_000;

/** One value of a dBase record: text trimmed, numbers as numbers (blank is null), dates as ISO text, logicals as booleans. */
function dbfValue(raw: Buffer, type: string): string | number | boolean | null {
  const text = (/^[\x00-\x7f]*$/.test(raw.toString("latin1")) ? raw.toString("latin1") : raw.toString("utf8")).replace(/\0+$/, "").trim();
  if (type === "N" || type === "F") {
    if (!text || /^\*+$/.test(text)) return null;
    const n = Number(text);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "L") return /^[TtYy]/.test(text) ? true : /^[FfNn]/.test(text) ? false : null;
  if (type === "D") return /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}` : text || null;
  return text || null;
}

/**
 * A shapefile as data a viewer can draw and tabulate: every feature's geometry (coordinates rounded to what its extent can show, and thinned
 * when a file has more than the viewer can draw) with its attribute row from the .dbf beside it. At most 5,000 features are sent; `count` is how many there are.
 */
export async function vectorFeatures(ctx: Ctx, repo: RepoRow, ref: string, path: string, opts: { lonlat?: boolean } = {}): Promise<VectorFeatures> {
  const head = await blobAt(ctx, repo, ref, path);
  if (!head) throw notFound(`File ${path}`);
  const dbf = await blobAt(ctx, repo, ref, path.replace(/\.shp$/i, ".dbf"));
  const prj = await blobAt(ctx, repo, ref, path.replace(/\.shp$/i, ".prj"));
  const own = prj ? epsgFromWkt((await new BlobReader(ctx, prj.blob).readAll()).toString("utf8")) : null;
  if (!opts.lonlat) return ownFeatures(ctx, head, dbf, own);
  // Longitude and latitude, for a web map: every coordinate through proj4 from the .prj's system (already degrees: kept as they are).
  return cached(`features-lonlat:${head.id}:${dbf?.id ?? ""}:${own ?? ""}`, async () => {
    const proj = own === 4326 ? null : projector(own);
    if (own !== 4326 && !proj) throw new UnsupportedTiffError("This shapefile's coordinate system can't be placed on a map (no .prj, or one the EPSG registry does not know).");
    const base = await ownFeatures(ctx, head, dbf, own);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const features = base.features.map((f) => ({
      ...f,
      parts: f.parts.map((part) => {
        const out: number[] = [];
        for (let k = 0; k + 1 < part.length; k += 2) {
          const [lon, lat] = proj ? proj.toLonLat(part[k], part[k + 1]) : [part[k], part[k + 1]];
          const rl = Math.round(lon * 1e7) / 1e7, rt = Math.round(lat * 1e7) / 1e7;
          out.push(rl, rt);
          w = Math.min(w, rl), e = Math.max(e, rl), s = Math.min(s, rt), n = Math.max(n, rt);
        }
        return out;
      }),
    }));
    return { ...base, features, bbox: [w, s, e, n] as [number, number, number, number], epsg: 4326 };
  });
}

function ownFeatures(ctx: Ctx, head: NonNullable<Awaited<ReturnType<typeof blobAt>>>, dbf: Awaited<ReturnType<typeof blobAt>>, own: number | null): Promise<VectorFeatures> {
  return cached(`features:${head.id}:${dbf?.id ?? ""}`, async () => {
    const shp = parseShp(await new BlobReader(ctx, head.blob).readAll());
    const dbfBuf = dbf ? await new BlobReader(ctx, dbf.blob).readAll() : null;
    const fields = dbfBuf ? readDbfFields(dbfBuf) : [];
    const rows = dbfBuf ? dbfRecords(dbfBuf) : [];
    const [minX, minY, maxX, maxY] = shp.bbox;
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(span / 100_000))));
    const round = (v: number) => Math.round(v * 10 ** decimals) / 10 ** decimals;

    const wanted = shp.shapes.map((s, i) => ({ s, i })).filter((x) => x.s.shape).slice(0, FEATURE_LIMIT);
    let total = 0;
    for (const { s } of wanted) for (const part of s.shape!.parts) total += part.length;
    const stride = Math.max(1, Math.ceil(total / POINT_BUDGET));

    const features: VectorFeature[] = wanted.map(({ s, i }) => {
      const shape = s.shape!;
      const parts = shape.parts.map((pts) => {
        const keep = shape.kind === "point" || pts.length <= 3 || stride === 1 ? pts : pts.filter((_, k) => k % stride === 0 || k === pts.length - 1);
        const flat: number[] = [];
        for (const [x, y] of keep) flat.push(round(x), round(y));
        return flat;
      });
      const props: VectorFeature["props"] = {};
      const row = rows[i];
      if (row) {
        let at = 1; // the first byte of a record says whether it is deleted
        for (const f of fields) {
          props[f.name] = dbfValue(row.subarray(at, at + f.length), f.type);
          at += f.length;
        }
      }
      return { i, kind: shape.kind, parts, props };
    });
    return { bbox: shp.bbox, fields, count: shp.shapes.filter((s) => s.shape).length, shown: features.length, thinned: stride > 1, features, epsg: own };
  });
}

export const vectorKey = async (ctx: Ctx, repo: RepoRow, ref: string, path: string) => {
  const head = await blobAt(ctx, repo, ref, path);
  if (!head) return null;
  return `v${RENDER_VERSION}:features:${head.id}:${(await blobAt(ctx, repo, ref, path.replace(/\.shp$/i, ".dbf")))?.id ?? ""}`;
};

export function isUnsupported(err: unknown) {
  return err instanceof UnsupportedTiffError;
}

// ---- Point clouds -----------------------------------------------------------------------------------------------

/** At most this many chunks (about 64 MB) are read to draw a point cloud; a larger file is sampled across its whole length. */
export const cloudLimits = { chunks: 512 };

/**
 * An uncompressed LAS point cloud seen from above: every cell is coloured by the mean elevation of the points in it (the same
 * blue ramp as the hillshades) and fades out where there are few points, so gaps and relative density show. Drawn from an evenly spaced
 * sample of the file's chunks, so a multi-gigabyte cloud costs seconds, not minutes; `sampledShare` says how much of the file was read,
 * and no absolute density is claimed (a sorted file's sample has full local density, a shuffled one's is thin everywhere).
 */
export async function pointCloudPng(ctx: Ctx, repo: RepoRow, ref: string, path: string, size: number) {
  const head = await blobAt(ctx, repo, ref, path);
  if (!head) throw notFound(`File ${path}`);
  return cached(`cloud:${head.id}:${size}`, async () => {
    const blob = head.blob;
    const info = await readLasHeader(async (o, l) => (await new BlobReader(ctx, { ...blob, chunks: blob.chunks.slice(0, 1) } as BlobObject).read(o, l)), blob.size).catch(() => {
      throw new UnsupportedTiffError("This is not a LAS file this server can read.");
    });
    if (info.compressed) throw new UnsupportedTiffError("LAZ stores its points compressed; a preview is drawn for uncompressed LAS files.");
    const record = info.pointRecordLength;
    const available = Math.floor((blob.size - info.offsetToPoints) / record);
    const points = Math.min(info.pointCount, available);
    if (points < 1 || record < 12) throw new UnsupportedTiffError("This point cloud has no points to draw.");

    // Which chunks to read: all of them when the file is small, else evenly spaced ones.
    const starts: number[] = [];
    let at = 0;
    for (const c of blob.chunks) (starts.push(at), (at += c.size));
    const first = blob.chunks.findIndex((_, i) => starts[i] + blob.chunks[i].size > info.offsetToPoints);
    const usable = blob.chunks.length - first;
    const step = Math.max(1, Math.ceil(usable / cloudLimits.chunks));
    const picked: number[] = [];
    for (let i = first; i < blob.chunks.length; i += step) picked.push(i);
    const share = picked.length / usable;

    const [minX, minY] = [info.min[0], info.min[1]];
    const spanX = info.max[0] - minX || 1;
    const spanY = info.max[1] - minY || 1;
    const longest = Math.max(spanX, spanY);
    // About one point to a cell at the least: a cloud of tens of thousands drawn at 1,024 pixels would be isolated dots, so it is drawn coarser.
    const shortest = Math.max(1e-9, Math.min(spanX, spanY));
    const side = Math.max(128, Math.min(size, Math.ceil(Math.sqrt(points * (longest / shortest)))));
    const width = Math.max(2, Math.round((spanX / longest) * side));
    const height = Math.max(2, Math.round((spanY / longest) * side));
    const count = new Float32Array(width * height);
    const sumZ = new Float64Array(width * height);
    let seen = 0;
    let zLow = Infinity;
    let zHigh = -Infinity;

    for (const i of picked) {
      const data = await readChunk(ctx, blob.chunks[i].hash);
      // Records start at offsetToPoints plus a whole number of records; this chunk starts at starts[i].
      const lead = Math.max(0, info.offsetToPoints - starts[i]);
      let pos = lead + ((record - ((starts[i] + lead - info.offsetToPoints) % record)) % record);
      for (; pos + 12 <= data.length && pos + 12 <= data.length; pos += record) {
        if (pos + record > data.length) break; // a record cut by the chunk edge is skipped
        const x = data.readInt32LE(pos) * info.scale[0] + info.offset[0];
        const y = data.readInt32LE(pos + 4) * info.scale[1] + info.offset[1];
        const z = data.readInt32LE(pos + 8) * info.scale[2] + info.offset[2];
        const cx = Math.floor(((x - minX) / spanX) * (width - 1e-9));
        const cy = Math.floor(((y - minY) / spanY) * (height - 1e-9));
        if (cx < 0 || cy < 0 || cx >= width || cy >= height) continue;
        const cell = (height - 1 - cy) * width + cx;
        count[cell]++;
        sumZ[cell] += z;
        seen++;
        if (z < zLow) zLow = z;
        if (z > zHigh) zHigh = z;
      }
    }
    if (!seen) throw new UnsupportedTiffError("No points could be read from this file.");

    // Colour by mean elevation between its 2nd and 98th percentile, and fade by how many points the cell holds.
    const means: number[] = [];
    let densest = 0;
    for (let i = 0; i < count.length; i++) if (count[i] > 0) (means.push(sumZ[i] / count[i]), (densest = Math.max(densest, count[i])));
    means.sort((a, b) => a - b);
    const lo = means[Math.floor(means.length * 0.02)];
    const hi = means[Math.max(0, Math.ceil(means.length * 0.98) - 1)];
    // A file read in part (every nth chunk) leaves gaps between the stretches it read, as stripes if the points are sorted along a line.
    // Cells within a few steps of a drawn one borrow its colour, faded, so the picture covers the extent; nothing is drawn far from data.
    const reach = step <= 1 ? 0 : Math.min(12, Math.ceil(Math.sqrt(step)));
    const level = new Float32Array(count.length);
    const away = new Uint8Array(count.length).fill(255);
    for (let i = 0; i < count.length; i++) if (count[i] > 0) (level[i] = sumZ[i] / count[i]), (away[i] = 0);
    if (reach) {
      const spread = (order: number[], back: number) => {
        for (const i of order) {
          if (away[i] === 0) continue;
          const j = i - back;
          if (j >= 0 && j < count.length && away[j] + 1 <= reach && away[j] + 1 < away[i]) (level[i] = level[j]), (away[i] = away[j] + 1);
        }
      };
      const forward = Array.from({ length: count.length }, (_, i) => i);
      const reverse = [...forward].reverse();
      spread(forward, 1); // from the cell to the left
      spread(reverse, -1); // from the cell to the right
      spread(forward, width); // from the cell above
      spread(reverse, -width); // from the cell below
    }
    const terrainColours = ramp("terrain");
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < count.length; i++) {
      if (away[i] === 255) continue;
      const t = hi > lo ? Math.min(1, Math.max(0, (level[i] - lo) / (hi - lo))) : 0.5;
      const alpha = away[i] > 0 ? 0.28 : 0.3 + 0.7 * (Math.log1p(count[i]) / Math.log1p(densest));
      const c = terrainColours[Math.round(t * 255)];
      rgba[i * 4] = c[0];
      rgba[i * 4 + 1] = c[1];
      rgba[i * 4 + 2] = c[2];
      rgba[i * 4 + 3] = Math.round(alpha * 255);
    }
    return { png: encodePng(width, height, rgba), width, height, points, sampledShare: Math.round(share * 1000) / 1000, min: zLow, max: zHigh };
  });
}
