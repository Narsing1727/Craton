// Does Node's own zlib (the one the Craton server would use) re-make GDAL's DEFLATE tiles bit for bit?
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
const file = process.argv[2];
const b = readFileSync(file);
const ifd = b.readUInt32LE(4), n = b.readUInt16LE(ifd);
const tags = {};
for (let i = 0; i < n; i++) {
  const e = ifd + 2 + 12 * i, tag = b.readUInt16LE(e), typ = b.readUInt16LE(e + 2), cnt = b.readUInt32LE(e + 4);
  const size = (typ === 3 ? 2 : typ === 4 ? 4 : 1) * cnt, off = size <= 4 ? e + 8 : b.readUInt32LE(e + 8);
  tags[tag] = Array.from({ length: cnt }, (_, k) => (typ === 3 ? b.readUInt16LE(off + 2 * k) : b.readUInt32LE(off + 4 * k)));
}
const offs = tags[324] ?? tags[273], counts = tags[325] ?? tags[279];
let same = 0;
const t0 = Date.now();
for (let i = 0; i < offs.length; i++) {
  const s = b.subarray(offs[i], offs[i] + counts[i]);
  const raw = zlib.inflateSync(s);
  if (zlib.deflateSync(raw, { level: 6, memLevel: 8 }).equals(s)) same++;
}
console.log(`${file.split(/[\/]/).pop()}: Node ${process.versions.node} zlib ${process.versions.zlib} re-makes ${same}/${offs.length} tiles bit for bit (${Date.now() - t0} ms)`);
