// A raster as tiles of a web map: the standard Web Mercator z/x/y grid, reprojected from the file's own coordinate system, coloured with a
// published colour map (colormap: matplotlib's and cmocean's ramps) over a hillshade, so it can be laid on any basemap by MapLibre, Leaflet or
// OpenLayers. With a base version, a tile shows the elevation change instead: a diverging heat map, transparent where nothing changed.

import type { Ctx } from "../services/context.ts";
import { notFound } from "../services/context.ts";
import type { RepoRow } from "../services/repos.ts";
import { encodePng } from "./png.ts";
import { getCache } from "../cache/cache.ts";
import { readPixel, readWindow, UnsupportedTiffError, type Grid } from "./tiff.ts";
import { blobAt, hillshade, openedTiff, RENDER_VERSION, rasterDiff, rasterTileInfo } from "./previews.ts";
import { latTile, lonTile, projector, tileLat, tileLon } from "./geo.ts";
import { isRamp, lit as litBy, ramp, rampStops, type RampName } from "./ramps.ts";

export { isRamp, ramp, rampStops, type RampName };

export const TILE = 256;

export type MapPlacement = { bounds: [number, number, number, number]; maxZoom: number } | null;

/** Where the raster is on Earth ([west, south, east, north] in degrees) and the zoom at which a map pixel is about one of its cells. Null when it cannot be placed. */
export async function rasterPlacement(ctx: Ctx, repo: RepoRow, ref: string, path: string): Promise<MapPlacement> {
  const info = await rasterTileInfo(ctx, repo, ref, path);
  const proj = info.origin ? projector(info.epsg) : null;
  if (!proj || !info.origin) return null;
  const [ox, oy] = info.origin;
  const [sx, sy] = info.cellSize;
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  // The edges, not just the corners: a projected rectangle is curved in degrees.
  for (let i = 0; i <= 16; i++) {
    for (const [c, r] of [[(i / 16) * info.width, 0], [(i / 16) * info.width, info.height], [0, (i / 16) * info.height], [info.width, (i / 16) * info.height]]) {
      const [lon, lat] = proj.toLonLat(ox + c * sx, oy - r * sy);
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      w = Math.min(w, lon), e = Math.max(e, lon), s = Math.min(s, lat), n = Math.max(n, lat);
    }
  }
  if (!Number.isFinite(w)) return null;
  const lat = (s + n) / 2;
  const cellMetres = info.geographic ? sx * 111_320 * Math.cos((lat * Math.PI) / 180) : sx;
  const maxZoom = Math.max(0, Math.min(22, Math.round(Math.log2((40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * cellMetres)))));
  return { bounds: [w, s, e, n], maxZoom };
}

const tileCache = new Map<string, { at: number; png: Buffer }>();
const EMPTY = encodePng(1, 1, new Uint8Array(4));

/** The key a tile is cached under: it changes when the blob, the base, the colour map or the way tiles are drawn does. */
export async function xyzKey(ctx: Ctx, repo: RepoRow, ref: string, path: string, z: number, x: number, y: number, opts: { ramp: RampName; base?: string }) {
  const head = await blobAt(ctx, repo, ref, path);
  const before = opts.base ? await blobAt(ctx, repo, opts.base, path) : null;
  if (!head || (opts.base && !before)) return null;
  return `v${RENDER_VERSION}:xyz:${head.id}:${before?.id ?? ""}:${opts.base ? "change" : opts.ramp}:${z}/${x}/${y}`;
}

function bilinear(g: Grid, fx: number, fy: number): number {
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= g.width || y >= g.height ? NaN : g.values[y * g.width + x]);
  const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
  if ([a, b, c, d].some(Number.isNaN)) {
    // At an edge of the data: the nearest cell, so the edge is not eaten away.
    return at(Math.round(fx), Math.round(fy));
  }
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/**
 * One 256-pixel Web Mercator tile. Output pixels are mapped to the file's own pixels through a 17 × 17 grid of exact projections, interpolated
 * between (the approximate transformer GDAL uses), then the file is read at about the tile's resolution from its nearest overview.
 */
export async function rasterXyzTile(ctx: Ctx, repo: RepoRow, ref: string, path: string, z: number, x: number, y: number, opts: { ramp: RampName; base?: string }): Promise<Buffer> {
  const key = await xyzKey(ctx, repo, ref, path, z, x, y, opts);
  if (key && tileCache.has(key)) return drawTile(ctx, repo, ref, path, z, x, y, opts, key);
  // Drawing is CPU work: two at a time, so a map asking for a screenful of tiles does not hold up every other request on this server.
  await slot.acquire();
  try {
    return await drawTile(ctx, repo, ref, path, z, x, y, opts, key);
  } finally {
    slot.release();
  }
}

const slot = (() => {
  let free = 2;
  const queue: (() => void)[] = [];
  return {
    acquire: () => (free > 0 ? (free--, Promise.resolve()) : new Promise<void>((r) => queue.push(r))),
    release: () => {
      const next = queue.shift();
      if (next) next();
      else free++;
    },
  };
})();

async function drawTile(ctx: Ctx, repo: RepoRow, ref: string, path: string, z: number, x: number, y: number, opts: { ramp: RampName; base?: string }, key: string | null): Promise<Buffer> {
  if (!key) throw notFound(`File ${path}`);
  const hit = tileCache.get(key);
  if (hit) return (hit.at = Date.now()), hit.png;
  const shared = getCache().kind === "redis" ? getCache() : null;
  const sharedHit = shared ? await shared.get(`tile:${key}`) : null;
  if (sharedHit) return sharedHit;

  const info = await rasterTileInfo(ctx, repo, ref, path);
  const proj = info.origin ? projector(info.epsg) : null;
  if (!proj || !info.origin) throw new UnsupportedTiffError("This raster's coordinate system can't be placed on a map.");
  if (!Number.isInteger(z) || z < 0 || z > 24 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw notFound("Tile");
  const [ox, oy] = info.origin;
  const [sx, sy] = info.cellSize;

  // Where each output pixel falls in the file, in fractional pixel coordinates.
  const G = 16;
  const gridC = new Float64Array((G + 1) * (G + 1)), gridR = new Float64Array((G + 1) * (G + 1));
  for (let j = 0; j <= G; j++) {
    const lat = tileLat(y + j / G, z);
    for (let i = 0; i <= G; i++) {
      const [X, Y] = proj.fromLonLat(tileLon(x + i / G, z), lat);
      gridC[j * (G + 1) + i] = (X - ox) / sx;
      gridR[j * (G + 1) + i] = (oy - Y) / sy;
    }
  }
  const cols = new Float64Array(TILE * TILE), rows = new Float64Array(TILE * TILE);
  let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
  for (let py = 0; py < TILE; py++) {
    const gy = ((py + 0.5) / TILE) * G, j = Math.min(G - 1, Math.floor(gy)), ty = gy - j;
    for (let px = 0; px < TILE; px++) {
      const gx = ((px + 0.5) / TILE) * G, i = Math.min(G - 1, Math.floor(gx)), tx = gx - i;
      const k = j * (G + 1) + i;
      const lerp = (g: Float64Array) => (g[k] * (1 - tx) + g[k + 1] * tx) * (1 - ty) + (g[k + G + 1] * (1 - tx) + g[k + G + 2] * tx) * ty;
      const c = lerp(gridC), r = lerp(gridR);
      cols[py * TILE + px] = c;
      rows[py * TILE + px] = r;
      if (Number.isFinite(c) && Number.isFinite(r)) (c0 = Math.min(c0, c)), (c1 = Math.max(c1, c)), (r0 = Math.min(r0, r)), (r1 = Math.max(r1, r));
    }
  }
  // Nothing of the raster in this tile: one transparent pixel, which a map stretches over the tile.
  if (!(c1 >= 0 && r1 >= 0 && c0 < info.width && r0 < info.height)) return EMPTY;

  // Read the part of the file under the tile, at about one file pixel per tile pixel (never finer than the file), with a margin for the hillshade.
  const cs = Math.max(0, Math.floor(c0) - 2), ce = Math.min(info.width, Math.ceil(c1) + 2);
  const rs = Math.max(0, Math.floor(r0) - 2), re = Math.min(info.height, Math.ceil(r1) + 2);
  const f = Math.max(1, Math.max(ce - cs, re - rs) / (TILE * 1.25));
  const gw = Math.max(2, Math.min(800, Math.ceil((ce - cs) / f))), gh = Math.max(2, Math.min(800, Math.ceil((re - rs) / f)));
  const fx = (ce - cs) / gw, fy = (re - rs) / gh;
  const found = (await blobAt(ctx, repo, ref, path))!;
  const open = await openedTiff(ctx, found.blob, found.id);
  const values = await readWindow(open, { x: cs, y: rs, w: ce - cs, h: re - rs }, gw, gh);
  const grid: Grid = { width: gw, height: gh, values, cellSize: [sx * fx, sy * fy], geographic: info.geographic, sourceWidth: info.width, sourceHeight: info.height };
  await new Promise<void>((r) => setImmediate(r));
  const shadeGrid: Grid = { ...grid, values: hillshade(grid) };

  let change: Float32Array | null = null;
  let span = 1;
  if (opts.base) {
    const before = (await blobAt(ctx, repo, opts.base, path))!;
    const openBefore = await openedTiff(ctx, before.blob, before.id);
    const old = await readWindow(openBefore, { x: cs, y: rs, w: ce - cs, h: re - rs }, gw, gh);
    change = new Float32Array(gw * gh);
    for (let i = 0; i < change.length; i++) change[i] = values[i] - old[i];
    // The colour range is the largest change anywhere in the file, the same for every tile, so tiles join.
    const d = (await rasterDiff(ctx, repo, opts.base, ref, path, 512)).stats;
    span = Math.max(1e-3, Math.abs(d.minChange), Math.abs(d.maxChange));
  }
  const changeGrid: Grid | null = change ? { ...grid, values: change } : null;

  const colours = ramp(opts.base ? "change" : opts.ramp);
  const lo = info.min, hi = info.max;
  const rgba = new Uint8Array(TILE * TILE * 4);
  for (let i = 0; i < TILE * TILE; i++) {
    const c = cols[i], r = rows[i];
    if (!(c >= 0 && r >= 0 && c < info.width && r < info.height)) continue;
    const gx = (c - cs) / fx - 0.5, gy = (r - rs) / fy - 0.5;
    const v = bilinear(grid, gx, gy);
    if (Number.isNaN(v)) continue;
    const shade = bilinear(shadeGrid, gx, gy);
    const lit = litBy(shade);
    let rgb: [number, number, number];
    let alpha = 255;
    if (changeGrid) {
      const d = bilinear(changeGrid, gx, gy);
      if (Number.isNaN(d) || Math.abs(d) < 1e-3) {
        // Unchanged ground: the terrain's own shading, faint, so the change stands out over it.
        const g = Math.round(200 * lit);
        rgb = [g, g, g];
        alpha = 70;
      } else {
        // RdBu: red at the low end (ground that fell), blue at the high end (ground that rose).
        const t = Math.max(0, Math.min(1, 0.5 + d / (2 * span)));
        rgb = colours[Math.round(t * 255)];
        alpha = 235;
      }
    } else {
      const t = hi > lo ? Math.max(0, Math.min(1, (v - lo) / (hi - lo))) : 0.5;
      const base = colours[Math.round(t * 255)];
      rgb = [base[0] * lit, base[1] * lit, base[2] * lit];
    }
    rgba[i * 4] = Math.min(255, Math.round(rgb[0]));
    rgba[i * 4 + 1] = Math.min(255, Math.round(rgb[1]));
    rgba[i * 4 + 2] = Math.min(255, Math.round(rgb[2]));
    rgba[i * 4 + 3] = alpha;
  }
  const png = Buffer.from(encodePng(TILE, TILE, rgba));
  tileCache.set(key, { at: Date.now(), png });
  if (tileCache.size > 800) tileCache.delete([...tileCache.entries()].sort((a, b) => a[1].at - b[1].at)[0][0]);
  if (shared) void shared.set(`tile:${key}`, png, 24 * 60 * 60);
  return png;
}

/** What is at a longitude and latitude of a raster: the pixel it falls in, its value and its position in the file's own coordinates. */
export async function rasterPixelAtLonLat(ctx: Ctx, repo: RepoRow, ref: string, path: string, lon: number, lat: number) {
  const info = await rasterTileInfo(ctx, repo, ref, path);
  const proj = info.origin ? projector(info.epsg) : null;
  if (!proj || !info.origin) throw new UnsupportedTiffError("This raster's coordinate system can't be placed on a map.");
  const [X, Y] = proj.fromLonLat(lon, lat);
  const column = Math.floor((X - info.origin[0]) / info.cellSize[0]);
  const row = Math.floor((info.origin[1] - Y) / info.cellSize[1]);
  const found = (await blobAt(ctx, repo, ref, path))!;
  const open = await openedTiff(ctx, found.blob, found.id);
  return { column, row, lon, lat, ...(await readPixel(open, column, row)) };
}

export { latTile, lonTile };
