// Storing a changed raster as its difference from the previous version: far smaller, and every way of reading it still gives
// exactly the bytes that were uploaded; clients are never sent a form they cannot decode; garbage collection keeps what a
// stored difference needs.

import { sumAsync } from "../src/core/async.ts";
import { everyAsync, filterAsync, someAsync } from "../src/core/async.ts";
import { statement } from "../src/db/db.ts";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { FsStore } from "../src/storage/fs-store.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Ctx } from "../src/services/context.ts";
import { findRepo } from "../src/services/repos.ts";
import { repackCommit, repackIdle, verifyDifferences } from "../src/services/repack.ts";
import { config } from "../src/config.ts";
import { collectGarbage } from "../src/services/gc.ts";
import { getStoredChunk, putStored, readChunk } from "../src/services/chunks.ts";
import { decompressChunk } from "../src/core/compress.ts";
import { isRefDelta } from "../src/core/refdelta.ts";
import { sha256Hex } from "../src/core/fastcdc.ts";
import { getObject } from "../src/services/history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../src/core/objects.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
let dir = "";
let repo: Awaited<ReturnType<typeof findRepo>>;

const COUNT = 700_000; // 2.8 MB of float32: about twenty chunks
const surface = (shift: number) => {
  const f = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) f[i] = 300 + 40 * Math.sin(i / 900) + (i % 7) * 0.01 + shift;
  return Buffer.from(f.buffer);
};

async function upload(name: string, data: Buffer, message: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name));
  form.append("paths", JSON.stringify([name]));
  form.append("message", message);
  const res = await app.request("/v1/repos/alice/grids/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { commit: string }).commit;
}
const raw = async (ref: string, name: string) => Buffer.from(await (await app.request(`/v1/repos/alice/grids/raw/${ref}/${name}`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
const blobOf = async (commit: string, path = "") => {
  const tree = await getObject<TreeObject>(ctx, repo, (await getObject<CommitObject>(ctx, repo, commit, "commit")).tree, "tree");
  return getObject<BlobObject>(ctx, repo, (tree.entries.find((e) => e.path === path) ?? tree.entries[0]).blob, "blob");
};
const codecOf = async (hash: string) => (await ctx.db.get("SELECT codec FROM chunks WHERE hash = ?", hash) as { codec: string }).codec;
const storedSize = async (commit: string, path = "") => await sumAsync((await blobOf(commit, path)).chunks, async (c) => (await ctx.db.get("SELECT stored_size FROM chunks WHERE hash = ?", c.hash) as { stored_size: number }).stored_size);

const v1 = surface(0);
const v2 = surface(0.25);
let c1 = "";
let c2 = "";

before(async () => {
  // The real on-disk store: it keeps what is already there on `put`, which is what repacking must not trip over.
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-repack-"));
  ctx = { db: await openDb(":memory:"), store: new FsStore(dir) };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  await ctx.db.run("UPDATE users SET plan = 'team', email_verified_at = now_iso() WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')");
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "grids", visibility: "private" }) })).status, 201);
  repo = await findRepo(ctx, "alice", "grids");
  c1 = await upload("dem.flt", v1, "first");
  c2 = await upload("dem.flt", v2, "datum shift");
});

test("a datum shift is stored as a few percent of its size, and nothing else changes", async () => {
  const before = await storedSize(c2);
  const firstBefore = await storedSize(c1);
  const done = await repackCommit(ctx, repo, c2);
  assert.ok(done.chunks > 10 && done.files === 1, JSON.stringify(done));
  const after = await storedSize(c2);
  assert.ok(after < before * 0.1, `${before} -> ${after}`);
  assert.equal(done.savedBytes, before - after);
  assert.equal(await storedSize(c1), firstBefore, "the first version is untouched");
  assert.deepEqual(await verifyDifferences(ctx), { checked: done.chunks, bad: [] });
});

test("every way of reading the file still gives exactly what was uploaded", async () => {
  assert.ok((await raw(c2, "dem.flt")).equals(v2), "download of the shifted version");
  assert.ok((await raw(c1, "dem.flt")).equals(v1), "download of the first version");
  for (const c of (await blobOf(c2)).chunks) {
    const direct = await app.request(`/v1/repos/alice/grids/chunks/${c.hash}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(sha256Hex(Buffer.from(await direct.arrayBuffer())), c.hash);
  }
});

test("a later version is stored against an earlier one that is whole when its parent is itself stored as differences", async () => {
  const a = surface(2);
  const bump = new Float32Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.length));
  for (let i = 100_000; i < 600_000; i++) bump[i] += 0.3 * Math.sin(i / 70_000);
  const base = await upload("chain.flt", a, "chain a");
  const shifted = await upload("chain.flt", surface(2.25), "chain b");
  assert.ok((await repackCommit(ctx, repo, shifted)).chunks > 10, "the second version becomes differences");
  const third = Buffer.from(bump.buffer);
  const head = await upload("chain.flt", third, "chain c");
  const done = await repackCommit(ctx, repo, head);
  assert.ok(done.chunks > 10, `the third is built on the first, which is whole: ${JSON.stringify(done)}`);
  const firstHashes = new Set((await blobOf(base, "chain.flt")).chunks.map((c) => c.hash));
  const used = statement(ctx.db, "SELECT ref_hash FROM chunk_refs WHERE chunk_hash = ?");
  const heads = (await filterAsync((await blobOf(head, "chain.flt")).chunks, async (c) => await codecOf(c.hash) === "ref-delta"));
  assert.ok((await everyAsync(heads, async (c) => (await used.all(c.hash) as { ref_hash: string }[]).every((r) => firstHashes.has(r.ref_hash)))), "its bases are the first version's chunks");
  assert.ok((await raw(head, "chain.flt")).equals(third));
  assert.ok((await raw(shifted, "chain.flt")).equals(surface(2.25)));
});

test("a client is sent a chunk it can decode on its own, never the difference", async () => {
  const diffs = (await filterAsync((await blobOf(c2)).chunks, async (c) => await codecOf(c.hash) === "ref-delta"));
  assert.ok(diffs.length > 10);
  for (const c of diffs.slice(0, 5)) {
    assert.ok(isRefDelta((await ctx.store.get(c.hash))!), "stored as a difference");
    const sent = await getStoredChunk(ctx, repo, c.hash);
    assert.equal(isRefDelta(sent), false, "but not sent as one");
    assert.equal(sha256Hex(decompressChunk(sent)), c.hash, "and it decodes without any store");
  }
});

test("a client cannot upload a difference, and a damaged one is never read as the chunk", async () => {
  const hash = (await filterAsync((await blobOf(c2)).chunks, async (c) => (await codecOf(c.hash)) === "ref-delta"))[0].hash;
  const stored = (await ctx.store.get(hash))!;
  await assert.rejects(putStored(ctx, repo, "f".repeat(64), stored), /could not be decoded|Unknown/);
  const broken = Buffer.from(stored);
  broken[stored.length - 3] ^= 0xff;
  await ctx.store.replace(hash, broken);
  await assert.rejects(readChunk(ctx, hash));
  await ctx.store.replace(hash, stored);
  assert.equal(sha256Hex(await readChunk(ctx, hash)), hash, "and the good bytes read again");
});

test("garbage collection keeps the chunks a stored difference is built on, even with the first version gone", async () => {
  const gone = await blobOf(c1);
  await ctx.db.run("DELETE FROM repo_objects WHERE object_id = (SELECT id FROM objects WHERE type = 'blob' AND body = ?)", JSON.stringify(gone));
  const now = Date.now() + 40 * 86_400_000;
  const dry = await collectGarbage(ctx, { apply: false, graceDays: 30, now });
  const refs = (await ctx.db.get("SELECT COUNT(DISTINCT ref_hash) AS n FROM chunk_refs") as { n: number }).n;
  assert.ok(refs > 5, `${refs} base chunks`);
  const applied = await collectGarbage(ctx, { apply: true, graceDays: 30, now });
  assert.equal(applied.removed, dry.eligible);
  for (const { ref_hash } of await ctx.db.all("SELECT DISTINCT ref_hash FROM chunk_refs") as { ref_hash: string }[]) assert.ok(await ctx.store.has(ref_hash), "a base chunk survived");
  assert.ok((await raw(c2, "dem.flt")).equals(v2), "and the shifted version still downloads");
  assert.deepEqual((await verifyDifferences(ctx)).bad, []);
});

test("a chunk that is itself a difference is never used as a base, so there are no chains of them", async () => {
  const next = surface(0.5);
  const c3 = await upload("dem.flt", next, "another shift");
  const done = await repackCommit(ctx, repo, c3);
  assert.equal(done.chunks, 0, "the earlier versions are stored as differences or gone, so this one stays whole");
  assert.ok((await raw(c3, "dem.flt")).equals(next));
});

test("files that are not plain numeric rasters are left alone", async () => {
  const text = Buffer.from("a,b\n" + Array.from({ length: 80_000 }, (_, i) => `${i},${i * 2}`).join("\n"));
  await upload("t.csv", text, "csv one");
  const t2 = await upload("t.csv", Buffer.concat([text, Buffer.from("\n1,2")]), "csv two");
  assert.equal((await repackCommit(ctx, repo, t2, { apply: false })).chunks, 0);
});

test("measuring only (a dry run) changes nothing", async () => {
  await upload("dry.flt", surface(0), "d1");
  const b = await upload("dry.flt", surface(0.125), "d2");
  const dryRun = await repackCommit(ctx, repo, b, { apply: false });
  assert.ok(dryRun.chunks > 5 && dryRun.savedBytes > 0, JSON.stringify(dryRun));
  assert.equal((await someAsync((await blobOf(b, "dry.flt")).chunks, async (c) => await codecOf(c.hash) === "ref-delta")), false);
});

test("with it switched on, a new version is stored as a difference by the push itself, off the request", async () => {
  const a = surface(1);
  const b = surface(1.5);
  await upload("auto.flt", a, "a1");
  config.repack.auto = true;
  try {
    const head = await upload("auto.flt", b, "a2");
    await repackIdle();
    assert.ok((await filterAsync((await blobOf(head, "auto.flt")).chunks, async (c) => await codecOf(c.hash) === "ref-delta")).length > 10);
    assert.ok((await raw(head, "auto.flt")).equals(b));
  } finally {
    config.repack.auto = false;
  }
});

after(() => fs.rmSync(dir, { recursive: true, force: true }));
