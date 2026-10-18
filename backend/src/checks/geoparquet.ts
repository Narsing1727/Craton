// GeoParquet: the coordinate system and geometry columns, read from the file's footer only.
//
// A GeoParquet file is a Parquet file with a "geo" entry in its footer key-value metadata whose value is JSON (the
// GeoParquet specification): { "version", "primary_column", "columns": { name: { "encoding", "geometry_types", "crs",
// "bbox" } } }. "crs" is PROJJSON; absent means OGC:CRS84 (longitude, latitude on WGS 84, the same as EPSG:4326 for
// this purpose), and an explicit null means unknown. The footer is thrift-encoded, but the JSON is stored in it as a
// plain UTF-8 string, so it is found by its own keys and parsed as JSON; nothing else in the footer is interpreted.

import type { Read } from "./geotiff.ts";

export type GeoParquetColumn = { name: string; encoding: string; geometryTypes: string[]; epsg: number | null; crsState: "declared" | "default" | "unknown"; bbox: number[] | null };
export type GeoParquetInfo = { version: string; primary: string; columns: GeoParquetColumn[] };

export class NotParquetError extends Error {}

const MAX_FOOTER = 16 * 1024 * 1024;

export async function readGeoParquet(read: Read, size: number): Promise<GeoParquetInfo | null> {
  if (size < 12) throw new NotParquetError("Not a Parquet file");
  const tail = await read(size - 8, 8);
  if (tail.toString("latin1", 4, 8) !== "PAR1") throw new NotParquetError("Not a Parquet file");
  const footerLength = tail.readUInt32LE(0);
  if (footerLength <= 0 || footerLength > MAX_FOOTER || footerLength + 8 > size) throw new Error("Parquet footer length is impossible");
  const footer = (await read(size - 8 - footerLength, footerLength)).toString("utf8");
  return parseGeoMetadata(footer);
}

/** The GeoParquet metadata object found in the footer text, or null when the file is plain Parquet. */
export function parseGeoMetadata(footer: string): GeoParquetInfo | null {
  let search = footer.length;
  // The object's keys can come in any order, so try each opening brace before "primary_column", nearest first.
  const marker = footer.indexOf('"primary_column"');
  if (marker < 0) return null;
  search = marker;
  for (let start = footer.lastIndexOf("{", search); start >= 0; start = footer.lastIndexOf("{", start - 1)) {
    const end = matchingBrace(footer, start);
    if (end < 0 || end < marker) continue;
    try {
      const meta = JSON.parse(footer.slice(start, end + 1)) as { version?: string; primary_column?: string; columns?: Record<string, Record<string, unknown>> };
      if (!meta.columns || typeof meta.primary_column !== "string") continue;
      const columns: GeoParquetColumn[] = Object.entries(meta.columns).map(([name, c]) => {
        const hasCrs = Object.prototype.hasOwnProperty.call(c, "crs");
        const crs = c.crs as { id?: { authority?: string; code?: number | string } } | null | undefined;
        let epsg: number | null = null;
        let crsState: GeoParquetColumn["crsState"] = "declared";
        if (!hasCrs) {
          // Absent: the specification's default, OGC:CRS84, is longitude/latitude on WGS 84.
          crsState = "default";
          epsg = 4326;
        } else if (crs === null) {
          crsState = "unknown";
        } else {
          const authority = String(crs?.id?.authority ?? "").toUpperCase();
          const code = Number(crs?.id?.code);
          if (authority === "EPSG" && Number.isFinite(code)) epsg = code;
          else if (authority === "OGC" && String(crs?.id?.code).toUpperCase() === "CRS84") epsg = 4326;
        }
        const bbox = Array.isArray(c.bbox) && c.bbox.every((v) => typeof v === "number") ? (c.bbox as number[]) : null;
        return {
          name,
          encoding: String(c.encoding ?? ""),
          geometryTypes: Array.isArray(c.geometry_types) ? c.geometry_types.map(String) : [],
          epsg,
          crsState,
          bbox,
        };
      });
      return { version: String(meta.version ?? ""), primary: meta.primary_column, columns };
    } catch {
      continue;
    }
  }
  return null;
}

/** Index of the brace that closes the object opened at `start`, ignoring braces inside strings; -1 if it never closes. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}
