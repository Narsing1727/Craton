// The whole-store check: a store holding every stored form (as uploaded, compressed, a difference, pieces of tiles) checks out, and each
// kind of damage is found and named: a chunk with flipped bytes or none at all, a damaged tile, a base that is gone, a file whose chunks do
// not add up, a commit whose Merkle root does not match.

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
import { repackCommit } from "../src/services/repack.ts";
import { recodeRepository } from "../src/services/recode.ts";
import { fsck } from "../src/services/fsck.ts";
import { forgetRebuiltTiles } from "../src/services/tiles.ts";
import { collectGarbage } from "../src/services/gc.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
let dir = "";
let flt2 = "";
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name));

const surface = (shift: number) => {
  const f = new Float32Array(300_000);
  for (let i = 0; i < f.length; i++) f[i] = 300 + 40 * Math.sin(i / 900) + (i % 7) * 0.01 + shift;
  return Buffer.from(f.buffer);
};
async function upload(name: string, data: Buffer, message: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name));
  form.append("paths", JSON.stringify([name]));
  form.append("message", message);
  const res = await app.request("/v1/repos/alice/store/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { commit: string }).commit;
}
const plain = () => (ctx.db.prepare("SELECT hash FROM chunks WHERE codec NOT IN ('ref-delta', 'tiles') ORDER BY hash").all() as { hash: string }[]).map((r) => r.hash);
const hashesOf = (codec: string) => (ctx.db.prepare("SELECT hash FROM chunks WHERE codec = ? ORDER BY hash").all(codec) as { hash: string }[]).map((r) => r.hash);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-fsck-"));
  ctx = { db: openDb(":memory:"), store: new FsStore(dir) };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run();
  await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "store", visibility: "private" }) });
  const repo = findRepo(ctx, "alice", "store");
  await upload("notes.csv", Buffer.from("a,b\n" + Array.from({ length: 4000 }, (_, i) => `${i},${i * 3}`).join("\n")), "a table");
  await upload("grid.flt", surface(0), "grid one");
  flt2 = await upload("grid.flt", surface(0.25), "grid shifted");
  await repackCommit(ctx, repo, flt2);
  for (const [name, message] of [["deflate_tiled.tif", "dem one"], ["deflate_tiled_shifted.tif", "dem shifted"], ["deflate_tiled_shifted2.tif", "dem tip"]]) await upload("dem.tif", fixture(name), message);
  await recodeRepository(ctx, repo);
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("a store holding every stored form checks out", async () => {
  assert.ok(hashesOf("ref-delta").length > 0 && hashesOf("tiles").length > 0 && plain().length > 2, "the test needs every form to be present");
  const r = await fsck(ctx);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.chunks.checked > 20 && r.chunks.bytes > 1_000_000);
  assert.ok(r.bases.checked > 0 && r.tiles.checked >= 24 && r.files.checked >= 6 && r.commits.checked >= 6);
});

test("a chunk with a flipped byte, and a chunk with no bytes, are named", async () => {
  const [victim, other] = plain();
  const good = (await ctx.store.get(victim))!;
  const otherBytes = (await ctx.store.get(other))!;
  const bad = Buffer.from(good);
  bad[Math.floor(bad.length / 2)] ^= 0x10;
  await ctx.store.replace(victim, bad);
  await ctx.store.delete(other);
  const r = await fsck(ctx);
  assert.equal(r.ok, false);
  assert.deepEqual([r.chunks.corrupt.includes(victim), r.chunks.missing.includes(other)], [true, true]);
  const quick = await fsck(ctx, { quick: true });
  assert.equal(quick.chunks.corrupt.length + quick.chunks.missing.length, 0, "--quick reads no bytes, so it cannot see this");
  await ctx.store.replace(victim, good);
  await ctx.store.replace(other, otherBytes);
  assert.equal((await fsck(ctx)).ok, true, "put back, it checks out again");
});

test("a stored difference whose base is gone, and a damaged tile, are named", async () => {
  const diff = hashesOf("ref-delta")[0];
  const base = (ctx.db.prepare("SELECT ref_hash FROM chunk_refs WHERE chunk_hash = ?").get(diff) as { ref_hash: string }).ref_hash;
  const baseBytes = (await ctx.store.get(base))!;
  await ctx.store.delete(base);
  const lost = await fsck(ctx);
  assert.ok(lost.chunks.corrupt.includes(diff) || lost.chunks.missing.includes(base), "the difference can no longer be read");
  await ctx.store.replace(base, baseBytes);

  const tile = (ctx.db.prepare("SELECT key FROM tiles WHERE kind = 1 LIMIT 1").get() as { key: string }).key;
  const tileBytes = (await ctx.store.get(tile))!;
  const damaged = Buffer.from(tileBytes);
  damaged[damaged.length - 4] ^= 0xff;
  await ctx.store.replace(tile, damaged);
  forgetRebuiltTiles();
  const r = await fsck(ctx);
  assert.ok(r.tiles.bad.some((t) => t.includes(tile.slice(0, 12))), JSON.stringify(r.tiles));
  await ctx.store.replace(tile, tileBytes);
  forgetRebuiltTiles();
});

test("a file whose chunks do not add up, and a commit whose Merkle root is wrong, are named; --quick sees them without reading anything", async () => {
  const blob = ctx.db.prepare("SELECT id, body FROM objects WHERE type = 'blob' AND body LIKE '%\"size\":%' ORDER BY id LIMIT 1").get() as { id: string; body: string };
  const changed = JSON.parse(blob.body);
  changed.size += 7;
  ctx.db.prepare("UPDATE objects SET body = ? WHERE id = ?").run(JSON.stringify(changed), blob.id);
  const commit = ctx.db.prepare("SELECT id, body FROM objects WHERE type = 'commit' ORDER BY id LIMIT 1").get() as { id: string; body: string };
  const tampered = JSON.parse(commit.body);
  tampered.merkleRoot = "0".repeat(64);
  ctx.db.prepare("UPDATE objects SET body = ? WHERE id = ?").run(JSON.stringify(tampered), commit.id);
  const r = await fsck(ctx, { quick: true });
  assert.ok(r.files.bad.some((m) => m.startsWith(blob.id.slice(0, 12))), JSON.stringify(r.files));
  assert.ok(r.commits.bad.some((m) => m.startsWith(commit.id.slice(0, 12))), JSON.stringify(r.commits));
  assert.equal(r.ok, false);
  ctx.db.prepare("UPDATE objects SET body = ? WHERE id = ?").run(blob.body, blob.id);
  ctx.db.prepare("UPDATE objects SET body = ? WHERE id = ?").run(commit.body, commit.id);
  assert.equal((await fsck(ctx, { quick: true })).ok, true);
});

test("a chunk the database says is one form but whose bytes are another is reported", async () => {
  const hash = plain()[1];
  ctx.db.prepare("UPDATE chunks SET codec = 'shuffle4+zstd' WHERE hash = ?").run(hash);
  const r = await fsck(ctx);
  assert.equal(r.chunks.wrongForm.length, 0, "the two plain-codec names are not told apart: the bytes decode and hash correctly");
  ctx.db.prepare("UPDATE chunks SET codec = 'tiles' WHERE hash = ?").run(hash);
  const r2 = await fsck(ctx);
  assert.ok(r2.chunks.wrongForm.some((m) => m.startsWith(hash.slice(0, 12))), JSON.stringify(r2.chunks.wrongForm));
  ctx.db.prepare("UPDATE chunks SET codec = 'zstd' WHERE hash = ?").run(hash);
  assert.equal((await fsck(ctx)).chunks.wrongForm.length, 0);
});

test("a database restored from before the chunks were rewritten is put right from the bytes, so nothing they need is collected", async () => {
  const snapshot = ctx.db.prepare("SELECT hash, codec, stored_size FROM chunks ORDER BY hash").all() as { hash: string; codec: string; stored_size: number }[];
  const refs = (ctx.db.prepare("SELECT COUNT(*) AS n FROM chunk_refs").get() as { n: number }).n;
  const tiles = (ctx.db.prepare("SELECT COUNT(*) AS n FROM tiles").get() as { n: number }).n;
  const links = (ctx.db.prepare("SELECT COUNT(*) AS n FROM chunk_tiles").get() as { n: number }).n;
  assert.ok(refs > 0 && tiles >= 24 && links > 0);

  // A backup whose database snapshot knows nothing about the differences and tiles that are in the chunk files.
  ctx.db.exec("DELETE FROM chunk_refs; DELETE FROM chunk_tiles; DELETE FROM tiles; UPDATE chunks SET codec = 'zstd', stored_size = size WHERE codec IN ('ref-delta', 'tiles');");
  const before = await fsck(ctx);
  assert.equal(before.ok, false, "it is noticed");

  const healed = await fsck(ctx, { repair: true });
  assert.equal(healed.ok, true, JSON.stringify([healed.chunks, healed.tiles, healed.bases]));
  assert.ok(healed.repaired.length > 20);
  assert.deepEqual(ctx.db.prepare("SELECT hash, codec, stored_size FROM chunks ORDER BY hash").all(), snapshot, "every chunk is recorded as it was");
  assert.deepEqual([(ctx.db.prepare("SELECT COUNT(*) AS n FROM chunk_refs").get() as { n: number }).n, (ctx.db.prepare("SELECT COUNT(*) AS n FROM tiles").get() as { n: number }).n, (ctx.db.prepare("SELECT COUNT(*) AS n FROM chunk_tiles").get() as { n: number }).n], [refs, tiles, links]);
  assert.equal((await fsck(ctx, { repair: true })).repaired.length, 0, "and a second repair has nothing to do");

  // What the repair is for: garbage collection no longer sees the bases and tiles as unused.
  const swept = await collectGarbage(ctx, { apply: true, graceDays: 30, now: Date.now() + 40 * 86_400_000 });
  assert.equal(swept.tilesRemoved, 0);
  assert.equal((await fsck(ctx)).ok, true);
});
