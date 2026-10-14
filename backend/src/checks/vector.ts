// Shapefile set and .prj helpers.

/** EPSG code from a .prj (ESRI or OGC WKT): an explicit authority first, then well-known names. */
export function epsgFromWkt(wkt: string): number | null {
  // The last AUTHORITY in a PROJCS/GEOGCS belongs to the outermost CRS.
  const authorities = [...wkt.matchAll(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]/gi)];
  if (authorities.length) return Number(authorities.at(-1)![1]);
  const idMatch = [...wkt.matchAll(/ID\s*\[\s*"EPSG"\s*,\s*(\d+)\s*\]/gi)];
  if (idMatch.length) return Number(idMatch.at(-1)![1]);
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
