// Where on Earth a repository's data is. Each GeoTIFF and shapefile gives a longitude/latitude box
// (read from its header, not its pixels); a repository's footprint is the box around all of them
// on the default branch. That makes "datasets covering this place" a real question you can ask.
//
// A file's box depends only on its bytes (and its .prj, and the repository's declared CRS when the
// file doesn't say), so it is cached per file version and never recomputed for an unchanged file.

import { createHash } from "node:crypto";
import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { BlobReader } from "./chunks.ts";
import { getObject, resolveRef } from "./history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { bboxToLonLat, unionBBox, type BBox } from "../core/geo.ts";
import { NotTiffError, readGeoTiff } from "../checks/geotiff.ts";
import { epsgFromWkt, readShpHeader } from "../checks/vector.ts";

const MAX_FILES = 400; // a huge tile archive shouldn't make a push slow; the footprint then says it is partial

/** The repository's declared CRS as a number (EPSG:32643 -> 32643), the fallback for files that don't say. */
const repoEpsg = (repo: Pick<RepoRow, "crs">) => Number(/^EPSG:(\d+)$/.exec(repo.crs)?.[1]) || null;

/** A raster's longitude/latitude box from its header fields, or null if it isn't georeferenced in a supported system. */
export function rasterExtent(r: { width: number; height: number; origin: [number, number] | null; pixelScale: [number, number] | null; epsg: number | null }, fallbackEpsg: number | null): BBox | null {
  const epsg = r.epsg ?? fallbackEpsg;
  if (!epsg || !r.origin || !r.pixelScale || !r.width || !r.height) return null;
  const [x0, y0] = r.origin;
  const [sx, sy] = r.pixelScale;
  return bboxToLonLat(epsg, Math.min(x0, x0 + sx * r.width), Math.min(y0, y0 - sy * r.height), Math.max(x0, x0 + sx * r.width), Math.max(y0, y0 - sy * r.height));
}

/** A shapefile's longitude/latitude box from its header box and .prj. */
export function vectorExtent(bbox: number[], epsg: number | null, fallbackEpsg: number | null): BBox | null {
  const code = epsg ?? fallbackEpsg;
  if (!code || bbox.length < 4 || bbox.some((v) => !Number.isFinite(v))) return null;
  return bboxToLonLat(code, bbox[0], bbox[1], bbox[2], bbox[3]);
}

type Row = { west: number | null; south: number | null; east: number | null; north: number | null };

/** A file's box, cached by the file's version. Null means "looked, and it has no usable location". */
async function extentOfFile(ctx: Ctx, repo: RepoRow, tree: TreeObject, path: string, blobId: string): Promise<BBox | null> {
  const lower = path.toLowerCase();
  const isRaster = /\.tiff?$/.test(lower), isShp = lower.endsWith(".shp");
  if (!isRaster && !isShp) return null;
  const sidecar = isShp ? tree.entries.find((e) => e.path.toLowerCase() === `${lower.slice(0, -4)}.prj`) : undefined;
  const key = createHash("sha256").update(`${blobId}|${sidecar?.blob ?? ""}|${repo.crs}`).digest("hex");
  const hit = ctx.db.prepare("SELECT west, south, east, north FROM blob_extents WHERE key = ?").get(key) as Row | undefined;
  if (hit) return hit.west === null ? null : [hit.west, hit.south!, hit.east!, hit.north!];

  let box: BBox | null = null;
  try {
    const blob = getObject<BlobObject>(ctx, repo, blobId, "blob");
    const reader = new BlobReader(ctx, blob);
    if (isRaster) box = rasterExtent(await readGeoTiff((o, l) => reader.read(o, l), reader.size), repoEpsg(repo));
    else {
      const head = readShpHeader(await reader.read(0, 100));
      const wkt = sidecar ? (await new BlobReader(ctx, getObject<BlobObject>(ctx, repo, sidecar.blob, "blob")).readAll()).toString("utf8") : "";
      if (head?.valid) box = vectorExtent(head.bbox, wkt ? epsgFromWkt(wkt) : null, repoEpsg(repo));
    }
  } catch (err) {
    if (!(err instanceof NotTiffError)) console.error(`extent of ${path} failed:`, err);
  }
  ctx.db.prepare("INSERT OR REPLACE INTO blob_extents (key, west, south, east, north) VALUES (?, ?, ?, ?, ?)").run(key, box?.[0] ?? null, box?.[1] ?? null, box?.[2] ?? null, box?.[3] ?? null);
  return box;
}

/** Each located GeoTIFF or shapefile of a commit with its longitude/latitude box (null when it has none). */
export async function extentsOf(ctx: Ctx, repo: RepoRow, commitId: string): Promise<Map<string, BBox | null>> {
  const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, commitId, "commit").tree, "tree");
  const out = new Map<string, BBox | null>();
  for (const e of tree.entries.filter((x) => /\.(tiff?|shp)$/i.test(x.path)).slice(0, MAX_FILES)) out.set(e.path, await extentOfFile(ctx, repo, tree, e.path, e.blob));
  return out;
}

/** The box around every located file in a commit, and how many files it is built from. */
export async function footprintOf(ctx: Ctx, repo: RepoRow, commitId: string): Promise<{ bbox: BBox | null; files: number; partial: boolean }> {
  const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, commitId, "commit").tree, "tree");
  const candidates = tree.entries.filter((e) => /\.(tiff?|shp)$/i.test(e.path));
  let bbox: BBox | null = null, files = 0;
  for (const e of candidates.slice(0, MAX_FILES)) {
    const box = await extentOfFile(ctx, repo, tree, e.path, e.blob);
    if (box) {
      bbox = unionBBox(bbox, box);
      files++;
    }
    if (files % 25 === 0) await new Promise((resolve) => setImmediate(resolve)); // let real requests through on a big repository
  }
  return { bbox, files, partial: candidates.length > MAX_FILES };
}

/** Recompute and store a repository's footprint from its default branch. Never throws. */
export async function refreshFootprint(ctx: Ctx, repo: RepoRow) {
  try {
    const tip = resolveRef(ctx, repo, repo.default_branch);
    const { bbox } = await footprintOf(ctx, repo, tip);
    ctx.db.prepare("UPDATE repos SET footprint = ?, footprint_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(bbox ? JSON.stringify(bbox) : null, repo.id);
  } catch (err) {
    // A repository with no commits yet (or a vanished ref) simply has no footprint.
    ctx.db.prepare("UPDATE repos SET footprint = NULL, footprint_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(repo.id);
    if (!(err as { status?: number }).status) console.error("footprint refresh failed:", err);
  }
}

/** Fill in repositories that have never had a footprint worked out (existing data, after an upgrade). */
export async function backfillFootprints(ctx: Ctx) {
  const rows = ctx.db.prepare("SELECT r.*, o.handle AS owner FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.footprint_at IS NULL").all() as RepoRow[];
  for (const repo of rows) {
    await refreshFootprint(ctx, repo);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return rows.length;
}
