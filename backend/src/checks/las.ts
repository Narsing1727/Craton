// LAS / LAZ point cloud header: version, point count, scale, offsets and bounds, the point record format, and the CRS
// the file declares (a GeoTIFF key directory VLR or an OGC WKT VLR). Only the public header block and the variable
// length record headers are read, never the points, so it is a few kilobytes of reads for any file size.
//
// Layout (ASPRS LAS 1.2 to 1.4): the public header block is 227 bytes in 1.2, 235 in 1.3 and 375 in 1.4; the first
// 227 bytes are the same in all of them.

import type { Read } from "./geotiff.ts";
import { NotTiffError } from "./geotiff.ts";
import { epsgFromWkt } from "./vector.ts";

export type LasInfo = {
  version: string;
  pointFormat: number;
  pointRecordLength: number;
  /** The 64-bit count in a 1.4 header when there is one, else the legacy 32-bit count. */
  pointCount: number;
  /** LAZ (LASzip) stores the points compressed: the byte size says nothing about the count. */
  compressed: boolean;
  scale: [number, number, number];
  offset: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
  offsetToPoints: number;
  epsg: number | null;
  /** The CRS as WKT, when the file carries one instead of GeoKeys. */
  wkt: string | null;
  generatingSoftware: string;
  /** Bytes the points should occupy for an uncompressed file, so a truncated upload can be seen. null for LAZ. */
  expectedSize: number | null;
};

export class NotLasError extends NotTiffError {}

const VLR_HEADER = 54;

export async function readLasHeader(read: Read, size: number): Promise<LasInfo> {
  const h = await read(0, 375);
  if (h.length < 227 || h.toString("latin1", 0, 4) !== "LASF") throw new NotLasError("Not a LAS file");
  const major = h[24];
  const minor = h[25];
  const headerSize = h.readUInt16LE(94);
  const offsetToPoints = h.readUInt32LE(96);
  const vlrCount = h.readUInt32LE(100);
  const formatByte = h[104];
  const pointFormat = formatByte & 0x3f;
  const compressed = (formatByte & 0x80) !== 0 || (formatByte & 0x40) !== 0;
  const pointRecordLength = h.readUInt16LE(105);
  let pointCount = h.readUInt32LE(107);
  if (major === 1 && minor >= 4 && h.length >= 255) {
    const big = Number(h.readBigUInt64LE(247));
    if (big > 0 || pointCount === 0) pointCount = big;
  }
  const f = (o: number) => h.readDoubleLE(o);
  const scale: [number, number, number] = [f(131), f(139), f(147)];
  const offset: [number, number, number] = [f(155), f(163), f(171)];
  // The header stores max then min for each axis: maxX minX maxY minY maxZ minZ.
  const max: [number, number, number] = [f(179), f(195), f(211)];
  const min: [number, number, number] = [f(187), f(203), f(219)];
  const generatingSoftware = h.toString("latin1", 58, 90).replace(/\0+$/, "").trim();

  // Variable length records follow the header: 54 bytes each, then their payload.
  let epsg: number | null = null;
  let wkt: string | null = null;
  let at = headerSize;
  for (let i = 0; i < vlrCount && at + VLR_HEADER <= Math.min(offsetToPoints, size); i++) {
    const head = await read(at, VLR_HEADER);
    if (head.length < VLR_HEADER) break;
    const userId = head.toString("latin1", 2, 18).replace(/\0+$/, "");
    const recordId = head.readUInt16LE(18);
    const length = head.readUInt16LE(20);
    const body = at + VLR_HEADER;
    if (userId === "LASF_Projection" && length > 0 && length < 65536) {
      const data = await read(body, length);
      if (recordId === 34735) {
        // GeoKeyDirectory: header (version, revision, minor, key count) then 4 shorts per key: id, location, count, value.
        const keys = data.readUInt16LE(6);
        for (let k = 0; k < keys && 8 + k * 8 + 8 <= data.length; k++) {
          const o = 8 + k * 8;
          const id = data.readUInt16LE(o);
          const location = data.readUInt16LE(o + 2);
          const value = data.readUInt16LE(o + 6);
          if (location !== 0 || value === 32767) continue;
          if (id === 3072) epsg = value; // ProjectedCSTypeGeoKey
          else if (id === 2048 && epsg === null) epsg = value; // GeographicTypeGeoKey
        }
      } else if (recordId === 2112) {
        wkt = data.toString("utf8").replace(/\0+$/, "").trim();
      }
    }
    at = body + length;
  }

  if (epsg === null && wkt) epsg = epsgFromWkt(wkt);
  const expectedSize = compressed ? null : offsetToPoints + pointCount * pointRecordLength;
  return {
    version: `${major}.${minor}`,
    pointFormat,
    pointRecordLength,
    pointCount,
    compressed,
    scale,
    offset,
    min,
    max,
    offsetToPoints,
    epsg,
    wkt,
    generatingSoftware,
    expectedSize,
  };
}

/** What is inconsistent in the header, in words; empty when it is sound. `size` is the file's size in bytes. */
export function lasProblems(info: LasInfo, size: number): string[] {
  const problems: string[] = [];
  if (info.expectedSize !== null && size < info.expectedSize) {
    problems.push(`truncated: the header declares ${info.pointCount.toLocaleString("en-US")} points (${info.expectedSize} bytes) but the file has ${size}`);
  }
  if (info.pointCount > 0 && info.min.some((v, i) => !(v <= info.max[i]))) problems.push("the bounds are inverted or not numbers");
  if (info.scale.some((s) => !(s > 0))) problems.push("a scale factor is zero or negative");
  return problems;
}
