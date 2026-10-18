// A chunk stored as its difference from the previous version's bytes: it decodes to exactly the original whatever the
// alignment, length or element width, whichever way of differencing wins, and whether or not the old file was shorter.

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { decodeRefDelta, encodeRefDelta, isRefDelta, refDeltaInfo, type RefSlice } from "../src/core/refdelta.ts";

const slice: RefSlice[] = [{ hash: "ab".repeat(32), from: 0, to: 1 }];

function smoothGrid(count: number, seed = 1) {
  const f = new Float32Array(count);
  for (let i = 0; i < count; i++) f[i] = 300 + 40 * Math.sin(i / 900 + seed) + (i % 7) * 0.01;
  return Buffer.from(f.buffer);
}

test("it round-trips at every alignment and element width, in both modes of differencing", () => {
  for (const width of [2, 4, 8] as const) {
    for (const offset of [0, 1, 2, 3, 5, 7, 4096 + 3]) {
      for (const length of [64, 65, 1000, 4099]) {
        const old = smoothGrid(4200, 1).subarray(0, length);
        const next = Buffer.from(old);
        for (let i = 0; i < next.length; i += 5) next[i] = (next[i] + 1) & 255; // something changed everywhere
        const stored = encodeRefDelta(next, old, slice, width, offset, Number.MAX_SAFE_INTEGER)!;
        assert.ok(stored && isRefDelta(stored), `w${width} o${offset} l${length}`);
        const info = refDeltaInfo(stored);
        assert.deepEqual([info.width, info.length, info.phase], [width, length, (width - (offset % width)) % width]);
        assert.ok(decodeRefDelta(stored, old).equals(next), `w${width} o${offset} l${length}`);
      }
    }
  }
});

test("a datum shift (every value moved by 0.25) becomes a few percent of its size", () => {
  const old = smoothGrid(32768);
  const next = Buffer.from(new Float32Array(old.buffer, old.byteOffset, 32768).map((v) => v + 0.25).buffer);
  const stored = encodeRefDelta(next, old, slice, 4, 0, Number.MAX_SAFE_INTEGER)!;
  assert.ok(stored.length < next.length * 0.05, `${stored.length} of ${next.length}`);
  assert.ok(decodeRefDelta(stored, old).equals(next));
});

test("a shorter old file is read as zeros past its end, and an unrelated chunk is refused as not worth it", () => {
  const next = smoothGrid(2000);
  const old = next.subarray(0, 3000);
  const stored = encodeRefDelta(next, old, slice, 4, 0, Number.MAX_SAFE_INTEGER)!;
  assert.ok(decodeRefDelta(stored, old).equals(next));
  const noise = randomBytes(8192);
  assert.equal(encodeRefDelta(noise, randomBytes(8192), slice, 4, 0, noise.length), null, "random bytes do not shrink");
  assert.equal(encodeRefDelta(noise, noise, [], 4, 0, 1e9), null, "no references, no difference");
});

test("damaged or oversized input is refused, never decoded into something else", () => {
  const old = smoothGrid(1000);
  const next = Buffer.from(old);
  next[100] ^= 1;
  const stored = encodeRefDelta(next, old, slice, 4, 0, 1e9)!;
  assert.throws(() => decodeRefDelta(stored, old, 100), /larger than allowed/);
  const bad = Buffer.from(stored);
  bad[3] = 3;
  assert.throws(() => refDeltaInfo(bad), /Damaged/);
  assert.throws(() => refDeltaInfo(Buffer.from([1, 2, 3])), /Not a stored difference/);
});
