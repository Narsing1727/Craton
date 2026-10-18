// Finding the compressed chunks of HDF5 datasets, checked against libhdf5's own answer (h5py's chunk info), and making each
// of them again byte for byte, with and without the shuffle filter.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hdf5Chunks } from "../src/checks/hdf5.ts";
import { compressedSegments } from "../src/core/streams.ts";
import { findParams, inflateExact } from "../src/core/rezip.ts";

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name));
const reader = (b: Buffer) => async (offset: number, length: number) => b.subarray(offset, offset + length);

// What libhdf5 says (h5py: dataset.id.get_chunk_info), written once when the fixtures were made.
const TRUTH: Record<string, Record<string, [number, number][]>> = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "h5_truth.json"), "utf8"));

test("every chunk is found where libhdf5 says it is, in every dataset that qualifies", async () => {
  for (const name of Object.keys(TRUTH)) {
    const b = fixture(name);
    const found = await hdf5Chunks(reader(b), b.length);
    const expected = TRUTH[name];
    assert.deepEqual(found.map((d) => d.path).sort(), Object.keys(expected).sort(), name);
    for (const d of found) {
      assert.deepEqual(d.chunks.map((c) => [c.offset, c.size]).sort((x, y) => x[0] - y[0]), expected[d.path], `${name} ${d.path}`);
    }
  }
});

test("shuffle is recognised, and each chunk is a zlib stream that is made again exactly", async () => {
  const plain = fixture("h5_gzip_plain.h5");
  const shuffled = fixture("h5_gzip_shuffle.h5");
  assert.equal((await hdf5Chunks(reader(plain), plain.length))[0].shuffled, false);
  const [depth] = await hdf5Chunks(reader(shuffled), shuffled.length);
  assert.deepEqual([depth.shuffled, depth.elementSize, depth.chunks.length], [true, 4, 192]);
  for (const name of ["h5_gzip_plain.h5", "h5_gzip_shuffle.h5", "h5_two_datasets.h5"]) {
    const b = fixture(name);
    let params;
    for (const d of await hdf5Chunks(reader(b), b.length)) {
      for (const c of d.chunks.slice(0, 40)) {
        const stream = b.subarray(c.offset, c.offset + c.size);
        const raw = inflateExact(stream)!;
        const found = findParams(stream, raw, params);
        assert.ok(found, `${name} ${d.path} at ${c.offset}`);
        params = found!;
      }
    }
  }
});

test("through the generic finder: positions are sorted, streams do not overlap, and a TIFF still works", async () => {
  const b = fixture("h5_two_datasets.h5");
  const segs = (await compressedSegments(reader(b), b.length))!;
  assert.ok(segs.length > 200);
  for (let i = 1; i < segs.length; i++) assert.ok(segs[i].offset >= segs[i - 1].offset + segs[i - 1].count);
  assert.equal(new Set(segs.map((s) => s.image)).size, 2, "two datasets");
  assert.ok(segs.every((s) => s.shuffled === (s.sampleBytes === 4 && segs.find((x) => x.image === s.image)!.shuffled)));
  const tiff = fixture("deflate_tiled.tif");
  assert.equal((await compressedSegments(reader(tiff), tiff.length))!.length, 12);
});

test("a file that is not HDF5, or has nothing the tier understands, gives nothing", async () => {
  const text = Buffer.from("plain text, not HDF5 or TIFF");
  assert.deepEqual((await compressedSegments(reader(text), text.length)) ?? [], []);
  const damaged = Buffer.from(fixture("h5_gzip_shuffle.h5"));
  damaged.fill(0, 96, 200);
  assert.deepEqual(await compressedSegments(reader(damaged), damaged.length).catch(() => []) ?? [], []);
});
