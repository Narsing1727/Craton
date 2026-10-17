// A chunk of a DEFLATE GeoTIFF kept as what it is made of (encoding 11). The chunk's bytes are cut out of the file wherever the
// chunker fell, so a chunk is the end of one compressed tile, some whole ones, and the start of another, with now and then a
// few bytes of the file's own directory. Stored as pieces, the tile parts are only a name and a range (the tile itself lives once,
// as pixels: core/tilepayload.ts) and the other bytes are kept as they are.
//
//   11, version(1), count u16, pieces[ 0 literal: length u32 | 1 tile: key(32), from u32, to u32 ], zstd(all literal bytes)
//
// `from` and `to` are positions inside the tile's original compressed stream. Decoding needs those streams, which the server
// makes again from the tile's pixels; it is never sent to a client in this form.

import zlib from "node:zlib";

export const PIECES = 11;
const VERSION = 1;
const MAX_PIECES = 4096;

export type Piece = { kind: "literal"; length: number } | { kind: "tile"; key: string; from: number; to: number };

export function encodePieces(pieces: Piece[], literals: Buffer): Buffer {
  if (!pieces.length || pieces.length > MAX_PIECES) throw new Error("Too many pieces");
  const parts: Buffer[] = [Buffer.from([PIECES, VERSION, pieces.length & 255, pieces.length >> 8])];
  for (const p of pieces) {
    if (p.kind === "literal") {
      const b = Buffer.alloc(5);
      b.writeUInt32LE(p.length, 1);
      parts.push(b);
    } else {
      const b = Buffer.alloc(41);
      b[0] = 1;
      Buffer.from(p.key, "hex").copy(b, 1);
      b.writeUInt32LE(p.from, 33);
      b.writeUInt32LE(p.to, 37);
      parts.push(b);
    }
  }
  if (literals.length) parts.push(zlib.zstdCompressSync(literals, { params: { [zlib.constants.ZSTD_c_compressionLevel]: 3 } }));
  return Buffer.concat(parts);
}

export const isPieces = (stored: Buffer) => stored[0] === PIECES;

/** What a stored chunk is made of, and where its literal bytes begin. */
export function piecesOf(stored: Buffer): { pieces: Piece[]; literalsAt: number } {
  if (stored[0] !== PIECES || stored.length < 4) throw new Error("Not a chunk of pieces");
  if (stored[1] !== VERSION) throw new Error(`Unknown pieces version ${stored[1]}`);
  const count = stored[2] | (stored[3] << 8);
  if (count < 1 || count > MAX_PIECES) throw new Error("Damaged chunk of pieces");
  const pieces: Piece[] = [];
  let at = 4;
  for (let i = 0; i < count; i++) {
    if (at >= stored.length) throw new Error("Damaged chunk of pieces");
    if (stored[at] === 0) {
      if (at + 5 > stored.length) throw new Error("Damaged chunk of pieces");
      pieces.push({ kind: "literal", length: stored.readUInt32LE(at + 1) });
      at += 5;
    } else if (stored[at] === 1) {
      if (at + 41 > stored.length) throw new Error("Damaged chunk of pieces");
      pieces.push({ kind: "tile", key: stored.subarray(at + 1, at + 33).toString("hex"), from: stored.readUInt32LE(at + 33), to: stored.readUInt32LE(at + 37) });
      at += 41;
    } else throw new Error("Damaged chunk of pieces");
  }
  return { pieces, literalsAt: at };
}

/** The tiles a stored chunk needs. */
export const tileKeysOf = (stored: Buffer) => [...new Set(piecesOf(stored).pieces.flatMap((p) => (p.kind === "tile" ? [p.key] : [])))];

/** Put the chunk back together. `stream` gives a tile's original compressed stream. */
export async function decodePieces(stored: Buffer, stream: (key: string) => Promise<Buffer>, maxLength?: number): Promise<Buffer> {
  const { pieces, literalsAt } = piecesOf(stored);
  const literalTotal = pieces.reduce((n, p) => n + (p.kind === "literal" ? p.length : 0), 0);
  if (maxLength !== undefined && pieces.reduce((n, p) => n + (p.kind === "literal" ? p.length : p.to - p.from), 0) > maxLength) throw new Error("Chunk is larger than allowed.");
  const literals = literalTotal ? zlib.zstdDecompressSync(stored.subarray(literalsAt), { maxOutputLength: literalTotal }) : Buffer.alloc(0);
  if (literals.length !== literalTotal) throw new Error("Damaged chunk of pieces");
  const out: Buffer[] = [];
  let lit = 0;
  for (const p of pieces) {
    if (p.kind === "literal") {
      out.push(literals.subarray(lit, lit + p.length));
      lit += p.length;
    } else {
      const s = await stream(p.key);
      if (p.from > p.to || p.to > s.length) throw new Error("Damaged chunk of pieces");
      out.push(s.subarray(p.from, p.to));
    }
  }
  return Buffer.concat(out);
}
