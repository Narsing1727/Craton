// HDF5 structure: the groups and datasets of a file, with each dataset's shape and element type, from the layout in
// "The HDF5 File Format Specification" (versions 2 and 3). Only metadata is read (superblock, object headers, group
// B-trees and heaps); dataset bytes and attributes are never touched. HEC-RAS plan, geometry and results files
// (.p01.hdf, .g01.hdf) are HDF5, so this is what lets the file page say what a results file holds.
//
// Supported: superblock 0 to 3 (including a user block), object header 1 and 2 with continuation blocks, groups stored
// as symbol tables (the default of older libraries and of HEC-RAS), as link messages in the header, and as dense
// storage (fractal heap + version 2 B-tree). Not read, and said so in `notes`: filtered (compressed) link heaps, huge or
// tiny heap objects, shared object-header messages.

import type { Read } from "./geotiff.ts";

export type AttributeValue = string | number | number[];

export type Hdf5Object = {
  path: string;
  kind: "group" | "dataset" | "datatype" | "soft-link" | "external-link" | "unknown";
  /** Dataset shape ([] for a scalar); null for anything else and for an empty (null dataspace) dataset. */
  shape: number[] | null;
  /** Dataset element type, such as "float32", "int16", "string", "compound". */
  type: string | null;
  /** Number of links in a group. */
  links: number | null;
  /** A group's attributes that could be read: text, a number, or a short list of numbers. */
  attributes?: Record<string, AttributeValue>;
};

export type Hdf5Info = {
  /** Superblock version, 0 to 3. */
  version: number;
  objects: Hdf5Object[];
  /** The end of the file as the superblock records it, in bytes from the start of the file. */
  declaredEnd: number | null;
  /** True when the object limit stopped the walk before everything was listed. */
  limited: boolean;
  /** Things this reader met and did not read. */
  notes: string[];
};

export class NotHdf5Error extends Error {}
class Hdf5Error extends Error {}

/** The most objects listed from one file; a results file has tens to a few thousand. */
export const MAX_OBJECTS = 5000;
const MAX_DEPTH = 40;
/** Attributes are read for groups this deep (HEC-RAS keeps run summaries four to five levels down) and no more than this many of them. */
const MAX_ATTRIBUTE_DEPTH = 6;
const MAX_ATTRIBUTE_GROUPS = 200;
const PAGE = 32 * 1024;
const MAX_PAGES = 256;
const SIGNATURE = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
const UNDEF = -1;

type Source = { size: number; bytes: (offset: number, length: number) => Promise<Buffer> };

function makeSource(read: Read, size: number): Source {
  const pages = new Map<number, Buffer>();
  const page = async (i: number) => {
    let p = pages.get(i);
    if (!p) {
      p = await read(i * PAGE, Math.min(PAGE, size - i * PAGE));
      if (pages.size >= MAX_PAGES) pages.delete(pages.keys().next().value as number);
      pages.set(i, p);
    }
    return p;
  };
  return {
    size,
    async bytes(offset: number, length: number) {
      if (!Number.isFinite(offset) || offset < 0 || offset > size) throw new Hdf5Error(`address ${offset} is outside the file`);
      const end = Math.min(size, offset + length);
      const parts: Buffer[] = [];
      for (let i = Math.floor(offset / PAGE); i * PAGE < end; i++) {
        const p = await page(i);
        parts.push(p.subarray(Math.max(0, offset - i * PAGE), Math.min(p.length, end - i * PAGE)));
      }
      return parts.length === 1 ? parts[0] : Buffer.concat(parts);
    },
  };
}

/** Little-endian unsigned integer of 1, 2, 4 or 8 bytes; an all-ones value (an undefined address) is UNDEF. */
function uint(b: Buffer, pos: number, n: number): number {
  if (pos < 0 || pos + n > b.length) throw new Hdf5Error("structure cut short");
  switch (n) {
    case 1:
      return b[pos];
    case 2:
      return b.readUInt16LE(pos);
    case 4: {
      const v = b.readUInt32LE(pos);
      return v === 0xffffffff ? UNDEF : v;
    }
    case 8: {
      const v = b.readBigUInt64LE(pos);
      if (v === 0xffffffffffffffffn) return UNDEF;
      if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Hdf5Error("value too large");
      return Number(v);
    }
    default: {
      // Odd widths (sizes of offsets are always 1, 2, 4 or 8, but a variable-width field can be 3 or 5 bytes).
      let v = 0;
      for (let i = n - 1; i >= 0; i--) v = v * 256 + b[pos + i];
      return v;
    }
  }
}

/** Bytes needed to hold the value n (HDF5's limit-encoded size). */
const bytesFor = (n: number) => Math.floor(Math.log2(Math.max(1, n)) / 8) + 1;

type Message = { type: number; data: Buffer; flags: number };

type Ctx = {
  src: Source;
  base: number;
  O: number;
  L: number;
  notes: Set<string>;
};

const addr = (c: Ctx, a: number) => c.base + a;

async function readMessages(c: Ctx, at: number): Promise<Message[]> {
  const head = await c.src.bytes(addr(c, at), 64);
  const out: Message[] = [];
  const queue: { offset: number; length: number; v2: boolean; ordered: boolean }[] = [];
  if (head.subarray(0, 4).toString("latin1") === "OHDR") {
    // Version 2: prefix, then messages of 4-byte headers (6 when creation order is tracked), then a checksum.
    const flags = head[5];
    let pos = 6;
    if (flags & 0x20) pos += 16;
    if (flags & 0x10) pos += 4;
    const sizeWidth = 1 << (flags & 3);
    const chunk0 = uint(head, pos, sizeWidth);
    pos += sizeWidth;
    queue.push({ offset: at + pos, length: chunk0, v2: true, ordered: (flags & 0x04) !== 0 });
  } else {
    if (head[0] !== 1) throw new Hdf5Error(`object header version ${head[0]} is not one this reader knows`);
    queue.push({ offset: at + 16, length: head.readUInt32LE(8), v2: false, ordered: false });
  }
  let chunks = 0;
  while (queue.length) {
    const q = queue.shift()!;
    if (++chunks > 64) throw new Hdf5Error("too many header continuation blocks");
    let region = await c.src.bytes(addr(c, q.offset), q.length);
    let pos = 0;
    let end = region.length;
    if (q.v2 && chunks > 1) {
      // A continuation chunk of a version 2 header: signature OCHK, messages, checksum.
      if (region.subarray(0, 4).toString("latin1") !== "OCHK") throw new Hdf5Error("continuation block signature is wrong");
      pos = 4;
      end -= 4;
    }
    const headerSize = q.v2 ? (q.ordered ? 6 : 4) : 8;
    while (pos + headerSize <= end) {
      const type = q.v2 ? region[pos] : region.readUInt16LE(pos);
      const size = q.v2 ? region.readUInt16LE(pos + 1) : region.readUInt16LE(pos + 2);
      const flags = q.v2 ? region[pos + 3] : region[pos + 4];
      pos += headerSize;
      if (pos + size > end) break;
      const data = region.subarray(pos, pos + size);
      pos += size;
      if (type === 0x10) {
        queue.push({ offset: uint(data, 0, c.O), length: uint(data, c.O, c.L), v2: q.v2, ordered: q.ordered });
      } else if (type !== 0) {
        out.push({ type, data, flags });
      }
    }
    region = Buffer.alloc(0);
  }
  return out;
}

// ---- Dataspace and datatype -----------------------------------------------------------------------------------

function shapeOf(c: Ctx, m: Message): number[] | null {
  const d = m.data;
  const version = d[0];
  const rank = d[1];
  const flags = d[2];
  let pos: number;
  if (version === 1) pos = 8;
  else if (version === 2) {
    if (d[3] === 2) return null; // null dataspace: no elements
    pos = 4;
  } else throw new Hdf5Error(`dataspace version ${version}`);
  void flags;
  const dims: number[] = [];
  for (let i = 0; i < rank; i++) dims.push(uint(d, pos + i * c.L, c.L));
  return dims;
}

function typeOf(m: Message): string {
  const d = m.data;
  const cls = d[0] & 0x0f;
  const size = d.readUInt32LE(4);
  switch (cls) {
    case 0: {
      const signed = (d[1] & 0x08) !== 0;
      return `${signed ? "int" : "uint"}${size * 8}`;
    }
    case 1:
      return `float${size * 8}`;
    case 2:
      return "time";
    case 3:
      return "string";
    case 4:
      return "bitfield";
    case 5:
      return "opaque";
    case 6:
      return "compound";
    case 7:
      return "reference";
    case 8:
      return "enum";
    case 9:
      return (d[1] & 0x0f) === 1 ? "string" : "vlen";
    case 10:
      return "array";
    default:
      return `class${cls}`;
  }
}

// ---- Links ------------------------------------------------------------------------------------------------------

type Link = { name: string; kind: "hard" | "soft" | "external"; address: number };

function parseLink(c: Ctx, d: Buffer): Link | null {
  if (d[0] !== 1) return null;
  const flags = d[1];
  let pos = 2;
  let type = 0;
  if (flags & 0x08) type = d[pos++];
  if (flags & 0x04) pos += 8;
  if (flags & 0x10) pos++;
  const lenWidth = 1 << (flags & 3);
  const nameLength = uint(d, pos, lenWidth);
  pos += lenWidth;
  const name = d.subarray(pos, pos + nameLength).toString("utf8");
  pos += nameLength;
  if (type === 0) return { name, kind: "hard", address: uint(d, pos, c.O) };
  if (type === 1) return { name, kind: "soft", address: UNDEF };
  if (type === 64) return { name, kind: "external", address: UNDEF };
  return null;
}

/** Old style: group B-tree (version 1) over symbol table nodes, names in a local heap. */
async function symbolTableLinks(c: Ctx, btree: number, heap: number): Promise<Link[]> {
  const h = await c.src.bytes(addr(c, heap), 8 + 2 * c.L + c.O);
  if (h.subarray(0, 4).toString("latin1") !== "HEAP") throw new Hdf5Error("local heap signature is wrong");
  const dataAddress = uint(h, 8 + 2 * c.L, c.O);
  const links: Link[] = [];
  const nameAt = async (offset: number) => {
    const at = addr(c, dataAddress + offset);
    let length = 256;
    for (;;) {
      const b = await c.src.bytes(at, length);
      const z = b.indexOf(0);
      if (z >= 0) return b.subarray(0, z).toString("utf8");
      if (b.length < length || length >= 65536) return b.toString("utf8");
      length *= 4;
    }
  };
  const seen = new Set<number>();
  const visit = async (node: number, depth: number): Promise<void> => {
    if (depth > 16 || seen.has(node)) throw new Hdf5Error("group B-tree is malformed");
    seen.add(node);
    const head = await c.src.bytes(addr(c, node), 8 + 2 * c.O);
    if (head.subarray(0, 4).toString("latin1") !== "TREE" || head[4] !== 0) throw new Hdf5Error("group B-tree node signature is wrong");
    const level = head[5];
    const used = head.readUInt16LE(6);
    const body = await c.src.bytes(addr(c, node) + 8 + 2 * c.O, c.L + used * (c.O + c.L));
    for (let i = 0; i < used; i++) {
      const child = uint(body, c.L + i * (c.O + c.L), c.O);
      if (level > 0) {
        await visit(child, depth + 1);
        continue;
      }
      const snod = await c.src.bytes(addr(c, child), 8);
      if (snod.subarray(0, 4).toString("latin1") !== "SNOD") throw new Hdf5Error("symbol table node signature is wrong");
      const count = snod.readUInt16LE(6);
      const entrySize = 2 * c.O + 24;
      const entries = await c.src.bytes(addr(c, child) + 8, count * entrySize);
      for (let k = 0; k < count; k++) {
        const nameOffset = uint(entries, k * entrySize, c.O);
        const objectAddress = uint(entries, k * entrySize + c.O, c.O);
        const cache = entries.readUInt32LE(k * entrySize + 2 * c.O);
        let kind: Link["kind"] = "hard";
        let name = await nameAt(nameOffset);
        if (cache === 2) {
          // A symbolic link: its target path is in the local heap at the offset kept in the scratch pad.
          kind = "soft";
          name = name || "";
        }
        links.push({ name, kind, address: kind === "hard" ? objectAddress : UNDEF });
      }
    }
  };
  await visit(btree, 0);
  return links;
}

type Heap = {
  idLength: number;
  filtered: boolean;
  tableWidth: number;
  startBlock: number;
  maxDirect: number;
  offsetBytes: number;
  lengthBytes: number;
  rootAddress: number;
  rootRows: number;
  checksummed: boolean;
};

async function openHeap(c: Ctx, at: number): Promise<Heap> {
  const b = await c.src.bytes(addr(c, at), 160);
  if (b.subarray(0, 4).toString("latin1") !== "FRHP") throw new Hdf5Error("fractal heap signature is wrong");
  const idLength = b.readUInt16LE(5);
  const filterLength = b.readUInt16LE(7);
  const flags = b[9];
  const maxManaged = b.readUInt32LE(10);
  const { O, L } = c;
  // After the first 14 bytes: huge id (L), huge btree (O), free space (L), free manager (O), managed space (L),
  // allocated (L), iterator offset (L), managed count (L), huge size (L), huge count (L), tiny size (L), tiny count (L).
  let pos = 14 + L + O + L + O + L + L + L + L + L + L + L + L;
  const tableWidth = b.readUInt16LE(pos);
  pos += 2;
  const startBlock = uint(b, pos, L);
  pos += L;
  const maxDirect = uint(b, pos, L);
  pos += L;
  const maxHeapBits = b.readUInt16LE(pos);
  pos += 2;
  pos += 2; // starting number of rows in the root indirect block
  const rootAddress = uint(b, pos, O);
  pos += O;
  const rootRows = b.readUInt16LE(pos);
  return {
    idLength,
    filtered: filterLength > 0,
    tableWidth,
    startBlock,
    maxDirect,
    offsetBytes: Math.ceil(maxHeapBits / 8),
    lengthBytes: Math.min(bytesFor(maxDirect), bytesFor(maxManaged)),
    rootAddress,
    rootRows,
    checksummed: (flags & 0x02) !== 0,
  };
}

/** The file address of the direct block holding heap offset `offset`, with the heap offset that block starts at. */
async function directBlockFor(c: Ctx, h: Heap, offset: number): Promise<{ address: number; start: number } | null> {
  const rowSize = (r: number) => (r === 0 ? h.startBlock : h.startBlock * 2 ** (r - 1));
  const directRows = Math.log2(h.maxDirect / h.startBlock) + 2;
  if (h.rootRows === 0) {
    return offset < h.startBlock ? { address: h.rootAddress, start: 0 } : null;
  }
  const descend = async (block: number, rows: number, first: number, depth: number): Promise<{ address: number; start: number } | null> => {
    if (depth > 8 || block === UNDEF) return null;
    const entry = h.filtered ? c.O + c.L + 4 : c.O;
    const header = 4 + 1 + c.O + h.offsetBytes;
    const ib = await c.src.bytes(addr(c, block), header + rows * h.tableWidth * entry + 4);
    if (ib.subarray(0, 4).toString("latin1") !== "FHIB") throw new Hdf5Error("fractal heap indirect block signature is wrong");
    let start = first;
    for (let r = 0; r < rows; r++) {
      const size = rowSize(r);
      for (let col = 0; col < h.tableWidth; col++) {
        const direct = r < directRows;
        const here = uint(ib, header + (r * h.tableWidth + col) * entry, c.O);
        if (offset >= start && offset < start + size) {
          if (here === UNDEF) return null;
          if (direct) return { address: here, start };
          const childRows = Math.log2(size / (h.startBlock * h.tableWidth)) + 1;
          return descend(here, childRows, start, depth + 1);
        }
        start += size;
      }
    }
    return null;
  };
  return descend(h.rootAddress, h.rootRows, 0, 0);
}

async function heapObject(c: Ctx, h: Heap, id: Buffer): Promise<Buffer | null> {
  if ((id[0] & 0xc0) !== 0) return null;
  const type = (id[0] & 0x30) >> 4;
  if (type !== 0) {
    c.notes.add(type === 1 ? "huge link objects in a group were not read" : "tiny link objects in a group were not read");
    return null;
  }
  const offset = uint(id, 1, h.offsetBytes);
  const length = uint(id, 1 + h.offsetBytes, h.lengthBytes);
  const block = await directBlockFor(c, h, offset);
  if (!block) return null;
  return c.src.bytes(addr(c, block.address + (offset - block.start)), length);
}

/** Dense links: the version 2 B-tree of name records, each holding the id of a link message in the fractal heap. */
async function denseObjects(c: Ctx, heapAddress: number, treeAddress: number, recordType: number, what: string): Promise<Buffer[]> {
  const heap = await openHeap(c, heapAddress);
  if (heap.filtered) {
    c.notes.add(`${what} held in a compressed heap were not read`);
    return [];
  }
  const t = await c.src.bytes(addr(c, treeAddress), 16 + c.O + 2 + c.L + 4);
  if (t.subarray(0, 4).toString("latin1") !== "BTHD") throw new Hdf5Error("version 2 B-tree header signature is wrong");
  if (t[5] !== recordType) return [];
  const nodeSize = t.readUInt32LE(6);
  const recordSize = t.readUInt16LE(10);
  const depth = t.readUInt16LE(12);
  const root = uint(t, 16, c.O);
  const rootRecords = t.readUInt16LE(16 + c.O);
  if (root === UNDEF || rootRecords === 0) return [];

  // Per-level capacity, as the library computes it, because the child pointer widths depend on it.
  const prefix = 10;
  const maxRecords: number[] = [Math.floor((nodeSize - prefix) / recordSize)];
  const cumulative: number[] = [maxRecords[0]];
  const cumulativeSize: number[] = [0];
  const maxNrecSize = bytesFor(maxRecords[0]);
  for (let u = 1; u <= depth; u++) {
    const pointer = c.O + maxNrecSize + cumulativeSize[u - 1];
    maxRecords[u] = Math.floor((nodeSize - prefix - pointer) / (recordSize + pointer));
    cumulative[u] = (maxRecords[u] + 1) * cumulative[u - 1] + maxRecords[u];
    cumulativeSize[u] = bytesFor(cumulative[u]);
  }

  const found: Buffer[] = [];
  // Link name records are hash(4) + heap id; attribute name records start with the heap id.
  const idAt = recordType === 5 ? 4 : 0;
  const addRecord = async (rec: Buffer) => {
    const object = await heapObject(c, heap, rec.subarray(idAt, idAt + Math.min(heap.idLength, rec.length - idAt)));
    if (object) found.push(object);
  };
  const visit = async (node: number, records: number, level: number): Promise<void> => {
    if (found.length > MAX_OBJECTS * 4) throw new Hdf5Error(`too many ${what}`);
    if (level === 0) {
      const leaf = await c.src.bytes(addr(c, node), 6 + records * recordSize);
      if (leaf.subarray(0, 4).toString("latin1") !== "BTLF") throw new Hdf5Error("version 2 B-tree leaf signature is wrong");
      for (let i = 0; i < records; i++) await addRecord(leaf.subarray(6 + i * recordSize, 6 + (i + 1) * recordSize));
      return;
    }
    const pointer = c.O + maxNrecSize + (level - 1 > 0 ? cumulativeSize[level - 1] : 0);
    const internal = await c.src.bytes(addr(c, node), 6 + records * recordSize + (records + 1) * pointer);
    if (internal.subarray(0, 4).toString("latin1") !== "BTIN") throw new Hdf5Error("version 2 B-tree internal node signature is wrong");
    const childBase = 6 + records * recordSize;
    for (let i = 0; i < records; i++) await addRecord(internal.subarray(6 + i * recordSize, 6 + (i + 1) * recordSize));
    for (let i = 0; i <= records; i++) {
      const p = childBase + i * pointer;
      await visit(uint(internal, p, c.O), uint(internal, p + c.O, maxNrecSize), level - 1);
    }
  };
  await visit(root, rootRecords, depth);
  return found;
}

async function denseLinks(c: Ctx, heapAddress: number, treeAddress: number): Promise<Link[]> {
  const objects = await denseObjects(c, heapAddress, treeAddress, 5, "links");
  return objects.map((o) => parseLink(c, o)).filter((l): l is Link => l !== null);
}

async function linksOf(c: Ctx, messages: Message[]): Promise<Link[] | null> {
  const symbol = messages.find((m) => m.type === 0x11);
  if (symbol) return symbolTableLinks(c, uint(symbol.data, 0, c.O), uint(symbol.data, c.O, c.O));
  const info = messages.find((m) => m.type === 0x02);
  const compact = messages.filter((m) => m.type === 0x06).map((m) => parseLink(c, m.data)).filter((l): l is Link => l !== null);
  if (info) {
    const flags = info.data[1];
    let pos = 2;
    if (flags & 0x01) pos += 8;
    const heap = uint(info.data, pos, c.O);
    const tree = uint(info.data, pos + c.O, c.O);
    if (heap !== UNDEF && tree !== UNDEF) return [...compact, ...(await denseLinks(c, heap, tree))];
    return compact;
  }
  return compact.length ? compact : null;
}


// ---- Attributes -------------------------------------------------------------------------------------------------
//
// HEC-RAS keeps the plan's title, program version, units and time window as attributes of a few groups. Read only for
// groups, only text and small numeric values, and never the bulk data.

const MAX_ATTRIBUTE_TEXT = 400;
const MAX_ATTRIBUTE_VALUES = 16;
const pad8 = (n: number) => (n + 7) & ~7;

/** A global heap collection (where variable-length strings live), read once per file. */
async function globalHeapObject(c: Ctx, cache: Map<number, Buffer | null>, collection: number, index: number): Promise<Buffer | null> {
  if (collection === UNDEF || index === 0) return null;
  let heap = cache.get(collection);
  if (heap === undefined) {
    try {
      const head = await c.src.bytes(addr(c, collection), 8 + c.L);
      if (head.subarray(0, 4).toString("latin1") !== "GCOL") heap = null;
      else heap = await c.src.bytes(addr(c, collection), Math.min(uint(head, 8, c.L), 4 * 1024 * 1024));
    } catch {
      heap = null;
    }
    cache.set(collection, heap);
  }
  if (!heap) return null;
  // Objects: index(2) reference count(2) reserved(4) size(L), then the data padded to 8 bytes.
  let pos = 8 + c.L;
  const header = 8 + c.L;
  while (pos + header <= heap.length) {
    const id = heap.readUInt16LE(pos);
    if (id === 0) return null;
    const size = uint(heap, pos + 8, c.L);
    if (id === index) return heap.subarray(pos + header, pos + header + size);
    pos += header + pad8(size);
  }
  return null;
}

function numberAt(d: Buffer, pos: number, cls: number, size: number, bits: number): number | null {
  const be = (bits & 0x01) !== 0;
  if (pos + size > d.length) return null;
  if (cls === 1) {
    if (size === 4) return be ? d.readFloatBE(pos) : d.readFloatLE(pos);
    if (size === 8) return be ? d.readDoubleBE(pos) : d.readDoubleLE(pos);
    return null;
  }
  const signed = (bits & 0x08) !== 0;
  switch (size) {
    case 1:
      return signed ? d.readInt8(pos) : d[pos];
    case 2:
      return be ? (signed ? d.readInt16BE(pos) : d.readUInt16BE(pos)) : signed ? d.readInt16LE(pos) : d.readUInt16LE(pos);
    case 4:
      return be ? (signed ? d.readInt32BE(pos) : d.readUInt32BE(pos)) : signed ? d.readInt32LE(pos) : d.readUInt32LE(pos);
    case 8: {
      const v = be ? (signed ? d.readBigInt64BE(pos) : d.readBigUInt64BE(pos)) : signed ? d.readBigInt64LE(pos) : d.readBigUInt64LE(pos);
      return Number(v);
    }
    default:
      return null;
  }
}

/** One attribute message (versions 1 to 3), or null when its type or storage is one this reader does not decode. */
async function parseAttribute(c: Ctx, cache: Map<number, Buffer | null>, d: Buffer): Promise<{ name: string; value: AttributeValue } | null> {
  const version = d[0];
  if (version < 1 || version > 3) return null;
  const nameSize = d.readUInt16LE(2);
  const typeSize = d.readUInt16LE(4);
  const spaceSize = d.readUInt16LE(6);
  let pos = version === 3 ? 9 : 8;
  if (version >= 2 && (d[1] & 0x03) !== 0) return null; // datatype or dataspace held in the shared message heap
  const take = (n: number) => {
    const part = d.subarray(pos, pos + n);
    pos += version === 1 ? pad8(n) : n;
    return part;
  };
  const rawName = take(nameSize);
  const type = take(typeSize);
  const space = take(spaceSize);
  const data = d.subarray(pos);
  const name = rawName.subarray(0, Math.max(0, rawName.indexOf(0) === -1 ? rawName.length : rawName.indexOf(0))).toString("utf8");
  if (!name || type.length < 8) return null;

  const dims = shapeOf(c, { type: 1, data: space, flags: 0 });
  if (dims === null) return null;
  const count = dims.reduce((a, b) => a * b, 1);
  if (count === 0 || count > 1_000_000) return null;
  let cls = type[0] & 0x0f;
  let bits = type[1];
  let size = type.readUInt32LE(4);
  // An enumeration (HDF5 booleans among them) is stored as its integer base type; the names are not needed here.
  if (cls === 8 && type.length >= 16) {
    cls = type[8] & 0x0f;
    bits = type[9];
    size = type.readUInt32LE(12);
  }

  // A bitfield is an unsigned integer of that width.
  if (cls === 4) {
    cls = 0;
    bits &= ~0x08;
  }

  if (cls === 3) {
    // Fixed-length string: null terminated, null padded or space padded.
    const one = (i: number) => {
      const raw = data.subarray(i * size, (i + 1) * size);
      const z = raw.indexOf(0);
      const text = (z >= 0 ? raw.subarray(0, z) : raw).toString("utf8");
      return (bits & 0x0f) === 2 ? text.replace(/ +$/, "") : text;
    };
    const values = Array.from({ length: Math.min(count, MAX_ATTRIBUTE_VALUES) }, (_, i) => one(i));
    return { name, value: values.join(", ").slice(0, MAX_ATTRIBUTE_TEXT) };
  }
  if (cls === 9 && (bits & 0x0f) === 1) {
    // Variable-length string: length(4), global heap collection address(O), object index(4) for each element.
    const each = 4 + c.O + 4;
    const values: string[] = [];
    for (let i = 0; i < Math.min(count, MAX_ATTRIBUTE_VALUES); i++) {
      const at = i * each;
      if (at + each > data.length) break;
      const length = data.readUInt32LE(at);
      const object = await globalHeapObject(c, cache, uint(data, at + 4, c.O), data.readUInt32LE(at + 4 + c.O));
      values.push(object ? object.subarray(0, Math.min(length, object.length)).toString("utf8") : "");
    }
    return { name, value: values.join(", ").slice(0, MAX_ATTRIBUTE_TEXT) };
  }
  if (cls === 0 || cls === 1) {
    const numbers: number[] = [];
    for (let i = 0; i < Math.min(count, MAX_ATTRIBUTE_VALUES); i++) {
      const v = numberAt(data, i * size, cls, size, bits);
      if (v === null || !Number.isFinite(v)) return null;
      numbers.push(v);
    }
    return { name, value: count === 1 && dims.length === 0 ? numbers[0] : count === 1 ? numbers[0] : numbers };
  }
  return null;
}

async function attributesOf(c: Ctx, cache: Map<number, Buffer | null>, messages: Message[]): Promise<Record<string, AttributeValue>> {
  const out: Record<string, AttributeValue> = {};
  const add = async (d: Buffer) => {
    try {
      const a = await parseAttribute(c, cache, d);
      if (a) out[a.name] = a.value;
    } catch (err) {
      if (!(err instanceof Hdf5Error)) throw err;
    }
  };
  for (const m of messages) if (m.type === 0x0c) await add(m.data);
  // More than a handful of attributes move to dense storage: an attribute info message points at a heap and a B-tree.
  const info = messages.find((m) => m.type === 0x15);
  if (info) {
    let pos = 2;
    if (info.data[1] & 0x01) pos += 2;
    const heap = uint(info.data, pos, c.O);
    const tree = uint(info.data, pos + c.O, c.O);
    if (heap !== UNDEF && tree !== UNDEF) {
      try {
        for (const object of await denseObjects(c, heap, tree, 8, "attributes")) await add(object);
      } catch (err) {
        if (!(err instanceof Hdf5Error)) throw err;
        c.notes.add(`attributes could not be read (${err.message})`);
      }
    }
  }
  return out;
}

// ---- Walk -------------------------------------------------------------------------------------------------------

export async function readHdf5(read: Read, size: number, options: { maxObjects?: number; onDataset?: (path: string, messages: Message[], c: Ctx) => Promise<void> } = {}): Promise<Hdf5Info> {
  const limit = options.maxObjects ?? MAX_OBJECTS;
  const src = makeSource(read, size);
  // The superblock is at 0, or after a user block at 512, 1024, 2048 ...
  let at = -1;
  for (let p = 0; p + 8 <= size && p <= 1 << 24; p = p === 0 ? 512 : p * 2) {
    if ((await src.bytes(p, 8)).equals(SIGNATURE)) {
      at = p;
      break;
    }
  }
  if (at < 0) throw new NotHdf5Error("not an HDF5 file: no signature");
  const sb = await src.bytes(at, 128);
  const version = sb[8];
  let O: number, L: number, base: number, end: number, rootHeader: number;
  if (version === 0 || version === 1) {
    O = sb[13];
    L = sb[14];
    const start = version === 0 ? 24 : 28;
    base = uint(sb, start, O);
    end = uint(sb, start + 2 * O, O);
    rootHeader = uint(sb, start + 4 * O + O, O);
  } else if (version === 2 || version === 3) {
    O = sb[9];
    L = sb[10];
    base = uint(sb, 12, O);
    end = uint(sb, 12 + 2 * O, O);
    rootHeader = uint(sb, 12 + 3 * O, O);
  } else {
    throw new NotHdf5Error(`HDF5 superblock version ${version} is not one this reader knows`);
  }
  if (![1, 2, 4, 8].includes(O) || ![1, 2, 4, 8].includes(L)) throw new Hdf5Error("size of offsets or lengths is not usual");
  const c: Ctx = { src, base, O, L, notes: new Set() };
  const objects: Hdf5Object[] = [];
  let limited = false;
  const heapCache = new Map<number, Buffer | null>();
  let attributeGroups = 0;

  const visit = async (path: string, address: number, ancestors: number[], depth: number): Promise<void> => {
    if (objects.length >= limit) {
      limited = true;
      return;
    }
    let messages: Message[];
    try {
      messages = await readMessages(c, address);
    } catch (err) {
      if (err instanceof Hdf5Error) {
        c.notes.add(`an object at ${path || "/"} could not be read (${err.message})`);
        objects.push({ path: path || "/", kind: "unknown", shape: null, type: null, links: null });
        return;
      }
      throw err;
    }
    const space = messages.find((m) => m.type === 0x01);
    const dtype = messages.find((m) => m.type === 0x03);
    const isGroup = messages.some((m) => m.type === 0x11 || m.type === 0x02 || m.type === 0x06);
    if (!isGroup && space && messages.some((m) => m.type === 0x08)) {
      await options.onDataset?.(path, messages, c);
      objects.push({ path, kind: "dataset", shape: shapeOf(c, space), type: dtype ? typeOf(dtype) : null, links: null });
      return;
    }
    if (!isGroup && dtype) {
      objects.push({ path, kind: "datatype", shape: null, type: typeOf(dtype), links: null });
      return;
    }
    if (ancestors.includes(address) || depth > MAX_DEPTH) {
      objects.push({ path: path || "/", kind: "group", shape: null, type: null, links: null });
      return;
    }
    let links: Link[] | null;
    try {
      links = await linksOf(c, messages);
    } catch (err) {
      if (err instanceof Hdf5Error) {
        c.notes.add(`the links of ${path || "/"} could not be read (${err.message})`);
        links = [];
      } else throw err;
    }
    const group: Hdf5Object = { path: path || "/", kind: "group", shape: null, type: null, links: links ? links.length : 0 };
    if (depth <= MAX_ATTRIBUTE_DEPTH && attributeGroups < MAX_ATTRIBUTE_GROUPS) {
      attributeGroups++;
      const attributes = await attributesOf(c, heapCache, messages);
      if (Object.keys(attributes).length) group.attributes = attributes;
    }
    objects.push(group);
    for (const link of [...(links ?? [])].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      const child = `${path}/${link.name}`;
      // The limit is a hard bound: links are objects too.
      if (objects.length >= limit) {
        limited = true;
        return;
      }
      if (link.kind === "soft") {
        objects.push({ path: child, kind: "soft-link", shape: null, type: null, links: null });
      } else if (link.kind === "external") {
        objects.push({ path: child, kind: "external-link", shape: null, type: null, links: null });
      } else {
        await visit(child, link.address, [...ancestors, address], depth + 1);
      }
      if (limited) return;
    }
  };

  await visit("", rootHeader, [], 0);
  return { version, objects, declaredEnd: end === UNDEF ? null : end, limited, notes: [...c.notes] };
}

/** Problems that can be seen from the superblock and the file size alone. */
export function hdf5Problems(info: Hdf5Info, size: number): string[] {
  const problems: string[] = [];
  if (info.declaredEnd !== null && size < info.declaredEnd) {
    problems.push(`truncated: the superblock puts the end of the file at byte ${info.declaredEnd.toLocaleString("en-US")} but the file has ${size.toLocaleString("en-US")}`);
  }
  return problems;
}

// ---- Where the compressed chunks of a dataset are ----------------------------------------------------------------
//
// For the cold storage tier (services/recode.ts): the stored chunks of every chunked dataset whose only filters are DEFLATE,
// or the shuffle filter and then DEFLATE (what HEC-RAS and most NetCDF 4 writers use). Layout message version 3 with the
// version 1 chunk B-tree (what libhdf5 writes unless asked for the newest format); anything else is left out, and said so.

export type Hdf5Chunks = {
  path: string;
  /** Bytes in one element, and whether the shuffle filter was applied before DEFLATE. */
  elementSize: number;
  shuffled: boolean;
  /** Each stored chunk's stream, in order of the chunk's position in the dataset. */
  chunks: { offset: number; size: number }[];
};

const MAX_CHUNKS = 2_000_000;

/** The filter ids of a filter pipeline message (versions 1 and 2), or null when it cannot be read. */
function filterIds(d: Buffer): number[] | null {
  const version = d[0];
  if ((version !== 1 && version !== 2) || d.length < 2) return null;
  const n = d[1];
  let pos = version === 1 ? 8 : 2;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    if (pos + 4 > d.length) return null;
    const id = d.readUInt16LE(pos);
    pos += 2;
    let nameLength = 0;
    if (version === 1 || id >= 256) {
      nameLength = d.readUInt16LE(pos);
      pos += 2;
    }
    pos += 2; // flags
    if (pos + 2 > d.length) return null;
    const clients = d.readUInt16LE(pos);
    pos += 2;
    pos += version === 1 ? Math.ceil(nameLength / 8) * 8 : nameLength;
    pos += clients * 4;
    if (version === 1 && clients % 2 === 1) pos += 4;
    ids.push(id);
  }
  return ids;
}

export async function hdf5Chunks(read: Read, size: number): Promise<Hdf5Chunks[]> {
  const found: Hdf5Chunks[] = [];
  await readHdf5(read, size, {
    maxObjects: MAX_OBJECTS,
    onDataset: async (path, messages, c) => {
      try {
        const layout = messages.find((m) => m.type === 0x08);
        const pipeline = messages.find((m) => m.type === 0x0b);
        if (!layout || !pipeline || layout.data[0] !== 3 || layout.data[1] !== 2) return;
        const ids = filterIds(pipeline.data);
        const deflate = ids && ((ids.length === 1 && ids[0] === 1) || (ids.length === 2 && ids[0] === 2 && ids[1] === 1));
        if (!ids || !deflate) return;
        const d = layout.data;
        const dimensionality = d[2];
        if (dimensionality < 2 || dimensionality > 33) return;
        const tree = uint(d, 3, c.O);
        if (tree === UNDEF) return;
        const elementSize = d.readUInt32LE(3 + c.O + 4 * (dimensionality - 1));
        if (elementSize < 1 || elementSize > 8 || ![1, 2, 4, 8].includes(elementSize)) return;
        const keySize = 8 + 8 * dimensionality;
        const chunks: { offset: number; size: number; coords: number[] }[] = [];
        const stack = [tree];
        const seen = new Set<number>();
        while (stack.length) {
          const node = stack.pop()!;
          if (seen.has(node) || seen.size > 200_000) return;
          seen.add(node);
          const head = await c.src.bytes(addr(c, node), 8 + 2 * c.O);
          if (head.subarray(0, 4).toString("latin1") !== "TREE" || head[4] !== 1) return;
          const level = head[5];
          const used = head.readUInt16LE(6);
          const body = await c.src.bytes(addr(c, node) + 8 + 2 * c.O, used * (keySize + c.O) + keySize);
          for (let i = 0; i < used; i++) {
            const at = i * (keySize + c.O);
            const child = uint(body, at + keySize, c.O);
            if (child === UNDEF) return;
            if (level > 0) stack.push(child);
            else {
              const mask = body.readUInt32LE(at + 4);
              const coords: number[] = [];
              for (let k = 0; k < dimensionality; k++) coords.push(uint(body, at + 8 + 8 * k, 8));
              if (mask === 0) chunks.push({ offset: addr(c, child), size: body.readUInt32LE(at), coords });
              if (chunks.length > MAX_CHUNKS) return;
            }
          }
        }
        chunks.sort((a, b) => {
          for (let k = 0; k < a.coords.length; k++) if (a.coords[k] !== b.coords[k]) return a.coords[k] - b.coords[k];
          return 0;
        });
        if (chunks.length) found.push({ path, elementSize, shuffled: ids.length === 2, chunks: chunks.map((x) => ({ offset: x.offset, size: x.size })) });
      } catch (err) {
        if (!(err instanceof Hdf5Error)) throw err;
      }
    },
  });
  return found.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
