// The staging cache: loose and packed chunks read the same, survive a new process, and clear completely.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PendingChunks } from "../src/cli/pending.ts";
import { sha256Hex } from "../src/core/fastcdc.ts";

const chunk = (n: number) => {
  const data = Buffer.alloc(300 + n, n % 251);
  return { hash: sha256Hex(data), data };
};

test("packed chunks are found after a flush, by a fresh reader, and in few files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-pending-"));
  try {
    const writer = new PendingChunks(dir, "pending", { packed: true });
    const all = Array.from({ length: 200 }, (_, i) => chunk(i));
    for (const c of all) writer.put(c.hash, c.data);
    assert.equal(writer.get(all[7].hash)?.equals(all[7].data), true, "readable before the flush, from memory");
    writer.flush();
    const files = fs.readdirSync(path.join(dir, "pending"));
    assert.equal(files.length, 2, `one pack and its index, not ${files.length} files`);

    const reader = new PendingChunks(dir);
    assert.ok(all.every((c) => reader.has(c.hash)));
    assert.ok(all.every((c) => reader.get(c.hash)!.equals(c.data)));
    assert.equal(reader.get("0".repeat(64)), null);
    assert.ok(reader.sizeOnDisk() > 0);

    reader.clear();
    assert.equal(fs.existsSync(path.join(dir, "pending")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loose chunks still work beside packs, and a repeated put writes nothing new", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-pending-"));
  try {
    const loose = new PendingChunks(dir);
    const a = chunk(1), b = chunk(2);
    loose.put(a.hash, a.data);
    const packed = new PendingChunks(dir, "pending", { packed: true });
    packed.put(b.hash, b.data);
    packed.put(a.hash, a.data); // already loose: not written again
    packed.flush();
    const reader = new PendingChunks(dir);
    assert.equal(reader.get(a.hash)!.equals(a.data), true);
    assert.equal(reader.get(b.hash)!.equals(b.data), true);
    const packFiles = fs.readdirSync(path.join(dir, "pending")).filter((f) => f.endsWith(".bin"));
    assert.equal(packFiles.length, 1);
    assert.equal(fs.statSync(path.join(dir, "pending", packFiles[0])).size < a.data.length + b.data.length, true, "stored compressed, one chunk only");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a pack with no index is ignored, never half-read", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-pending-"));
  try {
    fs.mkdirSync(path.join(dir, "pending"));
    fs.writeFileSync(path.join(dir, "pending", "pack-x.bin"), Buffer.from("garbage"));
    const c = chunk(3);
    assert.equal(new PendingChunks(dir).get(c.hash), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("check finds a missing or truncated pack, and names an unused one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-pending-"));
  try {
    const w = new PendingChunks(dir, "pending", { packed: true });
    const cs = [chunk(10), chunk(11)];
    for (const c of cs) w.put(c.hash, c.data);
    w.flush();
    const sound = new PendingChunks(dir).check(true);
    assert.deepEqual([sound.chunks, sound.packs, sound.problems, sound.orphans], [2, 1, [], []]);

    fs.writeFileSync(path.join(dir, "pending", "pack-unused.bin"), "x");
    assert.deepEqual(new PendingChunks(dir).check(false).orphans, ["pack-unused.bin"]);

    const bin = fs.readdirSync(path.join(dir, "pending")).find((f) => f.startsWith("pack-") && f.endsWith(".bin") && f !== "pack-unused.bin")!;
    fs.truncateSync(path.join(dir, "pending", bin), 5);
    const broken = new PendingChunks(dir).check(false);
    assert.equal(broken.problems.length >= 1, true);
    assert.match(broken.problems[0], /missing or too short/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
