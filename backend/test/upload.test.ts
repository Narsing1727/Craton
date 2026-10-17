// Adding files from the browser: multipart in, one commit out, with the same rules as a push.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { cleanUploadPath } from "../src/services/ingest.ts";
import { config } from "../src/config.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function json(method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, json: parsed, text };
}

type Part = { name: string; data: Buffer | string };
/** The same form the web app sends: `file` parts with a parallel `paths` list, plus options. */
async function upload(repo: string, who: string | null, parts: Part[], fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const p of parts) form.append("file", new File([new Uint8Array(typeof p.data === "string" ? Buffer.from(p.data) : p.data)], p.name.split("/").pop()!));
  form.append("paths", JSON.stringify(parts.map((p) => p.name)));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await app.request(`/v1/repos/${repo}/upload`, { method: "POST", headers: who ? { authorization: `Bearer ${tokens[who]}` } : {}, body: form });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {}
  return { status: res.status, json: parsed, text };
}

const tip = async (repo: string, branch: string) => (await json("GET", `/repos/${repo}/refs`, "rhea")).json.branches.find((b: any) => b.name === branch)?.commit_id as string | undefined;

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "sol", "ines"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  assert.equal((await json("POST", "/repos", "rhea", { name: "basin", visibility: "private" })).status, 201);
  ctx.db.prepare("INSERT INTO collaborators (repo_id, user_id, role) VALUES ((SELECT id FROM repos WHERE name = 'basin'), (SELECT id FROM owners WHERE handle = 'sol'), 'Read')").run();
});

// ── Paths ──────────────────────────────────────────────────────────────────

test("upload paths are cleaned, and anything that could escape or confuse is refused", () => {
  assert.equal(cleanUploadPath("", "dem.tif"), "dem.tif");
  assert.equal(cleanUploadPath("terrain", "tiles/n10.tif"), "terrain/tiles/n10.tif");
  assert.equal(cleanUploadPath("/terrain/", "\\\\win\\style\\file.csv"), "terrain/win/style/file.csv", "backslashes become slashes, empty parts disappear");
  for (const bad of ["../x", "a/../b", "a/./b", "./x", ".craton/config.json", "a\u0000b", "a/\u0007/b", "x".repeat(300), ""]) {
    assert.throws(() => cleanUploadPath("", bad), (e: any) => e.status === 400, JSON.stringify(bad.slice(0, 20)));
  }
  assert.throws(() => cleanUploadPath("..", "x"), (e: any) => e.status === 400);
  assert.throws(() => cleanUploadPath("a", `${"d/".repeat(600)}f`), (e: any) => e.status === 400, "a path over 1024 characters");
});

// ── Uploading ──────────────────────────────────────────────────────────────

const dem = crypto.randomBytes(700_000); // several chunks

test("the first upload into an empty repository makes its first commit on the default branch", async () => {
  const r = await upload("rhea/basin", "rhea", [{ name: "terrain/dem.tif", data: dem }, { name: "README.md", data: "# Basin\n" }]);
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.branch, "main");
  assert.equal(r.json.created, true);
  assert.equal(r.json.before, null);
  assert.deepEqual(r.json.files.map((f: any) => [f.path, f.change]).sort(), [["README.md", "added"], ["terrain/dem.tif", "added"]]);
  assert.equal(r.json.bytes, dem.length + 8);
  assert.ok(r.json.checks, "checks ran on the new commit");
  const commits = (await json("GET", "/repos/rhea/basin/commits", "rhea")).json;
  assert.equal(commits.length, 1);
  assert.equal(commits[0].message, "Upload 2 files");
  assert.equal(commits[0].author, "rhea");
});

test("the uploaded bytes are exactly the ones sent", async () => {
  const body = Buffer.from(await (await app.request("/v1/repos/rhea/basin/raw/main/terrain/dem.tif", { headers: { authorization: `Bearer ${tokens.rhea}` } })).arrayBuffer());
  assert.ok(body.equals(dem));
  const info = (await json("GET", "/repos/rhea/basin/file/main/terrain/dem.tif", "rhea")).json;
  assert.equal(info.size, dem.length);
  assert.equal(info.sha256, crypto.createHash("sha256").update(dem).digest("hex"));
});

test("a later upload adds, replaces and leaves alone, and says which is which", async () => {
  const before = await tip("rhea/basin", "main");
  const r = await upload(
    "rhea/basin",
    "rhea",
    [
      { name: "README.md", data: "# Basin\nUpdated\n" }, // changed
      { name: "terrain/dem.tif", data: dem }, // identical
      { name: "model/plan.p01", data: "Plan Title=Run 1\n" }, // new
    ],
    { message: "Add the plan, update the readme", expected: before! },
  );
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.json.files.map((f: any) => [f.path, f.change]).sort(), [["README.md", "modified"], ["model/plan.p01", "added"]]);
  assert.deepEqual(r.json.unchanged, ["terrain/dem.tif"]);
  assert.equal(r.json.before, before);
  const commits = (await json("GET", "/repos/rhea/basin/commits", "rhea")).json;
  assert.equal(commits[0].message, "Add the plan, update the readme");
  assert.deepEqual(commits[0].parents, [before]);
  const tree = (await json("GET", "/repos/rhea/basin/paths/main", "rhea")).json.files.map((f: any) => f.path).sort();
  assert.deepEqual(tree, ["README.md", "model/plan.p01", "terrain/dem.tif"], "nothing was lost");
});

test("files into a chosen folder, with their own relative paths (a dropped folder)", async () => {
  const r = await upload("rhea/basin", "rhea", [{ name: "tiles/n10_e076.tif", data: "tile one" }, { name: "tiles/sub/n11_e076.tif", data: "tile two" }], { folder: "terrain/srtm" });
  assert.equal(r.status, 201, r.text);
  assert.deepEqual(r.json.files.map((f: any) => f.path).sort(), ["terrain/srtm/tiles/n10_e076.tif", "terrain/srtm/tiles/sub/n11_e076.tif"]);
});

test("uploading only files that are already there changes nothing and says so", async () => {
  const before = await tip("rhea/basin", "main");
  const r = await upload("rhea/basin", "rhea", [{ name: "terrain/dem.tif", data: dem }]);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "nothing_changed");
  assert.equal(await tip("rhea/basin", "main"), before, "no empty commit was made");
});

test("a new branch starts from the default branch, and the default branch is left untouched", async () => {
  const mainTip = await tip("rhea/basin", "main");
  const r = await upload("rhea/basin", "rhea", [{ name: "model/plan.p02", data: "Plan Title=Run 2\n" }], { branch: "run-2", from: "main", message: "Try run 2" });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.json.created, true);
  assert.equal(r.json.branch, "run-2");
  assert.equal(await tip("rhea/basin", "main"), mainTip);
  const commits = (await json("GET", "/repos/rhea/basin/commits?ref=run-2", "rhea")).json;
  assert.deepEqual(commits[0].parents, [mainTip]);
  const files = (await json("GET", "/repos/rhea/basin/paths/run-2", "rhea")).json.files.map((f: any) => f.path);
  assert.ok(files.includes("model/plan.p02") && files.includes("terrain/dem.tif"), "the new branch has the old files plus the new one");
  assert.equal((await upload("rhea/basin", "rhea", [{ name: "x.txt", data: "x" }], { branch: "from-nowhere", from: "no-such-branch" })).status, 400, "an unknown starting branch is a bad request");
});

test("the branch moving while you chose files is caught instead of stacking on a version you never saw", async () => {
  const seen = await tip("rhea/basin", "main");
  assert.equal((await upload("rhea/basin", "rhea", [{ name: "notes/a.txt", data: "first" }])).status, 201); // someone else got in first
  const stale = await upload("rhea/basin", "rhea", [{ name: "notes/b.txt", data: "second" }], { expected: seen! });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error.code, "stale_ref");
  const files = (await json("GET", "/repos/rhea/basin/paths/main", "rhea")).json.files.map((f: any) => f.path);
  assert.ok(!files.includes("notes/b.txt"), "the stale upload stored nothing");
});

test("files someone else has locked are refused, and nothing from that upload is kept", async () => {
  ctx.db.prepare("INSERT INTO collaborators (repo_id, user_id, role) VALUES ((SELECT id FROM repos WHERE name = 'basin'), (SELECT id FROM owners WHERE handle = 'ines'), 'Write') ON CONFLICT DO NOTHING").run();
  assert.equal((await json("POST", "/repos/rhea/basin/locks", "ines", { path: "model/plan.p01", reason: "recalibrating" })).status, 201);
  const chunksBefore = (ctx.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n;
  const before = await tip("rhea/basin", "main");
  const r = await upload("rhea/basin", "rhea", [{ name: "model/plan.p01", data: "someone else's lock" }, { name: "extra.bin", data: crypto.randomBytes(5000) }]);
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "locked");
  assert.match(r.json.error.message, /model\/plan\.p01 \(@ines\)/);
  assert.equal(await tip("rhea/basin", "main"), before);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number }).n, chunksBefore, "not even the other file's bytes were stored");
  assert.equal((await json("DELETE", "/repos/rhea/basin/locks/model%2Fplan.p01", "ines")).status, 204);
});

// ── Rules ──────────────────────────────────────────────────────────────────

test("bad requests: nothing chosen, mismatched paths, duplicates, and traversal", async () => {
  assert.equal((await upload("rhea/basin", "rhea", [])).status, 400);
  const form = new FormData();
  form.append("file", new File(["a"], "a.txt"));
  form.append("paths", JSON.stringify(["a.txt", "b.txt"]));
  const mismatch = await app.request("/v1/repos/rhea/basin/upload", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}` }, body: form });
  assert.equal(mismatch.status, 400);
  assert.equal((await upload("rhea/basin", "rhea", [{ name: "dup.txt", data: "1" }, { name: "dup.txt", data: "2" }])).status, 400);
  assert.equal((await upload("rhea/basin", "rhea", [{ name: "../escape.txt", data: "x" }])).status, 400);
  const notMultipart = await app.request("/v1/repos/rhea/basin/upload", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}`, "content-type": "application/json" }, body: "{}" });
  assert.equal(notMultipart.status, 400);
});

test("only people who can write may upload; strangers can't tell the repository exists", async () => {
  const files = [{ name: "sneaky.txt", data: "x" }];
  assert.equal((await upload("rhea/basin", "sol", files)).status, 403, "read-only");
  assert.equal((await upload("rhea/basin", "ines", files)).status, 201, "a writer can");
  const outsider = await upload("rhea/basin", null, files);
  assert.equal(outsider.status, 404);
  assert.equal((await upload("rhea/nope", "rhea", files)).status, 404);
});

test("the size limit is enforced, by the declared length and by what actually arrives", async () => {
  const limit = config.upload as { maxBytes: number };
  const saved = limit.maxBytes;
  limit.maxBytes = 50_000;
  try {
    const big = await upload("rhea/basin", "rhea", [{ name: "huge.bin", data: crypto.randomBytes(60_000) }]);
    assert.equal(big.status, 413);
    assert.match(big.json.error.message, /craton push/);
    assert.equal((await upload("rhea/basin", "rhea", [{ name: "ok/small.txt", data: crypto.randomBytes(2000) }])).status, 201);
  } finally {
    limit.maxBytes = saved;
  }
});

test("a push webhook fires for an upload, like for any push", async () => {
  const { listHooks, createHook } = await import("../src/services/webhooks.ts");
  (config.webhooks as { allowPrivate: boolean; autoDeliver: boolean }).allowPrivate = true;
  (config.webhooks as { allowPrivate: boolean; autoDeliver: boolean }).autoDeliver = false;
  const owner = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'rhea'").get() as { id: number };
  const repo = ctx.db.prepare("SELECT r.*, o.handle AS owner FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.name = 'basin'").get() as any;
  createHook(ctx, repo, owner.id, { url: "http://127.0.0.1:9/hook", events: ["push"] });
  assert.equal(listHooks(ctx, repo).length, 1);
  const r = await upload("rhea/basin", "rhea", [{ name: "hooked.txt", data: "ping" }]);
  assert.equal(r.status, 201, r.text);
  const event = ctx.db.prepare("SELECT payload FROM webhook_deliveries WHERE event = 'push' ORDER BY id DESC LIMIT 1").get() as { payload: string } | undefined;
  assert.ok(event, "a push delivery was queued");
  const data = JSON.parse(event!.payload).data;
  assert.deepEqual([data.branch, data.pusher, data.after], ["main", "rhea", r.json.commit]);
  assert.deepEqual(data.commits.map((c: any) => c.message), ["Upload hooked.txt"]);
});

// ── What an upload costs in storage ────────────────────────────────────────

/** A little-endian TIFF with no compression and one strip of smooth float32 samples (a raster-like file). */
function floatTiff(width: number, rows: number): Buffer {
  const tags: [number, number, number][] = [[256, 4, width], [257, 4, rows], [258, 3, 32], [259, 3, 1], [262, 3, 1], [277, 3, 1], [278, 4, rows], [339, 3, 3]];
  const dirSize = 2 + (tags.length + 2) * 12 + 4;
  const dataOffset = 8 + dirSize;
  const data = Buffer.alloc(width * rows * 4);
  for (let i = 0; i < width * rows; i++) data.writeFloatLE(120 + Math.sin(i / 900) * 30 + i * 0.0004, i * 4);
  const all = [...tags, [273, 4, dataOffset] as [number, number, number], [279, 4, data.length] as [number, number, number]].sort((a, b) => a[0] - b[0]);
  const head = Buffer.alloc(dataOffset);
  head.write("II", 0, "latin1");
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  head.writeUInt16LE(all.length, 8);
  all.forEach(([tag, type, value], i) => {
    const o = 10 + i * 12;
    head.writeUInt16LE(tag, o);
    head.writeUInt16LE(type, o + 2);
    head.writeUInt32LE(1, o + 4);
    if (type === 3) head.writeUInt16LE(value, o + 8);
    else head.writeUInt32LE(value, o + 8);
  });
  return Buffer.concat([head, data]);
}

test("an upload reports what it added to storage, and an uncompressed raster is stored byte-shuffled", async () => {
  assert.equal((await json("POST", "/repos", "rhea", { name: "rasters", visibility: "private" })).status, 201);
  const raster = floatTiff(256, 600); // about 600 KB
  const res = await upload("rhea/rasters", "rhea", [{ name: "terrain/dem.tif", data: raster }, { name: "notes/readme.txt", data: "Gauge notes, one line per visit.\n".repeat(200) }]);
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.bytes, raster.length + 33 * 200);
  assert.equal(res.json.newBytes, res.json.bytes, "everything was new");
  assert.ok(res.json.storedBytes > 0 && res.json.storedBytes < res.json.newBytes * 0.7, `stored ${res.json.storedBytes} of ${res.json.newBytes}`);
  // The raster's chunks carry the delta+shuffle encoding, and reading the file back gives the same bytes.
  const codecs = (ctx.db.prepare("SELECT DISTINCT codec FROM chunks").all() as { codec: string }[]).map((r) => r.codec);
  assert.ok(codecs.some((c) => c.includes("shuffle4")), `codecs: ${codecs.join(", ")}`);
  const raw = await app.request("/v1/repos/rhea/rasters/raw/main/terrain/dem.tif", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  assert.equal(raw.status, 200);
  assert.ok(Buffer.from(await raw.arrayBuffer()).equals(raster));
  // The same file again costs nothing new.
  const again = await upload("rhea/rasters", "rhea", [{ name: "terrain/dem2.tif", data: raster }]);
  assert.equal(again.status, 201, again.text);
  assert.equal(again.json.newBytes, 0);
  assert.equal(again.json.storedBytes, 0);
});
