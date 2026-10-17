// Small helpers for showing where data is. The heavy lifting (projecting file coordinates to
// longitude/latitude) happens on the server; this only reads and writes places for people.

export type BBox = [west: number, south: number, east: number, north: number];

/** "10.3, 76.3", "10.3N 76.3E", "10.3° N, 76.3° E" or "-33.9 151.2": a latitude and longitude, or null. */
export function parseLatLon(text: string): { lat: number; lon: number } | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]), lon = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  return lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180 ? { lat, lon } : null;
}

export const isBBox = (v: unknown): v is BBox => Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n));

export const bboxContains = (b: BBox, lon: number, lat: number) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

const lat = (v: number) => `${Math.abs(v).toFixed(2)}°${v < 0 ? "S" : "N"}`;
const lon = (v: number) => `${Math.abs(v).toFixed(2)}°${v < 0 ? "W" : "E"}`;

/** "10.21°N–10.36°N, 76.21°E–76.41°E" */
export function describeBBox(b: BBox): string {
  return `${lat(b[1])}–${lat(b[3])}, ${lon(b[0])}–${lon(b[2])}`;
}

/** "10.22°N, 76.21°E": the middle of a box, for a single-line label. */
export function describeCentre(b: BBox): string {
  return `${lat((b[1] + b[3]) / 2)}, ${lon((b[0] + b[2]) / 2)}`;
}

/** An OpenStreetMap link centred on the box at a zoom that shows all of it. Opens a normal map; nothing is sent from Craton. */
export function osmLink(b: BBox): string {
  const span = Math.max(b[2] - b[0], (b[3] - b[1]) * 2, 1e-6); // degrees of longitude the view must hold (latitude counts double)
  const zoom = Math.max(1, Math.min(17, Math.floor(Math.log2(360 / span)) - 1));
  const cLat = ((b[1] + b[3]) / 2).toFixed(5), cLon = ((b[0] + b[2]) / 2).toFixed(5);
  return `https://www.openstreetmap.org/#map=${zoom}/${cLat}/${cLon}`;
}
