// Coordinate systems for putting a raster on a web map. The definitions come from the EPSG registry (epsg-index, one small file per code)
// and the arithmetic from proj4, so any projected or geographic system the registry knows can be placed, not just UTM.
// The web map side is the standard Web Mercator tile grid (EPSG:3857, 256-pixel tiles, z/x/y as every slippy map numbers them).

import { createRequire } from "node:module";
import proj4 from "proj4";

const require = createRequire(import.meta.url);
const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";
const defs = new Map<number, string | null>();

/** The proj4 definition of an EPSG code, or null when the registry does not have one. */
export function proj4Def(epsg: number): string | null {
  if (!Number.isInteger(epsg) || epsg < 1 || epsg > 999_999) return null;
  if (defs.has(epsg)) return defs.get(epsg)!;
  let def: string | null = null;
  try {
    def = (require(`epsg-index/s/${epsg}.json`) as { proj4?: string }).proj4 || null;
  } catch {
    def = null;
  }
  defs.set(epsg, def);
  return def;
}

export type Projector = {
  /** Map coordinates in the file's system to longitude and latitude. */
  toLonLat: (x: number, y: number) => [number, number];
  /** Longitude and latitude to the file's own map coordinates. */
  fromLonLat: (lon: number, lat: number) => [number, number];
};

const projectors = new Map<number, Projector | null>();

export function projector(epsg: number | null): Projector | null {
  if (epsg === null) return null;
  if (projectors.has(epsg)) return projectors.get(epsg)!;
  const def = proj4Def(epsg);
  let p: Projector | null = null;
  if (def) {
    try {
      const conv = proj4(def, WGS84);
      p = { toLonLat: (x, y) => conv.forward([x, y]) as [number, number], fromLonLat: (lon, lat) => conv.inverse([lon, lat]) as [number, number] };
    } catch {
      p = null;
    }
  }
  projectors.set(epsg, p);
  return p;
}

// ── The Web Mercator tile grid ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const tileLon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
export const tileLat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
export const lonTile = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
export const latTile = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;

/** Ground metres per pixel of a 256-pixel tile at zoom `z` and latitude `lat`. */
export const metresPerPixel = (z: number, lat: number) => (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (256 * 2 ** z);
