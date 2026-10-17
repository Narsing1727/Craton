import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkBuffer, chunkStream, sha256Hex } from "../src/core/fastcdc.ts";
import { compressChunk, decompressChunk } from "../src/core/compress.ts";
import { leafHash, merkleProof, merkleRoot, verifyProof } from "../src/core/merkle.ts";
import { canonicalJson, diffTrees, makeTree, objectId } from "../src/core/objects.ts";
import { noiseBytes } from "../src/dev/fixtures.ts";

const opts = { min: 32 * 1024, avg: 128 * 1024, max: 512 * 1024 };

test("chunks stay within min/max and cover the whole buffer", () => {
  const data = noiseBytes(8 * 1024 * 1024, 1);
  const spans = chunkBuffer(data, opts);
  assert.equal(spans.reduce((n, s) => n + s.length, 0), data.length);
  spans.slice(0, -1).forEach((s) => {
    assert.ok(s.length >= opts.min && s.length <= opts.max, `chunk of ${s.length} bytes`);
  });
  const avg = data.length / spans.length;
  assert.ok(avg > 64 * 1024 && avg < 256 * 1024, `average ${Math.round(avg)} should be near 128 KB`);
});

test("inserting bytes near the start keeps almost every later chunk identical", () => {
  const data = noiseBytes(6 * 1024 * 1024, 2);
  const edited = Buffer.concat([data.subarray(0, 1000), Buffer.from("inserted by a re-survey"), data.subarray(1000)]);
  const a = new Set(chunkBuffer(data, opts).map((s) => sha256Hex(data.subarray(s.offset, s.offset + s.length))));
  const bSpans = chunkBuffer(edited, opts);
  const b = bSpans.map((s) => sha256Hex(edited.subarray(s.offset, s.offset + s.length)));
  const shared = b.filter((h) => a.has(h)).length;
  assert.ok(shared >= b.length - 2, `${shared} of ${b.length} chunks reused`);
});

test("streaming and in-memory chunking cut at the same places", async () => {
  const data = noiseBytes(3 * 1024 * 1024 + 123, 3);
  const expected = chunkBuffer(data, opts).map((s) => `${s.offset}:${s.length}`);
  async function* pieces() {
    for (let i = 0; i < data.length; i += 77_777) yield data.subarray(i, i + 77_777);
  }
  const got: string[] = [];
  for await (const c of chunkStream(pieces(), opts)) got.push(`${c.offset}:${c.length}`);
  assert.deepEqual(got, expected);
});

test("compression is lossless and falls back to raw for incompressible data", () => {
  const text = Buffer.from("elevation,1.0\n".repeat(20_000));
  const packed = compressChunk(text, sha256Hex(text));
  assert.equal(packed.codec, "zstd");
  assert.ok(packed.stored.length < text.length / 5);
  assert.ok(decompressChunk(packed.stored).equals(text));
  const noise = noiseBytes(200_000, 4);
  const raw = compressChunk(noise, sha256Hex(noise));
  assert.equal(raw.codec, "none");
  assert.ok(decompressChunk(raw.stored).equals(noise));
  assert.throws(() => compressChunk(text, sha256Hex("something else")), /Lossless check failed/);
});

test("Merkle proofs verify for every leaf and reject tampering", () => {
  for (let n = 1; n <= 17; n++) {
    const leaves = Array.from({ length: n }, (_, i) => leafHash(`file-${i}.tif`, sha256Hex(`blob-${i}`)));
    const root = merkleRoot(leaves);
    for (let i = 0; i < n; i++) assert.ok(verifyProof(leaves[i], merkleProof(leaves, i), root), `n=${n} i=${i}`);
    if (n > 1) assert.equal(verifyProof(leafHash("forged.tif", sha256Hex("x")), merkleProof(leaves, 0), root), false);
  }
});

test("object ids don't depend on key order, and trees diff by path", () => {
  const a = { type: "blob" as const, size: 3, sha256: sha256Hex("abc"), chunks: [{ hash: sha256Hex("abc"), size: 3 }] };
  const b = { chunks: [{ size: 3, hash: sha256Hex("abc") }], sha256: sha256Hex("abc"), size: 3, type: "blob" as const };
  assert.equal(objectId(a), objectId(b));
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }), '{"a":[2,{"c":4,"d":3}],"b":1}');
  const t1 = makeTree([{ path: "a.tif", blob: "1", size: 1 }, { path: "b.shp", blob: "2", size: 1 }]);
  const t2 = makeTree([{ path: "a.tif", blob: "9", size: 1 }, { path: "c.csv", blob: "3", size: 1 }]);
  assert.deepEqual(diffTrees(t1, t2).map((c) => `${c.change}:${c.path}`), ["modified:a.tif", "removed:b.shp", "added:c.csv"]);
});
