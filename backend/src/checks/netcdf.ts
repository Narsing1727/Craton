// NetCDF classic header (CDF-1 and the 64-bit offset variant CDF-2): dimensions, variables with their types and
// dimensions, and attributes, from the grammar in the Unidata "NetCDF classic file format specification". Only the
// header is read; the data sections are never touched. NetCDF-4 files are HDF5 containers and are recognised but not
// read; CDF-5 (64-bit counts) is recognised and not read.

import type { Read } from "./geotiff.ts";

export type NcDimension = { name: string; /** null for the record (unlimited) dimension. */ length: number | null };
export type NcAttribute = { name: string; type: string; value: string | number | number[] };
export type NcVariable = { name: string; type: string; dimensions: string[]; attributes: NcAttribute[]; /** Bytes of one variable's data (per record for a record variable). */ size: number; begin: number };
export type NetcdfInfo = {
  format: "CDF-1" | "CDF-2";
  records: number;
  dimensions: NcDimension[];
  attributes: NcAttribute[];
  variables: NcVariable[];
  /** The global "Conventions" attribute (for example "CF-1.6"), when there is one. */
  conventions: string | null;
};

export class NotNetcdfError extends Error {}

/**
 * Problems that can be seen from the header and the file size alone: a file cut short (the variables' data should end
 * where the header says, and fixed-size data ends at its largest begin + size; record data repeats once per record).
 */
export function netcdfProblems(info: NetcdfInfo, size: number): string[] {
  const problems: string[] = [];
  const isRecord = (v: NcVariable) => v.dimensions.some((d) => info.dimensions.find((x) => x.name === d)?.length === null);
  const fixedEnd = Math.max(0, ...info.variables.filter((v) => !isRecord(v)).map((v) => v.begin + v.size));
  const record = info.variables.filter(isRecord);
  const recordSize = record.reduce((n, v) => n + v.size, 0);
  const recordEnd = record.length ? Math.min(...record.map((v) => v.begin)) + info.records * recordSize : 0;
  const expected = Math.max(fixedEnd, recordEnd);
  // One record variable of byte, char or short type is stored without padding to 4 bytes, so allow 3 bytes per record.
  if (expected > 0 && size + info.records * 3 < expected) problems.push(`truncated: the header puts the end of the data at byte ${expected.toLocaleString("en-US")} but the file has ${size.toLocaleString("en-US")}`);
  return problems;
}

const TYPES: Record<number, { name: string; size: number }> = {
  1: { name: "byte", size: 1 },
  2: { name: "char", size: 1 },
  3: { name: "short", size: 2 },
  4: { name: "int", size: 4 },
  5: { name: "float", size: 4 },
  6: { name: "double", size: 8 },
};
const NC_DIMENSION = 0x0a;
const NC_VARIABLE = 0x0b;
const NC_ATTRIBUTE = 0x0c;
/** How much of the start of the file is read for the header; a header larger than this is reported, not guessed at. */
const HEADER_WINDOW = 4 * 1024 * 1024;

export async function readNetcdf(read: Read, size: number): Promise<NetcdfInfo> {
  return parseNetcdfHeader(await read(0, Math.min(size, HEADER_WINDOW)));
}

/**
 * How the data of a classic NetCDF file is best encoded: the element width and byte order (always big endian) of its
 * largest variable, which is where nearly all the bytes are. Null when the header cannot be read or the data is bytes.
 */
export function netcdfHint(head: Buffer): { kind: "numeric"; width: 2 | 4 | 8; bigEndian: true } | null {
  try {
    const info = parseNetcdfHeader(head);
    const largest = [...info.variables].sort((a, b) => b.size - a.size)[0];
    const width = largest ? ({ short: 2, int: 4, float: 4, double: 8 } as Record<string, 2 | 4 | 8>)[largest.type] : undefined;
    return width ? { kind: "numeric", width, bigEndian: true } : null;
  } catch {
    return null;
  }
}

export function parseNetcdfHeader(buf: Buffer): NetcdfInfo {
  if (buf.length >= 8 && buf.toString("latin1", 1, 4) === "HDF") throw new NotNetcdfError("NetCDF-4 (HDF5) files are not read");
  if (buf.length < 4 || buf.toString("latin1", 0, 3) !== "CDF") throw new NotNetcdfError("Not a NetCDF file");
  const version = buf[3];
  if (version === 5) throw new NotNetcdfError("CDF-5 files are not read");
  if (version !== 1 && version !== 2) throw new NotNetcdfError(`Unknown NetCDF version ${version}`);

  let at = 4;
  const need = (n: number) => {
    if (at + n > buf.length) throw new Error("The NetCDF header is longer than the part read");
  };
  const u32 = () => {
    need(4);
    const v = buf.readUInt32BE(at);
    at += 4;
    return v;
  };
  const u64 = () => {
    need(8);
    const v = Number(buf.readBigUInt64BE(at));
    at += 8;
    return v;
  };
  const name = () => {
    const n = u32();
    if (n > 1 << 16) throw new Error("A NetCDF name is implausibly long");
    need(n);
    const s = buf.toString("utf8", at, at + n);
    at += (n + 3) & ~3;
    return s;
  };
  const values = (typeCode: number, count: number): string | number | number[] => {
    const t = TYPES[typeCode];
    if (!t) throw new Error(`Unknown NetCDF type ${typeCode}`);
    const bytes = t.size * count;
    need(bytes);
    const start = at;
    at += (bytes + 3) & ~3;
    if (typeCode === 2) return buf.toString("utf8", start, start + count).replace(/\0+$/, "");
    const out: number[] = [];
    const cap = Math.min(count, 64); // an attribute can be a long array; the first values say what it is
    for (let i = 0; i < cap; i++) {
      const o = start + i * t.size;
      out.push(typeCode === 1 ? buf.readInt8(o) : typeCode === 3 ? buf.readInt16BE(o) : typeCode === 4 ? buf.readInt32BE(o) : typeCode === 5 ? buf.readFloatBE(o) : buf.readDoubleBE(o));
    }
    return count === 1 ? out[0] : out;
  };
  const attributeList = (): NcAttribute[] => {
    const tag = u32();
    const count = u32();
    if (tag === 0) return [];
    if (tag !== NC_ATTRIBUTE) throw new Error("Expected an attribute list in the NetCDF header");
    const list: NcAttribute[] = [];
    for (let i = 0; i < count; i++) {
      const n = name();
      const typeCode = u32();
      const len = u32();
      list.push({ name: n, type: TYPES[typeCode]?.name ?? String(typeCode), value: values(typeCode, len) });
    }
    return list;
  };

  const records = (() => {
    const n = u32();
    return n === 0xffffffff ? 0 : n;
  })();

  const dimensions: NcDimension[] = [];
  {
    const tag = u32();
    const count = u32();
    if (tag === NC_DIMENSION) {
      for (let i = 0; i < count; i++) {
        const n = name();
        const len = u32();
        dimensions.push({ name: n, length: len === 0 ? null : len });
      }
    } else if (tag !== 0) throw new Error("Expected a dimension list in the NetCDF header");
  }

  const attributes = attributeList();

  const variables: NcVariable[] = [];
  {
    const tag = u32();
    const count = u32();
    if (tag === NC_VARIABLE) {
      for (let i = 0; i < count; i++) {
        const n = name();
        const rank = u32();
        const dims: string[] = [];
        for (let d = 0; d < rank; d++) {
          const id = u32();
          dims.push(dimensions[id]?.name ?? `dim${id}`);
        }
        const attrs = attributeList();
        const typeCode = u32();
        const vsize = u32();
        const begin = version === 2 ? u64() : u32();
        variables.push({ name: n, type: TYPES[typeCode]?.name ?? String(typeCode), dimensions: dims, attributes: attrs, size: vsize, begin });
      }
    } else if (tag !== 0) throw new Error("Expected a variable list in the NetCDF header");
  }

  const conv = attributes.find((a) => a.name === "Conventions");
  return {
    format: version === 1 ? "CDF-1" : "CDF-2",
    records,
    dimensions,
    attributes,
    variables,
    conventions: conv && typeof conv.value === "string" ? conv.value : null,
  };
}
