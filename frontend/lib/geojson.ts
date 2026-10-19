// GeoJSON as the same features a shapefile gives the map viewer: each geometry's coordinates flattened (x, y, x, y, …), its properties as a row.
// Coordinates are longitude and latitude, as GeoJSON says (RFC 7946).

import type { ApiVectorFeatures } from "./api";

type Feature = ApiVectorFeatures["features"][number];
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const MAX_FEATURES = 5000;

const flat = (ring: Json): number[] => {
  const out: number[] = [];
  if (Array.isArray(ring)) for (const p of ring) if (Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number") out.push(p[0], p[1]);
  return out;
};

function geometryParts(g: Json): { kind: Feature["kind"]; parts: number[][] }[] {
  if (typeof g !== "object" || g === null || Array.isArray(g)) return [];
  const c = g.coordinates as Json;
  switch (g.type) {
    case "Point":
      return Array.isArray(c) && typeof c[0] === "number" ? [{ kind: "point", parts: [flat([c])] }] : [];
    case "MultiPoint":
      return [{ kind: "point", parts: (Array.isArray(c) ? c : []).map((p) => flat([p])) }];
    case "LineString":
      return [{ kind: "line", parts: [flat(c)] }];
    case "MultiLineString":
      return [{ kind: "line", parts: (Array.isArray(c) ? c : []).map(flat) }];
    case "Polygon":
      return [{ kind: "polygon", parts: (Array.isArray(c) ? c : []).map(flat) }];
    case "MultiPolygon":
      return [{ kind: "polygon", parts: (Array.isArray(c) ? c : []).flatMap((poly) => (Array.isArray(poly) ? poly.map(flat) : [])) }];
    case "GeometryCollection":
      return (Array.isArray(g.geometries) ? g.geometries : []).flatMap(geometryParts);
    default:
      return [];
  }
}

/** The features of a GeoJSON document, or null when the text is not GeoJSON (or holds nothing that can be drawn). */
export function geojsonFeatures(text: string): ApiVectorFeatures | null {
  let doc: Json;
  try {
    doc = JSON.parse(text) as Json;
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return null;
  const items: Json[] = doc.type === "FeatureCollection" && Array.isArray(doc.features) ? doc.features : doc.type === "Feature" ? [doc] : [{ type: "Feature", properties: {}, geometry: doc }];
  const features: Feature[] = [];
  const names = new Map<string, true>();
  let count = 0;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const item of items) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const drawn = geometryParts(item.geometry as Json).filter((p) => p.parts.some((part) => part.length >= 2));
    if (!drawn.length) continue;
    count++;
    if (features.length >= MAX_FEATURES) continue;
    const props: Feature["props"] = {};
    const raw = item.properties;
    if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
      for (const [k, v] of Object.entries(raw)) {
        names.set(k, true);
        props[k] = v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v);
      }
    }
    // A feature of mixed geometries is drawn as its most area-like kind of shape, all its parts in one path.
    const kind = drawn.some((p) => p.kind === "polygon") ? "polygon" : drawn.some((p) => p.kind === "line") ? "line" : "point";
    const parts = drawn.flatMap((p) => p.parts);
    for (const part of parts) for (let k = 0; k + 1 < part.length; k += 2) (x0 = Math.min(x0, part[k])), (x1 = Math.max(x1, part[k])), (y0 = Math.min(y0, part[k + 1])), (y1 = Math.max(y1, part[k + 1]));
    features.push({ i: features.length, kind, parts, props });
  }
  if (!features.length) return null;
  return {
    bbox: [x0, y0, x1, y1],
    fields: [...names.keys()].map((name) => ({ name, type: "C", length: 0, decimals: 0 })),
    count,
    shown: features.length,
    thinned: false,
    features,
  };
}
