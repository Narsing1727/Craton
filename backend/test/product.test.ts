// Endpoints the web app reads and writes: file detail, compare, activity, usage, tokens,
// organizations and profiles. Runs against an in-memory database and chunk store.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { chunkBuffer, sha256Hex } from "../src/core/fastcdc.ts";
import type { BlobObject, TreeEntry } from "../src/core/objects.ts";
import { makeCommit, makeTree, objectId } from "../src/core/objects.ts";
import { gaugesCsv, geotiff } from "../src/dev/fixtures.ts";

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

/** Push a full snapshot of `files` to `branch`, the way the CLI does. */
async function push(who: string, repo: string, files: Record<string, Buffer>, branch = "main", message = "Update data") {
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
  for (const h of missing.json.missing) assert.equal((await call("PUT", `/repos/${repo}/chunks/${h}`, who, undefined, pieces.get(h))).status, 201);
  const tree = makeTree(entries);
  const parent = (await call("GET", `/repos/${repo}/refs`, who)).json.branches.find((b: any) => b.name === branch)?.commit_id ?? null;
  const commit = makeCommit({ tree: objectId(tree), parents: parent ? [parent] : [], author: who, message, timestamp: new Date().toISOString() }, tree);
  assert.equal((await call("POST", `/repos/${repo}/objects`, who, { objects: [...blobs, tree, commit] })).status, 201);
  const ref = await call("POST", `/repos/${repo}/refs/heads/${branch}`, who, { commit: objectId(commit), expected: parent });
  assert.equal(ref.status, 200, ref.text);
  return objectId(commit);
}

const dem = geotiff({ width: 256, height: 256, epsg: 32643, verticalEpsg: 3855, nodata: -9999, seed: 3 });
const csv = Buffer.from(gaugesCsv(20));
const readme = Buffer.from("# Test basin\n\nTerrain and gauges.\n");

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol"]) {
    const r = await call("POST", "/auth/signup", null, { username: u, email: `${u}@example.org`, password: "a-very-long-password" });
    assert.equal(r.status, 201, r.text);
    tokens[u] = r.json.token;
    // Tests act as people who confirmed their email (publishing needs it).
    ctx.db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  }
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "public" })).status, 201);
  await push("alice", "alice/basin", { "README.md": readme, "terrain/dem.tif": dem, "gauges.csv": csv }, "main", "Initial import");
});

test("repository detail includes the README", async () => {
  const r = await call("GET", "/repos/alice/basin", null);
  assert.equal(r.status, 200);
  assert.match(r.json.readme, /^# Test basin/);
});

test("file detail reads GeoTIFF tags, table shape and history from stored chunks", async () => {
  const tif = await call("GET", "/repos/alice/basin/file/main/terrain/dem.tif", null);
  assert.equal(tif.status, 200, tif.text);
  assert.equal(tif.json.raster.width, 256);
  assert.equal(tif.json.raster.epsg, 32643);
  assert.equal(tif.json.raster.verticalEpsg, 3855);
  assert.equal(tif.json.raster.nodata, -9999);
  assert.equal(tif.json.sha256, sha256Hex(dem));
  assert.equal(tif.json.history.length, 1);
  assert.equal(tif.json.history[0].change, "added");

  const table = await call("GET", "/repos/alice/basin/file/main/gauges.csv", null);
  assert.deepEqual(table.json.table.columns, ["station", "timestamp", "stage_m", "discharge_m3s"]);
  assert.equal(table.json.table.rows, csv.toString().trim().split("\n").length - 1);
  assert.ok(table.json.preview.startsWith("station,"));

  assert.equal((await call("GET", "/repos/alice/basin/file/main/missing.tif", null)).status, 404);
});

test("commit list can include each commit's changes with a chunk map", async () => {
  const r = await call("GET", "/repos/alice/basin/commits?changes=1", null);
  const change = r.json[0].changes.find((c: any) => c.path === "terrain/dem.tif");
  assert.equal(change.change, "added");
  assert.match(change.chunks.map, /^n+$/);
  assert.equal(change.chunks.map.length, change.chunks.added);
});

test("compare reports commits ahead, file changes and conflicts", async () => {
  const main = (await call("GET", "/repos/alice/basin/refs", "alice")).json.branches.find((b: any) => b.name === "main").commit_id;
  assert.equal((await call("POST", "/repos/alice/basin/branches", "alice", { name: "resurvey", from: "main" })).status, 201);
  const changed = geotiff({ width: 256, height: 256, epsg: 32643, verticalEpsg: 3855, nodata: -9999, seed: 3, resurvey: { from: 200, to: 256, offset: -0.4 } });
  await push("alice", "alice/basin", { "README.md": readme, "terrain/dem.tif": changed, "gauges.csv": csv }, "resurvey", "Re-survey rows 200-256");

  const c = await call("GET", "/repos/alice/basin/compare/main...resurvey", null);
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.ahead, 1);
  assert.equal(c.json.behind, 0);
  assert.equal(c.json.fastForward, true);
  assert.equal(c.json.mergeBase, main);
  assert.deepEqual(c.json.changes.map((x: any) => x.path), ["terrain/dem.tif"]);
  // Only the re-surveyed rows' chunks are new; the rest are shared with main's version.
  assert.ok(c.json.changes[0].chunks.shared > 0);
  assert.deepEqual(c.json.conflicts, []);

  // Change the same file differently on main: now it conflicts.
  await push("alice", "alice/basin", { "README.md": readme, "terrain/dem.tif": geotiff({ width: 256, height: 256, epsg: 32643, verticalEpsg: 3855, nodata: -9999, seed: 9 }), "gauges.csv": csv }, "main", "Replace DEM");
  const c2 = await call("GET", "/repos/alice/basin/compare/main...resurvey", null);
  assert.equal(c2.status, 200, c2.text);
  assert.equal(c2.json.fastForward, false);
  assert.deepEqual(c2.json.conflicts, ["terrain/dem.tif"]);
});

test("activity only covers repositories the viewer can see", async () => {
  assert.equal((await call("POST", "/repos", "alice", { name: "secret", visibility: "private" })).status, 201);
  await push("alice", "alice/secret", { "notes.txt": Buffer.from("private") }, "main", "Private notes");
  const mine = await call("GET", "/activity?limit=100", "alice");
  assert.ok(mine.json.some((e: any) => e.repo === "alice/secret"));
  for (const who of [null, "bob"]) {
    const other = await call("GET", "/activity?limit=100", who);
    assert.equal(other.status, 200);
    assert.ok(!other.json.some((e: any) => e.repo === "alice/secret"), `${who ?? "anonymous"} saw a private event`);
    assert.ok(other.json.some((e: any) => e.repo === "alice/basin"));
  }
  const byActor = await call("GET", "/activity?actor=bob", null);
  assert.deepEqual(byActor.json, []);
});

test("usage bills unique chunks once and lets public chunks another owner holds go free", async () => {
  assert.equal((await call("GET", "/user/usage", null)).status, 401);
  const before = (await call("GET", "/user/usage", "alice")).json;
  assert.equal(before.repositories.total, 2);
  assert.equal(before.repositories.private, 1);
  assert.ok(before.storedBytes > 0);
  assert.equal(before.sharedFreeBytes, 0);

  // Bob publishes the same gauge file: those chunks stop counting against Alice.
  assert.equal((await call("POST", "/repos", "bob", { name: "gauges", visibility: "public" })).status, 201);
  await push("bob", "bob/gauges", { "gauges.csv": csv });
  const after = (await call("GET", "/user/usage", "alice")).json;
  assert.equal(after.sharedFreeBytes, csv.length);
  assert.ok(after.storedBytes < before.storedBytes);
});

test("token list marks the token making the request", async () => {
  const pat = await call("POST", "/user/tokens", "alice", { note: "ci", scopes: ["repo"] });
  assert.equal(pat.status, 201, pat.text);
  tokens.alicePat = pat.json.token;
  const list = await call("GET", "/user/tokens", "alicePat");
  assert.deepEqual(list.json.map((t: any) => [t.note, t.current]), [["ci", true]]);
  assert.ok(!("token_hash" in list.json[0]));
  // A session token isn't a PAT, so nothing in the list is "current" for it.
  assert.ok((await call("GET", "/user/tokens", "alice")).json.every((t: any) => t.current === false));
});

test("organizations: create, add members, change roles, keep an owner", async () => {
  const org = await call("POST", "/orgs", "alice", { handle: "lab", name: "Lab" });
  assert.equal(org.status, 201, org.text);
  assert.equal((await call("POST", "/orgs", "bob", { handle: "lab" })).status, 409);

  assert.equal((await call("POST", "/orgs/lab/members", "alice", { handle: "bob", role: "Member" })).status, 201);
  assert.equal((await call("POST", "/orgs/lab/members", "alice", { handle: "bob" })).status, 409);
  // A Member can't add people, and a non-member can't even see the org's members API.
  assert.equal((await call("POST", "/orgs/lab/members", "bob", { handle: "carol" })).status, 403);
  assert.equal((await call("POST", "/orgs/lab/members", "carol", { handle: "carol" })).status, 404);

  // The only owner can't step down or leave.
  assert.equal((await call("PATCH", "/orgs/lab/members/alice", "alice", { role: "Member" })).status, 409);
  assert.equal((await call("DELETE", "/orgs/lab/members/alice", "alice")).status, 409);
  const promoted = await call("PATCH", "/orgs/lab/members/bob", "alice", { role: "Owner" });
  assert.deepEqual(promoted.json.map((m: any) => [m.handle, m.role]), [["alice", "Owner"], ["bob", "Owner"]]);
  assert.equal((await call("PATCH", "/orgs/lab/members/alice", "alice", { role: "Maintainer" })).status, 200);
  assert.equal((await call("PATCH", "/orgs/lab/members/bob", "bob", { role: "Chief" })).status, 400);
  const removed = await call("DELETE", "/orgs/lab/members/alice", "bob");
  assert.deepEqual(removed.json.map((m: any) => m.handle), ["bob"]);

  // Org usage is visible to members only.
  assert.equal((await call("GET", "/owners/lab/usage", "bob")).status, 200);
  assert.equal((await call("GET", "/owners/lab/usage", "carol")).status, 404);
});

test("profiles list a person's organizations and commit count", async () => {
  const bob = await call("GET", "/owners/bob", null);
  assert.deepEqual(bob.json.orgs, ["lab"]);
  assert.equal(bob.json.commitCount, 1);
  const alice = await call("GET", "/owners/alice", null);
  // Private commits aren't counted for viewers who can't see the repository.
  assert.equal(alice.json.commitCount, 3);
  assert.equal((await call("GET", "/owners/alice", "alice")).json.commitCount, 4);
});
