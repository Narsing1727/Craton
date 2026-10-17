// Shapefile set and .prj helpers.

/** EPSG code from a .prj (ESRI or OGC WKT): an explicit authority first, then well-known names. */
/**
 * The EPSG code a WKT string declares for the coordinate system as a whole: the AUTHORITY (WKT1) or ID (WKT2) that is a
 * direct child of the outermost element. An AUTHORITY deeper in (the unit's "9001" or "9002", an axis, the datum, the
 * base geographic CRS) describes a part, not the CRS, and is not it. When the WKT does not name its own code, a
 * WGS 84 UTM zone or WGS 84 geographic name is recognised, and anything else is "unknown" rather than a guess.
 */
export function epsgFromWkt(wkt: string): number | null {
  let depth = 0;
  let inQuote = false;
  let found: number | null = null;
  for (let i = 0; i < wkt.length; i++) {
    const ch = wkt[i];
    if (ch === '"') inQuote = !inQuote;
    if (inQuote) continue;
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (depth === 1 && (ch === "A" || ch === "a" || ch === "I" || ch === "i")) {
      const m = /^(?:AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]|ID\s*\[\s*"EPSG"\s*,\s*(\d+)\s*[,\]])/i.exec(wkt.slice(i, i + 80));
      if (m) found = Number(m[1] ?? m[2]);
    }
  }
  if (found !== null) return found;
  const utm = wkt.match(/WGS[ _]?(?:19)?84[ _/]*UTM[ _]zone[ _](\d{1,2})([NS])/i);
  if (utm) return (utm[2].toUpperCase() === "N" ? 32600 : 32700) + Number(utm[1]);
  if (/^\s*GEOGCS\s*\[\s*"(?:GCS_)?WGS[ _]?(?:19)?84"/i.test(wkt)) return 4326;
  return null;
}

export type ShpHeader = { valid: boolean; declaredBytes: number; shapeType: number; bbox: [number, number, number, number] };

/** Parse the 100-byte .shp/.shx header (big-endian file code and length, little-endian rest). */
export function readShpHeader(buf: Buffer): ShpHeader | null {
  if (buf.length < 100) return null;
  const fileCode = buf.readInt32BE(0);
  const words = buf.readInt32BE(24);
  const version = buf.readInt32LE(28);
  return {
    valid: fileCode === 9994 && version === 1000,
    declaredBytes: words * 2,
    shapeType: buf.readInt32LE(32),
    bbox: [buf.readDoubleLE(36), buf.readDoubleLE(44), buf.readDoubleLE(52), buf.readDoubleLE(60)],
  };
}

/** Geometry and flow files a HEC-RAS plan (.p01…) points at, e.g. "Geom File=g01". */
export function hecRasPlanRefs(text: string) {
  const geom = text.match(/^Geom File=(\w+)/m)?.[1] ?? null;
  const flow = text.match(/^(?:Flow|Unsteady) File=(\w+)/m)?.[1] ?? null;
  return { geom, flow };
}
