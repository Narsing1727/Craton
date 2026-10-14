// How a file's bytes are encoded depends on what the file is; a wrong guess may cost compression but never correctness.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { compressChunk, decompressChunk, codecOf } from "../src/core/compress.ts";
import { hintForPath, tiffHint } from "../src/core/profile.ts";

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** A minimal little-endian classic TIFF header + one directory with the given SHORT tags. */
function tiff(tags: Record<number, number>): Buffer {
  const entries = Object.entries(tags).map(([t, v]) => [Number(t), v] as const).sort((a, b) => a[0] - b[0]);
  const buf = Buffer.alloc(8 + 2 + entries.length * 12 + 4);
  buf.write("II", 0, "latin1");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(8, 4);
  buf.writeUInt16LE(entries.length, 8);
  entries.forEach(([tag, value], i) => {
    const o = 10 + i * 12;
    buf.writeUInt16LE(tag, o);
    buf.writeUInt16LE(3, o + 2); // SHORT
    buf.writeUInt32LE(1, o + 4);
    buf.writeUInt16LE(value, o + 8);
  });
  return buf;
}
const reader = (b: Buffer) => (offset: number, length: number) => (offset >= b.length ? null : b.subarray(offset, offset + length));

test("names decide the obvious cases", () => {
  assert.deepEqual(hintForPath("points/survey.laz"), { kind: "incompressible" });
  assert.deepEqual(hintForPath("photos/site.JPG"), { kind: "incompressible" });
  assert.deepEqual(hintForPath("model/Muncie.p04"), { kind: "text" });
  assert.deepEqual(hintForPath("model/Muncie.g01"), { kind: "text" });
  assert.deepEqual(hintForPath("gauges.csv"), { kind: "text" });
  assert.deepEqual(hintForPath("srtm/N30E078.hgt"), { kind: "numeric", width: 2, bigEndian: true });
  assert.deepEqual(hintForPath("terrain/dem.tif"), { kind: "auto" });
  assert.deepEqual(hintForPath("model/Muncie.p04.hdf"), { kind: "auto" });
});

test("a TIFF header tells uncompressed rasters (shuffle) from compressed ones (leave alone)", () => {
  assert.deepEqual(tiffHint(reader(tiff({ 259: 1, 258: 32 }))), { kind: "numeric", width: 4, bigEndian: false });
  assert.deepEqual(tiffHint(reader(tiff({ 259: 1, 258: 16 }))), { kind: "numeric", width: 2, bigEndian: false });
  assert.deepEqual(tiffHint(reader(tiff({ 258: 64 }))), { kind: "numeric", width: 8, bigEndian: false }, "no compression tag means none");
  assert.deepEqual(tiffHint(reader(tiff({ 259: 8, 258: 32 }))), { kind: "incompressible" }, "deflate");
  assert.deepEqual(tiffHint(reader(tiff({ 259: 5, 258: 8 }))), { kind: "incompressible" }, "LZW");
  assert.deepEqual(tiffHint(reader(tiff({ 259: 7 }))), { kind: "incompressible" }, "JPEG");
  assert.deepEqual(tiffHint(reader(tiff({ 259: 32773, 258: 8 }))), { kind: "auto" }, "PackBits is weak, so there is something to gain");
  assert.deepEqual(tiffHint(reader(tiff({ 259: 1, 258: 8 }))), { kind: "auto" });
});

test("something that is not a TIFF, or is cut off, is not guessed at", () => {
  assert.equal(tiffHint(reader(Buffer.from("not a tiff at all, just text"))), null);
  assert.equal(tiffHint(reader(Buffer.alloc(3))), null);
  const cut = tiff({ 259: 1, 258: 32 }).subarray(0, 12);
  assert.equal(tiffHint(reader(cut)), null);
});

test("every hint round-trips exactly, and the chosen encodings are the intended ones", () => {
  const floats = Buffer.alloc(128 * 1024);
  for (let i = 0; i < floats.length / 4; i++) floats.writeFloatLE(250 + Math.sin(i / 500) * 20 + i * 0.0005, i * 4);
  const noise = randomBytes(20000);
  const text = Buffer.from("a,b,c" + String.fromCharCode(10) + "1,2,3".repeat(4000));
  for (const [name, data] of [["floats", floats], ["noise", noise], ["text", text], ["empty", Buffer.alloc(0)], ["tiny", Buffer.from("x")]] as const) {
    for (const hint of [{ kind: "auto" }, { kind: "text" }, { kind: "incompressible" }, { kind: "numeric", width: 2 }, { kind: "numeric", width: 4 }, { kind: "numeric", width: 8 }] as const) {
      const r = compressChunk(Buffer.from(data), sha(data), hint);
      assert.ok(decompressChunk(r.stored).equals(data), `${name} / ${JSON.stringify(hint)}`);
      assert.equal(codecOf(r.stored), r.codec);
    }
  }
  assert.match(compressChunk(floats, sha(floats), { kind: "numeric", width: 4 }).codec, /shuffle4/);
  assert.equal(compressChunk(floats, sha(floats), { kind: "incompressible" }).codec, "none");
  assert.equal(compressChunk(noise, sha(noise), { kind: "auto" }).codec, "none");
  // Unlabelled float data still finds the shuffle by itself.
  const auto = compressChunk(floats, sha(floats), { kind: "auto" });
  const plain = compressChunk(floats, sha(floats), { kind: "text" });
  assert.ok(auto.stored.length <= plain.stored.length, "auto is never worse than plain zstd here");
});

test("delta and shuffle round-trip exactly for both element widths and byte orders, with wrapping values", async () => {
  const { deltaEncode, deltaDecode } = await import("../src/core/compress.ts");
  for (const width of [2, 4] as const) {
    for (const bigEndian of [false, true]) {
      for (const len of [0, 1, width, width + 1, 1000, 4099]) {
        const buf = randomBytes(len);
        assert.deepEqual(deltaDecode(deltaEncode(buf, width, bigEndian), width, bigEndian), buf, `width ${width} be ${bigEndian} length ${len}`);
      }
    }
  }
  // Values that make the subtraction wrap.
  const wrap = Buffer.from([0, 0, 0, 0, 255, 255, 255, 255, 0, 0, 0, 0, 1, 0, 0, 0]);
  assert.deepEqual(deltaDecode(deltaEncode(wrap, 4, false), 4, false), wrap);
});

test("a smooth raster picks the delta encoding, a big-endian one too, and a decoder needs no hint", () => {
  const make = (be: boolean) => {
    const b = Buffer.alloc(64 * 1024);
    for (let i = 0; i < b.length / 4; i++) {
      const v = 300 + Math.sin(i / 700) * 40 + i * 0.002;
      if (be) b.writeFloatBE(v, i * 4);
      else b.writeFloatLE(v, i * 4);
    }
    return b;
  };
  for (const be of [false, true]) {
    const data = make(be);
    const r = compressChunk(data, sha(data), { kind: "numeric", width: 4, bigEndian: be });
    assert.equal(r.codec, be ? "delta4be+shuffle4+zstd" : "delta4+shuffle4+zstd");
    assert.ok(decompressChunk(r.stored).equals(data));
  }
});
