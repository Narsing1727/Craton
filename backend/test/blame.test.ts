// Blame by chunk: which commit introduced each part of a file.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { geotiff } from "../src/dev/fixtures.ts";

let app: ReturnType<typeof createApp>;
let token = "";
const shas: string[] = [];

before(async () => {
  const ctx: Ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  const post = await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private" }) });
  assert.equal(post.status, 201);
  const owner = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'rhea'").get() as { id: number };
  const repo = getRepoFor(ctx, "rhea", "basin", owner.id, "write");
  const base = { width: 512, height: 512, epsg: 32643, nodata: -9999, seed: 5 };
  const commit = async (message: string, dem: Buffer, extra: Record<string, Buffer> = {}) => {
    const r = await commitFiles(ctx, repo, { branch: "main", author: "rhea", message, timestamp: new Date(Date.now() + shas.length * 1000), changes: { "terrain/dem.tif": dem, ...extra } });
    shas.push(r.id);
  };
  await commit("Initial import", geotiff(base));
  await commit("Unrelated change", geotiff(base), { "notes.txt": Buffer.from("hello") });
  await commit("Re-survey rows 300 to 340", geotiff({ ...base, resurvey: { from: 300, to: 340, offset: 0.4 } }));
});

const get = async (p: string) => {
  const res = await app.request(`/v1${p}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: (await res.json()) as any };
};

test("an unchanged file is wholly the first import; a re-survey claims only the strip it rewrote", async () => {
  const r = await get("/repos/rhea/basin/blame/main/terrain/dem.tif");
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const ranges = r.json.ranges as { start: number; end: number; commit: string; message: string; chunks: number }[];
  // Ranges tile the file exactly.
  assert.equal(ranges[0].start, 0);
  assert.equal(ranges.at(-1)!.end, r.json.size);
  for (let i = 1; i < ranges.length; i++) assert.equal(ranges[i].start, ranges[i - 1].end);
  const messages = new Set(ranges.map((x) => x.message));
  assert.ok(messages.has("Initial import"));
  assert.ok(messages.has("Re-survey rows 300 to 340"));
  assert.ok(!messages.has("Unrelated change"), "a commit that did not touch the file owns none of it");
  const resurvey = ranges.filter((x) => x.message === "Re-survey rows 300 to 340");
  const covered = resurvey.reduce((n, x) => n + (x.end - x.start), 0);
  assert.ok(covered > 0 && covered < r.json.size / 2, `${covered} of ${r.json.size} bytes`);
});

test("blame at an earlier commit attributes everything to what existed then", async () => {
  const r = await get(`/repos/rhea/basin/blame/${shas[1]}/terrain/dem.tif`);
  assert.equal(r.status, 200);
  assert.deepEqual([...new Set(r.json.ranges.map((x: any) => x.message))], ["Initial import"]);
  assert.equal(r.json.ranges.length, 1);
});

test("a missing file is a 404 and a new file belongs to the commit that added it", async () => {
  assert.equal((await get("/repos/rhea/basin/blame/main/nope.tif")).status, 404);
  const n = await get("/repos/rhea/basin/blame/main/notes.txt");
  assert.equal(n.status, 200);
  assert.equal(n.json.ranges.length, 1);
  assert.equal(n.json.ranges[0].message, "Unrelated change");
});

test("commits can be filtered by date and author and paged by offset", async () => {
  const all = (await get("/repos/rhea/basin/commits")).json as { sha: string; timestamp: string; author: string; message: string }[];
  assert.equal(all.length, 3);
  // Newest first; the fixture spaces its commits one second apart.
  const second = all[1].timestamp;
  const since = (await get(`/repos/rhea/basin/commits?since=${encodeURIComponent(second)}`)).json as { sha: string }[];
  assert.deepEqual(since.map((c) => c.sha), [all[0].sha, all[1].sha]);
  const until = (await get(`/repos/rhea/basin/commits?until=${encodeURIComponent(second)}`)).json as { sha: string }[];
  assert.deepEqual(until.map((c) => c.sha), [all[1].sha, all[2].sha]);
  const page = (await get("/repos/rhea/basin/commits?limit=1&offset=1")).json as { sha: string }[];
  assert.deepEqual(page.map((c) => c.sha), [all[1].sha]);
  assert.equal(((await get("/repos/rhea/basin/commits?author=nobody")).json as unknown[]).length, 0);
  assert.equal((await get("/repos/rhea/basin/commits?since=not-a-date")).status, 400);
});
