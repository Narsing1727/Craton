// A STAC (SpatioTemporal Asset Catalog, v1.0.0) description of a release, so catalogues and tools that speak
// STAC can find and read a Craton release: a Collection for the release and an ItemCollection with one Item
// per file. Locations come from file headers (never from pixels); checksums are the release's own, written
// as multihash (sha2-256) in the file extension's `file:checksum`.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { extentsOf } from "./extent.ts";
import type { BBox } from "../core/geo.ts";

type ReleaseLike = { tag: string; commit: string; title: string; notes: string; createdAt: string; merkleRoot: string; checksums: { path: string; size: number; sha256: string }[] };

const STAC_VERSION = "1.0.0";
const EXTENSIONS = ["https://stac-extensions.github.io/file/v2.1.0/schema.json"];

const mediaType = (path: string) => {
  const p = path.toLowerCase();
  if (/\.tiff?$/.test(p)) return "image/tiff; application=geotiff";
  if (p.endsWith(".csv")) return "text/csv";
  if (p.endsWith(".json") || p.endsWith(".geojson")) return "application/json";
  if (p.endsWith(".md") || p.endsWith(".txt")) return "text/plain";
  return "application/octet-stream";
};

const polygon = (b: BBox) => ({ type: "Polygon", coordinates: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]] });
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

export async function buildStac(ctx: Ctx, repo: RepoRow, release: ReleaseLike, origin: string) {
  const api = `${origin}/v1/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const id = `${slug(repo.owner)}-${slug(repo.name)}-${slug(release.tag)}`;
  const collectionUrl = `${api}/releases/${encodeURIComponent(release.tag)}/stac/collection.json`;
  const itemsUrl = `${api}/releases/${encodeURIComponent(release.tag)}/stac/items.json`;
  const boxes = await extentsOf(ctx, repo, release.commit);

  let union: BBox | null = null;
  const features = release.checksums.map((c) => {
    const box = boxes.get(c.path) ?? null;
    if (box) union = union ? [Math.min(union[0], box[0]), Math.min(union[1], box[1]), Math.max(union[2], box[2]), Math.max(union[3], box[3])] : [...box] as BBox;
    return {
      type: "Feature",
      stac_version: STAC_VERSION,
      stac_extensions: EXTENSIONS,
      id: `${id}:${c.path}`,
      collection: id,
      geometry: box ? polygon(box) : null,
      ...(box ? { bbox: box } : {}),
      properties: { datetime: release.createdAt, "craton:path": c.path, "craton:commit": release.commit },
      links: [
        { rel: "collection", href: collectionUrl, type: "application/json" },
        { rel: "parent", href: collectionUrl, type: "application/json" },
      ],
      assets: {
        data: {
          href: `${api}/raw/${release.commit}/${c.path.split("/").map(encodeURIComponent).join("/")}`,
          type: mediaType(c.path),
          title: c.path.split("/").pop(),
          roles: ["data"],
          "file:checksum": `1220${c.sha256}`,
          "file:size": c.size,
        },
      },
    };
  });

  const collection = {
    type: "Collection",
    stac_version: STAC_VERSION,
    stac_extensions: EXTENSIONS,
    id,
    title: release.title || `${repo.owner}/${repo.name} ${release.tag}`,
    description: (release.notes || repo.description || `Release ${release.tag} of ${repo.owner}/${repo.name}`).slice(0, 2000),
    license: repo.license || "proprietary",
    extent: {
      spatial: { bbox: [union ?? [-180, -90, 180, 90]] },
      temporal: { interval: [[release.createdAt, null]] },
    },
    keywords: JSON.parse(repo.topics ?? "[]") as string[],
    "craton:commit": release.commit,
    "craton:merkle_root": release.merkleRoot,
    links: [
      { rel: "self", href: collectionUrl, type: "application/json" },
      { rel: "root", href: collectionUrl, type: "application/json" },
      { rel: "items", href: itemsUrl, type: "application/geo+json" },
    ],
  };

  return { collection, items: { type: "FeatureCollection", features, links: [{ rel: "self", href: itemsUrl, type: "application/geo+json" }, { rel: "collection", href: collectionUrl, type: "application/json" }] } };
}
