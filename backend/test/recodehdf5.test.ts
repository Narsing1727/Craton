// The cold tier on HDF5 files with DEFLATE (and shuffle) chunks, as HEC-RAS results are: old versions are kept as pixels, a later
// version as its difference from an earlier one, and everything still reads back exactly.

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
import { recodeRepository } from "../src/services/recode.ts";
import { verifyTiles, forgetRebuiltTiles } from "../src/services/tiles.ts";
import { getStoredChunk } from "../src/services/chunks.ts";
import { decompressChunk } from "../src/core/compress.ts";
import { sha256Hex } from "../src/core/fastcdc.ts";
import { tileInfo } from "../src/core/tilepayload.ts";
import { getObject } from "../src/services/history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../src/core/objects.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
let dir = "";
let repo: ReturnType<typeof findRepo>;
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name));
const A = fixture("h5_gzip_shuffle.h5");
const B = fixture("h5_gzip_shuffle_shifted.h5");
const TIP = fixture("h5_gzip_plain.h5");
const commits: string[] = [];
const NAME = "Chalakudy.p01.hdf";

async function upload(data: Buffer, message: string) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], NAME));
  form.append("paths", JSON.stringify([NAME]));
  form.append("message", message);
  const res = await app.request("/v1/repos/alice/results/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 201, await res.clone().text());
  return ((await res.json()) as { commit: string }).commit;
}
const raw = async (ref: string) => Buffer.from(await (await app.request(`/v1/repos/alice/results/raw/${ref}/${NAME}`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
const blobOf = (commit: string) => {
  const tree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, commit, "commit").tree, "tree");
  return getObject<BlobObject>(ctx, repo, tree.entries[0].blob, "blob");
};
const row = (hash: string) => ctx.db.prepare("SELECT codec, stored_size FROM chunks WHERE hash = ?").get(hash) as { codec: string; stored_size: number };
const stored = (commit: string) => blobOf(commit).chunks.reduce((n, c) => n + row(c.hash).stored_size, 0);

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-recode-h5-"));
  ctx = { db: openDb(":memory:"), store: new FsStore(dir) };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run();
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "results", visibility: "private" }) })).status, 201);
  repo = findRepo(ctx, "alice", "results");
  for (const [data, message] of [[A, "run 1"], [B, "run 2: datum shift"], [TIP, "run 3"]] as const) commits.push(await upload(data, message));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test("the first two runs are kept as pixels, the second as differences from the first, and the tip is untouched", async () => {
  const before = [stored(commits[0]), stored(commits[1]), stored(commits[2])];
  const r = await recodeRepository(ctx, repo);
  assert.ok(r.chunks > 0 && r.files >= 1, JSON.stringify(r));
  const after = [stored(commits[0]), stored(commits[1]), stored(commits[2])];
  assert.ok(after[1] < before[1] * 0.25, `the shifted run: ${before[1]} -> ${after[1]}`);
  assert.ok(after[0] <= before[0] * 1.2, `the first run is no more than a little bigger as pixels: ${before[0]} -> ${after[0]}`);
  assert.equal(after[2], before[2], "the tip is untouched");
  const kinds = ctx.db.prepare("SELECT kind, COUNT(*) AS n FROM tiles GROUP BY kind").all() as { kind: number; n: number }[];
  assert.ok(kinds.some((k) => k.kind === 2 && k.n >= 150), JSON.stringify(kinds));
  const any = ctx.db.prepare("SELECT key FROM tiles WHERE kind = 2 LIMIT 1").get() as { key: string };
  const info = tileInfo((await ctx.store.get(any.key))!);
  assert.deepEqual([info.shuffled, info.width], [true, 4], "HDF5's shuffle is undone before differencing");
});

test("every run reads back exactly as uploaded, by download and for a client", async () => {
  forgetRebuiltTiles();
  assert.ok((await raw(commits[0])).equals(A));
  assert.ok((await raw(commits[1])).equals(B));
  assert.ok((await raw(commits[2])).equals(TIP));
  for (const c of blobOf(commits[1]).chunks) assert.equal(sha256Hex(decompressChunk(await getStoredChunk(ctx, repo, c.hash))), c.hash);
});

test("every stored tile makes its original stream again", async () => {
  const v = await verifyTiles(ctx);
  assert.ok(v.checked >= 190 && v.bad.length === 0, JSON.stringify({ checked: v.checked, bad: v.bad.length }));
});
