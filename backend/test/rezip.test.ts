// Finding the compressed tiles of a TIFF, and making each of them again byte for byte from its pixels, on files written by GDAL.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { deflateSegments, type ReadAt } from "../src/core/tiff.ts";
import { deflateWith, findParams, inflateExact, type DeflateParams } from "../src/core/rezip.ts";

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name));
const reader = (b: Buffer): ReadAt => async (offset, length) => b.subarray(offset, offset + length);

test("the tiles of a tiled GeoTIFF are found where the file says they are", async () => {
  const b = fixture("deflate_tiled.tif");
  const segs = (await deflateSegments(reader(b), b.length))!;
  assert.equal(segs.length, 12, "512 x 384 in 128 x 128 tiles");
  assert.deepEqual([...new Set(segs.map((s) => s.image))], [0]);
  assert.deepEqual(segs.map((s) => s.index), [...Array(12).keys()].sort((x, y) => segs.find((s) => s.index === x)!.offset - segs.find((s) => s.index === y)!.offset), "sorted by position");
  assert.equal(segs[0].sampleBytes, 4);
  assert.equal(segs[0].predictor, 1);
  for (const s of segs) assert.ok(inflateExact(b.subarray(s.offset, s.offset + s.count)), `tile ${s.index} is one whole zlib stream`);
});

test("strips are found too, and so is the predictor", async () => {
  const strips = fixture("deflate_strips.tif");
  assert.equal((await deflateSegments(reader(strips), strips.length))!.length, 24);
  const predicted = fixture("deflate_predictor3.tif");
  const segs = (await deflateSegments(reader(predicted), predicted.length))!;
  assert.equal(segs.length, 12);
  assert.equal(segs[0].predictor, 3);
});

test("every tile and strip GDAL wrote is rebuilt exactly, with the same settings throughout a file", async () => {
  for (const name of ["deflate_tiled.tif", "deflate_tiled_shifted.tif", "deflate_tiled_edit.tif", "deflate_strips.tif", "deflate_predictor3.tif"]) {
    const b = fixture(name);
    let params: DeflateParams | undefined;
    for (const s of (await deflateSegments(reader(b), b.length))!) {
      const stream = b.subarray(s.offset, s.offset + s.count);
      const raw = inflateExact(stream)!;
      const found = findParams(stream, raw, params);
      assert.ok(found, `${name} tile ${s.index}`);
      params = found!;
      assert.ok(deflateWith(raw, found!).equals(stream));
    }
    assert.deepEqual(params, { level: 6, memLevel: 8, strategy: 0 }, `${name}: GDAL's default zlib settings`);
  }
});

test("a stream written with other settings is not claimed to be reproducible, and one that is not zlib is refused", () => {
  const b = fixture("deflate_tiled.tif");
  const raw = Buffer.alloc(200_000, 7);
  for (let i = 0; i < raw.length; i += 3) raw[i] = i & 255;
  const other = deflateWith(raw, { level: 1, memLevel: 8, strategy: 0 });
  assert.equal(findParams(other, raw, { level: 6, memLevel: 8, strategy: 0 }, 1), null, "level 6 is not what level 1 wrote");
  assert.ok(findParams(other, raw), "but the header points the search at level 1");
  assert.equal(inflateExact(Buffer.from("not a zlib stream at all")), null);
  const stream = b.subarray(0, 0);
  assert.equal(inflateExact(stream), null);
  const twice = Buffer.concat([deflateWith(raw, { level: 6, memLevel: 8, strategy: 0 }), Buffer.from([1, 2, 3])]);
  assert.ok(inflateExact(twice) === null || findParams(twice, raw) === null, "bytes after the end of the stream are never glossed over");
});

test("things that are not DEFLATE TIFFs give nothing", async () => {
  const text = Buffer.from("just some text, not a TIFF at all, certainly");
  assert.equal(await deflateSegments(reader(text), text.length), null);
  const damaged = Buffer.from(fixture("deflate_tiled.tif"));
  damaged.writeUInt32LE(damaged.length + 100, 4); // the first directory points outside the file
  assert.deepEqual((await deflateSegments(reader(damaged), damaged.length)) ?? [], [], "nothing is trusted");
});

test("a stream that claims to expand to more than a tile can is refused, not inflated", async () => {
  const { MAX_INFLATED } = await import("../src/core/rezip.ts");
  const zlibNode = (await import("node:zlib")).default;
  const small = zlibNode.deflateSync(Buffer.alloc(1024 * 1024, 5));
  assert.equal(inflateExact(small)!.length, 1024 * 1024, "an ordinary tile is fine");
  const bomb = zlibNode.deflateSync(Buffer.alloc(MAX_INFLATED + 1024 * 1024, 0));
  assert.ok(bomb.length < 400 * 1024, `the stream itself is only ${bomb.length} bytes`);
  assert.equal(inflateExact(bomb), null, "but it would fill the server's memory, so it is left as uploaded");
});
