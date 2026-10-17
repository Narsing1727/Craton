// Where is this dataset? Turning the coordinates a file is stored in into longitude and latitude,
// so repositories can say "covers 10.2°N 76.3°E" and be found by place. Only the systems that
// cover almost all hydrology and GIS work are handled: geographic coordinates, Web Mercator and
// UTM (WGS 84, NAD83, ETRS89, GDA94/2020 zones). Anything else returns null rather than a guess.
// The datum differences between those ellipsoids are about a metre, far below what a footprint needs.

export type BBox = [west: number, south: number, east: number, north: number];

const A = 6378137; // semi-major axis (WGS 84 / GRS 80), metres
const F = 1 / 298.257222101; // GRS 80 flattening; WGS 84's differs by 1e-11
const K0 = 0.9996;
const N = F / (2 - F);
const N2 = N * N, N3 = N2 * N, N4 = N3 * N;
// Krüger series for the inverse transverse Mercator (as published for UTM).
const RECT = (A / (1 + N)) * (1 + N2 / 4 + N4 / 64);
const BETA = [N / 2 - (2 * N2) / 3 + (37 * N3) / 96 - N4 / 360, N2 / 48 + N3 / 15 - (437 * N4) / 1440, (17 * N3) / 480 - (37 * N4) / 840, (4397 * N4) / 161280];
const DELTA = [2 * N - (2 * N2) / 3 - 2 * N3 + (116 * N4) / 45, (7 * N2) / 3 - (8 * N3) / 5 - (227 * N4) / 45, (56 * N3) / 15 - (136 * N4) / 35, (4279 * N4) / 630];

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** The UTM zone (1–60) and hemisphere an EPSG code means, or null if it isn't a UTM code. */
export function utmZoneOf(epsg: number): { zone: number; south: boolean } | null {
  const ranges: [number, number, number, boolean][] = [
    [32601, 32660, 32600, false], // WGS 84 north
    [32701, 32760, 32700, true], // WGS 84 south
    [26901, 26923, 26900, false], // NAD83 north (zones 1–23)
    [25828, 25838, 25800, false], // ETRS89 north (zones 28–38)
    [28348, 28358, 28300, true], // GDA94 MGA (zones 48–58)
    [7846, 7859, 7800, true], // GDA2020 MGA (zones 46–59)
  ];
  for (const [lo, hi, base, south] of ranges) if (epsg >= lo && epsg <= hi) return { zone: epsg - base, south };
  return null;
}

/** Longitude and latitude (degrees) of a UTM easting/northing in the given zone. */
export function utmToLonLat(zone: number, south: boolean, easting: number, northing: number): [lon: number, lat: number] {
  const x = (easting - 500000) / (K0 * RECT);
  const y = (northing - (south ? 10_000_000 : 0)) / (K0 * RECT);
  let xi = y, eta = x;
  for (let j = 1; j <= 4; j++) {
    xi -= BETA[j - 1] * Math.sin(2 * j * y) * Math.cosh(2 * j * x);
    eta -= BETA[j - 1] * Math.cos(2 * j * y) * Math.sinh(2 * j * x);
  }
  const chi = Math.asin(Math.sin(xi) / Math.cosh(eta));
  let lat = chi;
  for (let j = 1; j <= 4; j++) lat += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lon0 = (zone - 1) * 6 - 180 + 3;
  return [lon0 + deg(Math.atan2(Math.sinh(eta), Math.cos(xi))), deg(lat)];
}

export function webMercatorToLonLat(x: number, y: number): [number, number] {
  return [deg(x / A), deg(2 * Math.atan(Math.exp(y / A)) - Math.PI / 2)];
}

/** Geographic codes where the numbers already are degrees (NAD83, ETRS89, GDA, ... are within a metre of WGS 84). */
const GEOGRAPHIC = new Set([4326, 4269, 4258, 4283, 7844, 4617]);

/** A point in `epsg` as [lon, lat], or null for a system this doesn't know. */
export function toLonLat(epsg: number, x: number, y: number): [number, number] | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let out: [number, number] | null = null;
  if (GEOGRAPHIC.has(epsg)) out = [x, y];
  else if (epsg === 3857 || epsg === 900913) out = webMercatorToLonLat(x, y);
  else {
    const utm = utmZoneOf(epsg);
    if (utm) out = utmToLonLat(utm.zone, utm.south, x, y);
  }
  if (!out) return null;
  const [lon, lat] = out;
  return lon >= -180.0001 && lon <= 180.0001 && lat >= -90.0001 && lat <= 90.0001 ? out : null; // nonsense coordinates mean the wrong CRS was declared
}

/** The longitude/latitude box around a box given in `epsg`; every corner and edge midpoint is projected, since a straight edge curves. */
export function bboxToLonLat(epsg: number, minX: number, minY: number, maxX: number, maxY: number): BBox | null {
  const xs = [minX, (minX + maxX) / 2, maxX], ys = [minY, (minY + maxY) / 2, maxY];
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const p = toLonLat(epsg, x, y);
      if (!p) return null;
      w = Math.min(w, p[0]);
      e = Math.max(e, p[0]);
      s = Math.min(s, p[1]);
      n = Math.max(n, p[1]);
    }
  }
  const round = (v: number) => Math.round(v * 1e5) / 1e5; // about a metre
  return [round(w), round(s), round(e), round(n)];
}

export const unionBBox = (a: BBox | null, b: BBox): BBox => (a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b);
export const bboxContains = (box: BBox, lon: number, lat: number) => lon >= box[0] && lon <= box[2] && lat >= box[1] && lat <= box[3];
export const bboxIntersects = (a: BBox, b: BBox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/** "10.3, 76.3", "10.3N 76.3E", "10.3 N, 76.3 E" or "-33.9 151.2": a latitude and longitude, or null. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

/** "10.21°N–10.55°N, 76.11°E–76.52°E" for display. */
export function describeBBox(b: BBox): string {
  const lat = (v: number) => `${Math.abs(v).toFixed(2)}°${v < 0 ? "S" : "N"}`;
  const lon = (v: number) => `${Math.abs(v).toFixed(2)}°${v < 0 ? "W" : "E"}`;
  return `${lat(b[1])}–${lat(b[3])}, ${lon(b[0])}–${lon(b[2])}`;
}
