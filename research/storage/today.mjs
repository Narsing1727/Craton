// What Craton stores today, with its own chunker and codecs: the first version in full, then each edited version
// as the chunks it does not share with the first.
import { readFileSync } from "node:fs";
import { chunkBuffer, sha256Hex } from "file:///D:/Desktop/leetcode/Craton/backend/src/core/fastcdc.ts";
import { compressChunk } from "file:///D:/Desktop/leetcode/Craton/backend/src/core/compress.ts";
import { tiffHint } from "file:///D:/Desktop/leetcode/Craton/backend/src/core/profile.ts";
const OPTS = { min: 32 * 1024, avg: 128 * 1024, max: 512 * 1024 };
function store(file, known) {
  const buf = readFileSync(file);
  const hint = tiffHint((o, l) => (o + l <= buf.length ? buf.subarray(o, o + l) : null)) ?? { kind: "auto" };
  let newBytes = 0, stored = 0, chunks = 0, shared = 0;
  for (const s of chunkBuffer(buf, OPTS)) {
    const data = buf.subarray(s.offset, s.offset + s.length);
    const h = sha256Hex(data);
    chunks++;
    if (known.has(h)) { shared++; continue; }
    known.add(h);
    newBytes += data.length;
    stored += compressChunk(Buffer.from(data), h, hint).stored.length;
  }
  return { file, size: buf.length, hint: hint.kind, chunks, shared, newBytes, stored };
}
const mb = (n) => (n / 1048576).toFixed(2) + " MB";
const base = new Set();
const first = store("v0.tif", base);
console.log(`v0.tif ${mb(first.size)} hint=${first.hint}: stored ${mb(first.stored)} (${first.chunks} chunks)`);
for (const f of ["v1_levee.tif", "v2_datum.tif", "v3_recal.tif"]) {
  const known = new Set(base);
  const r = store(f, known);
  console.log(`${f}: shares ${r.shared}/${r.chunks} chunks; new ${mb(r.newBytes)}, stored ${mb(r.stored)}`);
}
const raw = store("v0.f32", new Set());
console.log(`raw grid (uncompressed float32, numeric hint by name? ${raw.hint}): ${mb(raw.size)} -> stored ${mb(raw.stored)}`);
