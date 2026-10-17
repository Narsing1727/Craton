import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { chunkBuffer, sha256Hex } from "../src/core/fastcdc.ts";
import type { BlobObject, TreeEntry } from "../src/core/objects.ts";
import { makeCommit, makeTree, objectId } from "../src/core/objects.ts";
import { geotiff, noiseBytes } from "../src/dev/fixtures.ts";

const opts = { min: 32 * 1024, avg: 128 * 1024, max: 512 * 1024 };
let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who: string | null, body?: unknown, raw?: Buffer) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

/** Push files as `who`, the way the CLI does: negotiate chunks, upload, objects, move the branch. */
async function push(who: string, repo: string, files: Record<string, Buffer>, opts2: { branch?: string; parent?: string | null; message?: string; expected?: string | null } = {}) {
  const branch = opts2.branch ?? "main";
  const blobs: BlobObject[] = [];
  const entries: TreeEntry[] = [];
  const pieces = new Map<string, Buffer>();
  for (const [path, data] of Object.entries(files)) {
    const chunks = chunkBuffer(data, opts).map((s) => {
      const piece = data.subarray(s.offset, s.offset + s.length);
      const hash = sha256Hex(piece);
      pieces.set(hash, Buffer.from(piece));
      return { hash, size: s.length };
    });
    const blob: BlobObject = { type: "blob", size: data.length, sha256: sha256Hex(data), chunks };
    blobs.push(blob);
    entries.push({ path, blob: objectId(blob), size: data.length });
  }
  const missing = await call("POST", `/repos/${repo}/chunks/missing`, who, { hashes: [...pieces.keys()] });
  assert.equal(missing.status, 200, missing.text);
  for (const h of missing.json.missing) {
    const r = await call("PUT", `/repos/${repo}/chunks/${h}`, who, undefined, pieces.get(h));
    assert.equal(r.status, 201, r.text);
  }
  const tree = makeTree(entries);
  const parent = opts2.parent === undefined ? ((await call("GET", `/repos/${repo}/refs`, who)).json.branches.find((b: any) => b.name === branch)?.commit_id ?? null) : opts2.parent;
  const commit = makeCommit({ tree: objectId(tree), parents: parent ? [parent] : [], author: who, message: opts2.message ?? "Update data", timestamp: new Date().toISOString() }, tree);
  const objs = await call("POST", `/repos/${repo}/objects`, who, { objects: [...blobs, tree, commit] });
  assert.equal(objs.status, 201, objs.text);
  const ref = await call("POST", `/repos/${repo}/refs/heads/${branch}`, who, { commit: objectId(commit), expected: opts2.expected === undefined ? parent : opts2.expected });
  return { commitId: objectId(commit), missing: missing.json.missing as string[], ref, uploaded: missing.json.missing.length, total: pieces.size };
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob"]) {
    const r = await call("POST", "/auth/signup", null, { username: u, email: `${u}@example.org`, password: "a-very-long-password" });
    assert.equal(r.status, 201, r.text);
    tokens[u] = r.json.token;
    // Tests act as people who confirmed their email (publishing needs it).
    ctx.db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  }
});

test("signup, login and token checks", async () => {
  assert.equal((await call("POST", "/auth/login", null, { login: "alice", password: "wrong-password-123" })).status, 401);
  const ok = await call("POST", "/auth/login", null, { login: "alice@example.org", password: "a-very-long-password" });
  assert.equal(ok.status, 200);
  assert.equal((await call("GET", "/user", "alice")).json.handle, "alice");
  assert.equal((await call("GET", "/user", null)).status, 401);
  const short = await call("POST", "/auth/signup", null, { username: "carol", email: "c@example.org", password: "short" });
  assert.equal(short.status, 400);
});

test("private repositories are invisible to others", async () => {
  assert.equal((await call("POST", "/repos", "alice", { name: "secret-basin", visibility: "private" })).status, 201);
  assert.equal((await call("GET", "/repos/alice/secret-basin", "alice")).status, 200);
  assert.equal((await call("GET", "/repos/alice/secret-basin", "bob")).status, 404);
  assert.equal((await call("GET", "/repos/alice/secret-basin", null)).status, 404);
  assert.ok(!(await call("GET", "/repos", "bob")).json.some((r: any) => r.name === "secret-basin"));
});

test("dedup never reveals someone else's private chunks, but still stores bytes once", async () => {
  const privateData = noiseBytes(700_000, 42);
  const first = await push("alice", "alice/secret-basin", { "terrain/private.tif": privateData }, { parent: null, expected: null });
  assert.equal(first.ref.status, 200, first.ref.text);
  const storedBefore = (ctx.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;

  await call("POST", "/repos", "bob", { name: "bobs-basin", visibility: "public" });
  const probe = await call("POST", "/repos/bob/bobs-basin/chunks/missing", "bob", { hashes: first.missing });
  assert.deepEqual(probe.json.missing.sort(), [...first.missing].sort(), "bob must be asked to upload every chunk");

  const second = await push("bob", "bob/bobs-basin", { "terrain/same-bytes.tif": privateData }, { parent: null, expected: null });
  assert.equal(second.ref.status, 200, second.ref.text);
  const storedAfter = (ctx.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
  assert.equal(storedAfter, storedBefore, "identical bytes are stored once physically");
});

test("public chunks deduplicate across accounts", async () => {
  const shared = noiseBytes(600_000, 7);
  await call("POST", "/repos", "alice", { name: "open-srtm", visibility: "public" });
  await push("alice", "alice/open-srtm", { "N10E076.tif": shared }, { parent: null, expected: null });
  await call("POST", "/repos", "bob", { name: "uses-srtm", visibility: "public" });
  const res = await push("bob", "bob/uses-srtm", { "terrain/N10E076.tif": shared }, { parent: null, expected: null });
  assert.equal(res.uploaded, 0, "bob references alice's public chunks without uploading");
  const stats = await call("GET", "/repos/bob/uses-srtm/storage", "bob");
  assert.ok(stats.json.sharedWithOtherReposBytes >= shared.length);
});

test("history is append-only: stale and non-fast-forward pushes are rejected", async () => {
  await call("POST", "/repos", "alice", { name: "history", visibility: "public" });
  const a = await push("alice", "alice/history", { "a.csv": Buffer.from("x,y\n1,2\n") }, { parent: null, expected: null });
  const b = await push("alice", "alice/history", { "a.csv": Buffer.from("x,y\n1,3\n") });
  assert.equal(b.ref.status, 200, b.ref.text);
  // Someone who still thinks the tip is `a` pushes a sibling of `b`.
  const stale = await push("alice", "alice/history", { "a.csv": Buffer.from("x,y\n9,9\n") }, { parent: a.commitId, expected: a.commitId });
  assert.equal(stale.ref.status, 409);
  assert.equal(stale.ref.json.error.code, "stale_ref");
  const rewrite = await push("alice", "alice/history", { "a.csv": Buffer.from("x,y\n8,8\n") }, { parent: a.commitId, expected: b.commitId });
  assert.equal(rewrite.ref.json.error.code, "non_fast_forward");
  assert.equal((await call("GET", "/repos/alice/history/commits", "alice")).json.length, 2);
});

test("the server recomputes Merkle roots and refuses unsent chunks", async () => {
  await call("POST", "/repos", "alice", { name: "integrity", visibility: "public" });
  const data = Buffer.from("hello");
  const blob: BlobObject = { type: "blob", size: 5, sha256: sha256Hex(data), chunks: [{ hash: sha256Hex(data), size: 5 }] };
  const noChunk = await call("POST", "/repos/alice/integrity/objects", "alice", { objects: [blob] });
  assert.equal(noChunk.json.error.code, "missing_chunks");
  await call("PUT", `/repos/alice/integrity/chunks/${sha256Hex(data)}`, "alice", undefined, data);
  const tree = makeTree([{ path: "hello.txt", blob: objectId(blob), size: 5 }]);
  const forged = { ...makeCommit({ tree: objectId(tree), parents: [], author: "alice", message: "m", timestamp: new Date().toISOString() }, tree), merkleRoot: "0".repeat(64) };
  const res = await call("POST", "/repos/alice/integrity/objects", "alice", { objects: [blob, tree, forged] });
  assert.equal(res.status, 400);
  assert.match(res.json.error.message, /Merkle root mismatch/);
  const badChunk = await call("PUT", `/repos/alice/integrity/chunks/${sha256Hex("other")}`, "alice", undefined, data);
  assert.equal(badChunk.status, 400);
});

test("checks gate merges; fixing the CRS lets the pull request merge; releases pin checksums", async () => {
  await call("POST", "/repos", "alice", { name: "gated", visibility: "public", crs: "EPSG:32643" });
  await call("PATCH", "/repos/alice/gated", "alice", { nodata: -9999 });
  const good = geotiff({ width: 256, height: 256, epsg: 32643, nodata: -9999, seed: 1 });
  const main = await push("alice", "alice/gated", { "terrain/dem.tif": good }, { parent: null, expected: null, message: "Initial DEM" });
  assert.equal(main.ref.json.checks.status, "passed", JSON.stringify(main.ref.json.checks));

  // A branch that adds a raster in the wrong CRS.
  await call("POST", "/repos/alice/gated/branches", "alice", { name: "survey", from: "main" });
  const wrong = geotiff({ width: 128, height: 128, epsg: 4326, nodata: -9999, seed: 2 });
  const bad = await push("alice", "alice/gated", { "terrain/dem.tif": good, "terrain/survey.tif": wrong }, { branch: "survey", message: "Add survey" });
  const crs = bad.ref.json.checks.steps.find((s: any) => s.name === "Coordinate reference system");
  assert.equal(crs.status, "failed");
  assert.match(crs.files.join(" "), /survey\.tif \(EPSG:4326\)/);

  const pr = await call("POST", "/repos/alice/gated/pulls", "alice", { title: "Add survey", source: "survey" });
  assert.equal(pr.status, 201, pr.text);
  const blocked = await call("POST", `/repos/alice/gated/pulls/${pr.json.number}/merge`, "alice");
  assert.equal(blocked.json.error.code, "checks_failing");

  const fixed = geotiff({ width: 128, height: 128, epsg: 32643, nodata: -9999, seed: 2 });
  const fix = await push("alice", "alice/gated", { "terrain/dem.tif": good, "terrain/survey.tif": fixed }, { branch: "survey", message: "Reproject survey to UTM 43N" });
  assert.equal(fix.ref.json.checks.status, "passed", JSON.stringify(fix.ref.json.checks.steps));
  const merged = await call("POST", `/repos/alice/gated/pulls/${pr.json.number}/merge`, "alice");
  assert.equal(merged.status, 200, merged.text);
  assert.equal(merged.json.state, "merged");

  const rel = await call("POST", "/repos/alice/gated/releases", "alice", { tag: "v1.0.0", title: "First calibrated release" });
  assert.equal(rel.status, 201, rel.text);
  assert.equal(rel.json.checksums.find((c: any) => c.path === "terrain/dem.tif").sha256, sha256Hex(good));
  const sums = await call("GET", "/repos/alice/gated/releases/v1.0.0/SHA256SUMS", null);
  assert.match(sums.text, new RegExp(`${sha256Hex(fixed)}  terrain/survey.tif`));
  assert.equal((await call("POST", "/repos/alice/gated/releases", "alice", { tag: "v1.0.0" })).status, 409);
});

test("issues and comments", async () => {
  const issue = await call("POST", "/repos/alice/gated/issues", "bob", { title: "Datum mismatch", label: "data-quality", file: "terrain/dem.tif" });
  assert.equal(issue.status, 201, issue.text);
  await call("POST", `/repos/alice/gated/issues/${issue.json.number}/comments`, "alice", { body: "Looking into it." });
  const closed = await call("PATCH", `/repos/alice/gated/issues/${issue.json.number}`, "alice", { state: "closed" });
  assert.equal(closed.json.state, "closed");
  assert.equal((await call("PATCH", `/repos/alice/gated/issues/${issue.json.number}`, "bob", { state: "open" })).status, 403);
  const detail = await call("GET", `/repos/alice/gated/issues/${issue.json.number}`, null);
  assert.equal(detail.json.thread.length, 1);
});
