// Cloud Optimized GeoTIFF layout check: tiling, overviews and directories-before-data, from synthetic TIFFs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { cogProblems, readCogLayout } from "../src/checks/cog.ts";

type Image = { width: number; height: number; tiled: boolean; reduced?: boolean };

/**
 * A little-endian classic TIFF with one directory per image, each with one tile or strip of 8 bytes of data.
 * `cog` puts the directories first and the data after them (the COG layout); otherwise the data comes first and
 * the directories are written after it, as GDAL does for an ordinary GeoTIFF.
 */
function build(images: Image[], cog: boolean): Buffer {
  const tagCount = (img: Image) => (img.reduced ? 7 : 6);
  const dirSize = (img: Image) => 2 + tagCount(img) * 12 + 4;
  const header = 8;
  const dirsTotal = images.reduce((n, i) => n + dirSize(i), 0);
  const dataSize = 8;
  const buf = Buffer.alloc(header + dirsTotal + dataSize * images.length);
  const dirStart = cog ? header : header + dataSize * images.length;
  const dataStart = cog ? header + dirsTotal : header;
  buf.write("II", 0, "latin1");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(dirStart, 4);
  let at = dirStart;
  images.forEach((img, i) => {
    const entries: [number, number, number][] = [
      [256, 4, img.width],
      [257, 4, img.height],
      [259, 3, 1],
      img.tiled ? [322, 4, 256] : [278, 4, img.height],
      img.tiled ? [324, 4, dataStart + i * dataSize] : [273, 4, dataStart + i * dataSize],
      img.tiled ? [323, 4, 256] : [279, 4, dataSize],
    ];
    if (img.reduced) entries.unshift([254, 4, 1]);
    entries.sort((a, b) => a[0] - b[0]);
    buf.writeUInt16LE(entries.length, at);
    entries.forEach(([tag, type, value], k) => {
      const o = at + 2 + k * 12;
      buf.writeUInt16LE(tag, o);
      buf.writeUInt16LE(type, o + 2);
      buf.writeUInt32LE(1, o + 4);
      buf.writeUInt32LE(value, o + 8);
    });
    const nextAt = at + dirSize(img);
    buf.writeUInt32LE(i < images.length - 1 ? nextAt : 0, at + 2 + entries.length * 12);
    at = nextAt;
  });
  return buf;
}

const reader = (b: Buffer) => async (offset: number, length: number) => b.subarray(offset, Math.min(b.length, offset + length));
const check = async (b: Buffer) => cogProblems(await readCogLayout(reader(b), b.length));

test("a tiled image with overviews and its directories first is a COG", async () => {
  const b = build([{ width: 4096, height: 4096, tiled: true }, { width: 2048, height: 2048, tiled: true, reduced: true }, { width: 1024, height: 1024, tiled: true, reduced: true }], true);
  assert.deepEqual(await check(b), []);
  const layout = await readCogLayout(reader(b), b.length);
  assert.equal(layout.directories.length, 3);
  assert.deepEqual(layout.directories.map((d) => d.reduced), [false, true, true]);
});

test("a small tiled image needs no overviews", async () => {
  assert.deepEqual(await check(build([{ width: 400, height: 300, tiled: true }], true)), []);
});

test("strips instead of tiles, a big image without overviews, and data before directories are each named", async () => {
  assert.deepEqual(await check(build([{ width: 300, height: 300, tiled: false }], true)), ["stored in strips, not tiles"]);
  assert.deepEqual(await check(build([{ width: 4096, height: 2048, tiled: true }], true)), ["4096×2048 pixels with no overviews"]);
  const dataFirst = await check(build([{ width: 300, height: 300, tiled: true }], false));
  assert.equal(dataFirst.length, 1);
  assert.match(dataFirst[0], /image data comes before the directories/);
});

test("everything wrong at once is reported together", async () => {
  const problems = await check(build([{ width: 5000, height: 5000, tiled: false }], false));
  assert.equal(problems.length, 3);
});

test("something that is not a TIFF throws, and a directory loop does not hang", async () => {
  await assert.rejects(readCogLayout(reader(Buffer.from("not a tiff, just text....")), 24), /Not a TIFF/);
  const b = build([{ width: 100, height: 100, tiled: true }], true);
  b.writeUInt32LE(8, 8 + 2 + 6 * 12); // the only directory points back at itself
  const layout = await readCogLayout(reader(b), b.length);
  assert.equal(layout.directories.length, 1);
});
