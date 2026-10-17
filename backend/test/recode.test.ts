// The cold tier for DEFLATE GeoTIFFs, on files written by GDAL: old versions are kept as their pixels (a later one as a difference),
// the tip stays as uploaded, and every way of reading any version still gives exactly the bytes that were uploaded.

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
import { recodeBlob, recodeRepository } from "../src/services/recode.ts";
import { repackIdle } from "../src/services/repack.ts";
import { verifyTiles, forgetRebuiltTiles } from "../src/services/tiles.ts";
import { collectGarbage } from "../src/services/gc.ts";
import { getStoredChunk, putStored, readChunk } from "../src/services/chunks.ts";
import { decompressChunk } from "../src/core/compress.ts";
import { isPieces } from "../src/core/pieces.ts";
import { sha256Hex } from "../src/core/fastcdc.ts";
import { getObject } from "../src/services/history.ts";
import { deflateSegments } from "../src/core/tiff.ts";
import { config } from "../src/config.ts";
import type { BlobObject, CommitObject, TreeObject } from "../src/core/objects.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
let dir = "";
let repo: ReturnType<typeof findRepo>;

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name));
const V1 = fixture("deflate_tiled.tif");
const V2 = fixture("deflate_tiled_shifted.tif");
const V3 = fixture("deflate_tiled_shifted2.tif");
const POLD = fixture("deflate_pair_old.tif");
const PTIP = fixture("deflate_pair_tip.tif");
const commits: string[] = [];

async function upload(name: string, data: Buffer, message: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name));
  form.append("paths", JSON.stringify([name]));
  form.append("message", message);
  const res = await app.request("/v1/repos/alice/dem/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { commit: string }).commit;
}
const raw = async (ref: string, name: string) => Buffer.from(await (await app.request(`/v1/repos/alice/dem/raw/${ref}/${name}`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
const blobOf = (commit: string, name = "dem.tif") => {
  const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, commit, "commit").tree, "tree");
  return { id: tree.entries.find((e) => e.path === name)!.blob, blob: getObject<BlobObject>(ctx, repo, tree.entries.find((e) => e.path === name)!.blob, "blob") };
};
const row = (hash: string) => ctx.db.prepare("SELECT codec, stored_size FROM chunks WHERE hash = ?").get(hash) as { codec: string; stored_size: number };
const stored = (commit: string, name = "dem.tif") => blobOf(commit, name).blob.chunks.reduce((n, c) => n + row(c.hash).stored_size, 0);
const codecs = (commit: string, name = "dem.tif") => new Set(blobOf(commit, name).blob.chunks.map((c) => row(c.hash).codec));

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-recode-"));
  ctx = { db: openDb(":memory:"), store: new FsStore(dir) };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run();
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "dem", visibility: "private" }) })).status, 201);
  repo = findRepo(ctx, "alice", "dem");
  for (const [data, message] of [[V1, "original"], [V2, "datum shift"], [V3, "another datum shift"]] as const) commits.push(await upload("dem.tif", data, message));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("a dry run measures and changes nothing", async () => {
  const before = [stored(commits[0]), stored(commits[1])];
  const r = await recodeRepository(ctx, repo, { apply: false });
  assert.ok(r.tiles >= 12 && r.savedBytes > 0, JSON.stringify(r));
  assert.deepEqual([stored(commits[0]), stored(commits[1])], before);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM tiles").get() as { n: number }).n, 0);
});

test("old versions are kept as pixels (the second as differences), and the tip stays exactly as uploaded", async () => {
  const before = [stored(commits[0]), stored(commits[1]), stored(commits[2])];
  const r = await recodeRepository(ctx, repo);
  assert.ok(r.chunks >= 4 && r.files === 2, JSON.stringify(r));
  const after = [stored(commits[0]), stored(commits[1]), stored(commits[2])];
  assert.ok(after[0] < before[0] * 0.8, `the first version: ${before[0]} -> ${after[0]}`);
  assert.ok(after[1] < before[1] * 0.2, `the shifted version, as differences: ${before[1]} -> ${after[1]}`);
  assert.equal(after[2], before[2], "the tip is untouched");
  assert.deepEqual([...codecs(commits[2])], ["none"]);
  assert.ok(codecs(commits[0]).has("tiles") && codecs(commits[1]).has("tiles"));
  const kinds = ctx.db.prepare("SELECT kind, COUNT(*) AS n FROM tiles GROUP BY kind ORDER BY kind").all() as { kind: number; n: number }[];
  assert.deepEqual(kinds.map((k) => [k.kind, k.n]), [[1, 12], [2, 12]], "12 whole tiles, 12 differences");
});

test("every version still downloads exactly as it was uploaded", async () => {
  forgetRebuiltTiles();
  assert.ok((await raw(commits[0], "dem.tif")).equals(V1), "the original");
  assert.ok((await raw(commits[1], "dem.tif")).equals(V2), "the shifted version");
  assert.ok((await raw(commits[2], "dem.tif")).equals(V3), "the tip");
  for (const c of blobOf(commits[1]).blob.chunks) {
    const direct = await app.request(`/v1/repos/alice/dem/chunks/${c.hash}`, { headers: { authorization: `Bearer ${token}` } });
    assert.equal(sha256Hex(Buffer.from(await direct.arrayBuffer())), c.hash);
  }
});

test("a client is sent chunks it can decode on its own, and cannot upload the cold form", async () => {
  const cold = blobOf(commits[1]).blob.chunks.filter((c) => row(c.hash).codec === "tiles");
  assert.ok(cold.length >= 3);
  for (const c of cold) {
    assert.ok(isPieces((await ctx.store.get(c.hash))!), "stored as pieces");
    const sent = await getStoredChunk(ctx, repo, c.hash);
    assert.equal(isPieces(sent), false);
    assert.equal(sha256Hex(decompressChunk(sent)), c.hash);
  }
  await assert.rejects(putStored(ctx, repo, "e".repeat(64), (await ctx.store.get(cold[0].hash))!), /could not be decoded|Unknown/);
});

test("every stored tile makes its original stream again", async () => {
  assert.deepEqual(await verifyTiles(ctx), { checked: 24, bad: [] });
});

test("a damaged tile is never read as the chunk it is part of", async () => {
  const key = (ctx.db.prepare("SELECT key FROM tiles WHERE kind = 1 LIMIT 1").get() as { key: string }).key;
  const good = (await ctx.store.get(key))!;
  const bad = Buffer.from(good);
  bad[bad.length - 5] ^= 0xff;
  await ctx.store.replace(key, bad);
  forgetRebuiltTiles();
  const victim = blobOf(commits[0]).blob.chunks.find((c) => (ctx.db.prepare("SELECT 1 FROM chunk_tiles WHERE chunk_hash = ? AND tile_key = ?").get(c.hash, key)))!;
  await assert.rejects(readChunk(ctx, victim.hash));
  await ctx.store.replace(key, good);
  forgetRebuiltTiles();
  assert.equal(sha256Hex(await readChunk(ctx, victim.hash)), victim.hash, "and the good bytes read again");
});

test("running it again finds nothing new", async () => {
  const again = await recodeRepository(ctx, repo);
  assert.deepEqual([again.tiles, again.chunks], [0, 0]);
});

test("garbage collection keeps the tiles chunks are made of, and removes them when nothing is", async () => {
  const dry = await collectGarbage(ctx, { apply: true, graceDays: 30, now: Date.now() + 40 * 86_400_000 });
  assert.equal(dry.tilesRemoved, 0, "everything is still referenced");
  forgetRebuiltTiles();
  assert.ok((await raw(commits[1], "dem.tif")).equals(V2));
  // Take the first two versions out of the repository: their chunks and then their tiles are no longer needed.
  for (const id of [blobOf(commits[0]).id, blobOf(commits[1]).id]) ctx.db.prepare("DELETE FROM repo_objects WHERE object_id = ?").run(id);
  const swept = await collectGarbage(ctx, { apply: true, graceDays: 30, now: Date.now() + 40 * 86_400_000 });
  assert.ok(swept.removed > 0 && swept.tilesRemoved === 24, JSON.stringify(swept));
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM tiles").get() as { n: number }).n, 0);
  assert.ok((await raw(commits[2], "dem.tif")).equals(V3), "the tip is still there");
});

test("a tile that cannot be made again is kept as it is, and the rest of the file is still recoded", async () => {
  const broken = Buffer.from(V1);
  const segments = (await deflateSegments(async (o, l) => broken.subarray(o, o + l), broken.length))!;
  broken[segments[3].offset + 40] ^= 0x55; // one byte inside one tile's stream
  const first = await upload("odd.tif", broken, "odd one");
  await upload("odd.tif", V3, "odd two");
  const r = await recodeBlob(ctx, repo, blobOf(first, "odd.tif").id);
  assert.ok(r.tiles + r.reused === 11 && r.chunks > 0, JSON.stringify(r));
  forgetRebuiltTiles();
  assert.ok((await raw(first, "odd.tif")).equals(broken), "the damaged tile comes back as it was, damage and all");
});

test("with it switched on, a push makes the old version cold after the answer", async () => {
  config.recode.auto = true;
  try {
    const a = await upload("auto.tif", V1, "auto one");
    await upload("auto.tif", V2, "auto two");
    await repackIdle();
    assert.ok(codecs(a, "auto.tif").has("tiles"), "the superseded version is cold");
    forgetRebuiltTiles();
    assert.ok((await raw(a, "auto.tif")).equals(V1));
  } finally {
    config.recode.auto = false;
  }
});

test("chunks the tip is made of stay exactly as uploaded even when an old version shares them", async () => {
  const old = await upload("share.tif", POLD, "share one");
  const tip = await upload("share.tif", PTIP, "share two (a small edit)");
  const tipChunks = new Set(blobOf(tip, "share.tif").blob.chunks.map((c) => c.hash));
  const mine = blobOf(old, "share.tif").blob.chunks;
  const shared = mine.filter((c) => tipChunks.has(c.hash));
  assert.ok(shared.length >= 1 && shared.length < mine.length, `${shared.length} of ${mine.length} shared`);
  const tipBefore = stored(tip, "share.tif");
  await recodeRepository(ctx, repo);
  assert.equal(stored(tip, "share.tif"), tipBefore, "the tip is untouched");
  assert.ok(shared.every((c) => row(c.hash).codec !== "tiles"), "so are the chunks it shares with the old version");
  assert.ok((await raw(old, "share.tif")).equals(POLD));
  assert.ok((await raw(tip, "share.tif")).equals(PTIP));
});
