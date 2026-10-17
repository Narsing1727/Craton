// A point cloud re-saved after reclassifying some points, or shifted vertically, or with a longer header, is stored as its difference
// from the earlier version, record by record, and every way of reading it still gives exactly what was uploaded.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { FsStore } from "../src/storage/fs-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { findRepo } from "../src/services/repos.ts";
import { repackCommit, verifyDifferences } from "../src/services/repack.ts";
import { getStoredChunk } from "../src/services/chunks.ts";
import { decompressChunk } from "../src/core/compress.ts";
import { decodeRefDelta, encodeRecordDelta, refDeltaInfo } from "../src/core/refdelta.ts";
import { sha256Hex } from "../src/core/fastcdc.ts";
import { getObject } from "../src/services/history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../src/core/objects.ts";

const W = 34; // point format 3: X Y Z, intensity, flags, class, angle, user data, source id, GPS time, red green blue

/** An uncompressed LAS 1.2 file: a 227-byte header, optionally a VLR, then `points` records along a flight line. */
function las(points: number, o: { reclassify?: number; shiftZ?: number; vlr?: number; seed?: number } = {}): Buffer {
  const vlr = o.vlr ? Buffer.alloc(54 + o.vlr, 7) : Buffer.alloc(0);
  const start = 227 + vlr.length;
  const buf = Buffer.alloc(start + points * W);
  buf.write("LASF", 0, "latin1");
  buf[24] = 1;
  buf[25] = 2;
  buf.writeUInt16LE(227, 94);
  buf.writeUInt32LE(start, 96);
  buf.writeUInt32LE(vlr.length ? 1 : 0, 100);
  buf[104] = 3;
  buf.writeUInt16LE(W, 105);
  buf.writeUInt32LE(points, 107);
  vlr.copy(buf, 227);
  let s = (o.seed ?? 1) >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < points; i++) {
    const at = start + i * W;
    buf.writeInt32LE(50_000_000 + Math.round(i * 37 + rnd() * 400), at);
    buf.writeInt32LE(120_000_000 + Math.round(Math.sin(i / 900) * 90_000 + rnd() * 300), at + 4);
    buf.writeInt32LE(30_000 + Math.round(Math.cos(i / 1500) * 2500 + rnd() * 60) + (o.shiftZ ?? 0), at + 8);
    buf.writeUInt16LE(Math.round(200 + rnd() * 300), at + 12);
    buf[at + 14] = 0x11;
    buf[at + 15] = [1, 2, 2, 2, 3, 5][Math.floor(rnd() * 6)];
    buf[at + 16] = Math.round(rnd() * 20) & 255;
    buf.writeUInt16LE(7, at + 18);
    buf.writeDoubleLE(300_000 + i * 0.0005, at + 20);
    buf.writeUInt16LE(Math.round(rnd() * 65535), at + 28);
    buf.writeUInt16LE(Math.round(rnd() * 65535), at + 30);
    buf.writeUInt16LE(Math.round(rnd() * 65535), at + 32);
  }
  // Reclassification touches only the classification byte of every n-th point, as a ground filter run would.
  if (o.reclassify) for (let i = 0; i < points; i += o.reclassify) buf[start + i * W + 15] = 2;
  return buf;
}

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
let dir = "";
let repo: ReturnType<typeof findRepo>;
const N = 60_000; // 2 MB: about fifteen chunks

async function upload(name: string, data: Buffer, message: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name));
  form.append("paths", JSON.stringify([name]));
  form.append("message", message);
  const res = await app.request("/v1/repos/alice/clouds/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { commit: string }).commit;
}
const raw = async (ref: string, name: string) => Buffer.from(await (await app.request(`/v1/repos/alice/clouds/raw/${ref}/${name}`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
const blobOf = (commit: string, name: string) => {
  const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, commit, "commit").tree, "tree");
  return getObject<BlobObject>(ctx, repo, tree.entries.find((e) => e.path === name)!.blob, "blob");
};
const storedSize = (commit: string, name: string) => blobOf(commit, name).chunks.reduce((n, c) => n + (ctx.db.prepare("SELECT stored_size FROM chunks WHERE hash = ?").get(c.hash) as { stored_size: number }).stored_size, 0);
const codecOf = (hash: string) => (ctx.db.prepare("SELECT codec FROM chunks WHERE hash = ?").get(hash) as { codec: string }).codec;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-las-"));
  ctx = { db: openDb(":memory:"), store: new FsStore(dir) };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run();
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "clouds", visibility: "private" }) })).status, 201);
  repo = findRepo(ctx, "alice", "clouds");
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("the record codec round-trips at every alignment, with a shifted Z and changed classes", () => {
  const old = las(300).subarray(227);
  for (const phase of [0, 1, 5, 17, 33]) {
    for (const length of [300, 1000, 2000, 2500]) {
      const data = Buffer.from(old.subarray(0, length));
      for (let i = phase; i + W <= data.length; i += W) {
        data.writeInt32LE(data.readInt32LE(i + 8) + 120, i + 8);
        data[i + 15] = 2;
      }
      const stored = encodeRecordDelta(data, old.subarray(0, length), [{ hash: "ab".repeat(32), from: 0, to: 1 }], W, phase, 1e9)!;
      assert.ok(stored, `phase ${phase} length ${length}`);
      assert.deepEqual([refDeltaInfo(stored).records, refDeltaInfo(stored).width, refDeltaInfo(stored).phase], [true, W, phase]);
      assert.ok(decodeRefDelta(stored, old.subarray(0, length)).equals(data), `phase ${phase} length ${length}`);
    }
  }
});

test("a reclassified cloud costs a small share of a new copy", async (t) => {
  const v1 = las(N);
  const v2 = las(N, { reclassify: 20 });
  const c1 = await upload("cloud.las", v1, "first");
  const c2 = await upload("cloud.las", v2, "reclassified");
  const before = storedSize(c2, "cloud.las");
  const done = await repackCommit(ctx, repo, c2);
  assert.ok(done.chunks >= 8, JSON.stringify(done));
  const after = storedSize(c2, "cloud.las");
  assert.ok(after < before * 0.08, `${before} -> ${after}`);
  t.diagnostic(`reclassified every 20th point: ${before} -> ${after} bytes stored (${(before / after).toFixed(0)}x less)`);
  assert.ok((await raw(c1, "cloud.las")).equals(v1));
  assert.ok((await raw(c2, "cloud.las")).equals(v2));
  assert.deepEqual((await verifyDifferences(ctx)).bad, []);
});

test("a vertical shift, and a longer header, are handled record by record", async (t) => {
  const v1 = las(N, { seed: 5 });
  const shifted = las(N, { seed: 5, shiftZ: 120, vlr: 300 });
  await upload("shift.las", v1, "one");
  const c2 = await upload("shift.las", shifted, "shifted by 1.2 m and with a longer header");
  const before = storedSize(c2, "shift.las");
  const done = await repackCommit(ctx, repo, c2);
  assert.ok(done.chunks >= 8, JSON.stringify(done));
  const after = storedSize(c2, "shift.las");
  assert.ok(after < before * 0.15, `${before} -> ${after}`);
  t.diagnostic(`shifted 1.2 m with a longer header: ${before} -> ${after} bytes stored (${(before / after).toFixed(0)}x less)`);
  assert.ok((await raw(c2, "shift.las")).equals(shifted));
});

test("a client is sent a chunk that decodes on its own", async () => {
  const c = await upload("client.las", las(N, { seed: 9 }), "a");
  const c2 = await upload("client.las", las(N, { seed: 9, reclassify: 7 }), "b");
  await repackCommit(ctx, repo, c2);
  assert.ok(c);
  const diffs = blobOf(c2, "client.las").chunks.filter((x) => codecOf(x.hash) === "ref-delta");
  assert.ok(diffs.length >= 8);
  for (const d of diffs.slice(0, 5)) assert.equal(sha256Hex(decompressChunk(await getStoredChunk(ctx, repo, d.hash))), d.hash);
});

test("compressed (LAZ) and unrelated files are left alone", async () => {
  const laz = las(N, { seed: 3 });
  laz[104] |= 0x80;
  await upload("c.las", laz, "x");
  const c2 = await upload("c.las", Buffer.concat([laz.subarray(0, laz.length - 1), Buffer.from([1])]), "y");
  assert.equal((await repackCommit(ctx, repo, c2, { apply: false })).chunks, 0);
});
