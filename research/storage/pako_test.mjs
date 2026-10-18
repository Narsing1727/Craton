import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import pako from "pako";
for (const file of process.argv.slice(2)) {
  const b = readFileSync(file);
  const ifd = b.readUInt32LE(4), n = b.readUInt16LE(ifd), tags = {};
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + 12 * i, tag = b.readUInt16LE(e), typ = b.readUInt16LE(e + 2), cnt = b.readUInt32LE(e + 4);
    const size = (typ === 3 ? 2 : typ === 4 ? 4 : 1) * cnt, off = size <= 4 ? e + 8 : b.readUInt32LE(e + 8);
    tags[tag] = Array.from({ length: cnt }, (_, k) => (typ === 3 ? b.readUInt16LE(off + 2 * k) : b.readUInt32LE(off + 4 * k)));
  }
  const offs = tags[324] ?? tags[273], counts = tags[325] ?? tags[279];
  let same = 0; const t0 = Date.now(); let rawBytes = 0;
  for (let i = 0; i < offs.length; i++) {
    const s = b.subarray(offs[i], offs[i] + counts[i]);
    const raw = zlib.inflateSync(s); rawBytes += raw.length;
    if (Buffer.from(pako.deflate(raw, { level: 6, memLevel: 8 })).equals(s)) same++;
  }
  const ms = Date.now() - t0;
  console.log(`${file.split(/[\/]/).pop()}: pako 2.1.0 re-makes ${same}/${offs.length} (${ms} ms, ${(rawBytes / 1048576 / (ms / 1000)).toFixed(0)} MB/s of pixels)`);
}
