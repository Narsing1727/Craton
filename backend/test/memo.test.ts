// The cache for commit-keyed answers: the cache itself, then what it must never get wrong over the API (a new commit is a new answer, a stranger gets nothing).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { memoClear, memoJson, memoStats } from "../src/services/memo.ts";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { warmUp } from "../src/services/warmup.ts";

test("an answer is worked out once, then served from memory; a failure is not remembered", async () => {
  memoClear();
  let made = 0;
  const make = async () => ({ n: ++made });
  assert.equal(await memoJson("k1", make), '{"n":1}');
  assert.equal(await memoJson("k1", make), '{"n":1}');
  assert.equal(made, 1);
  assert.deepEqual([memoStats.hit, memoStats.miss], [1, 1]);

  let tries = 0;
  const flaky = async () => {
    if (++tries === 1) throw new Error("database away");
    return "fine";
  };
  await assert.rejects(memoJson("k2", flaky), /database away/);
  assert.equal(await memoJson("k2", flaky), '"fine"', "the next ask works it out again");
});

test("requests that arrive together share one computation", async () => {
  memoClear();
  let made = 0;
  const slow = async () => {
    made++;
    await new Promise((r) => setTimeout(r, 40));
    return { ok: true };
  };
  const all = await Promise.all(Array.from({ length: 12 }, () => memoJson("same", slow)));
  assert.equal(made, 1);
  assert.ok(all.every((t) => t === '{"ok":true}'));
  assert.equal(memoStats.shared, 11);
});

test("an answer expires, and the least recently used go first when it is full", async () => {
  memoClear();
  let made = 0;
  const make = async () => ({ n: ++made });
  await memoJson("short", make, 20);
  await new Promise((r) => setTimeout(r, 40));
  await memoJson("short", make, 20);
  assert.equal(made, 2, "worked out again after its time");

  memoClear();
  const big = async () => ({ text: "x".repeat(5 * 1024 * 1024) });
  for (let i = 0; i < 14; i++) await memoJson(`big${i}`, big);
  assert.ok(memoStats.evicted > 0, "older answers were dropped to stay within the limit");
  let again = 0;
  await memoJson("big13", async () => (again++, { text: "y" }));
  assert.equal(again, 0, "the newest is still there");
});

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const get = (path: string, who: string | null = "ann") => app.request(`/v1${path}`, { headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const [u, n] of [["ann", "Ann Archer"], ["bo", "Bo Brook"]] as const) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password", name: n }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  await ctx.db.run("UPDATE users SET email_verified_at = now_iso()");
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${tokens.ann}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private" }) })).status, 201);
});

test("trees, commits and file facts are remembered per commit, carry author names, and a new commit is a new answer", async () => {
  memoClear();
  const owner = (await ctx.db.get("SELECT id FROM owners WHERE handle = 'ann'")) as { id: number };
  const repo = await getRepoFor(ctx, "ann", "basin", owner.id);
  await commitFiles(ctx, repo, { branch: "main", author: "ann", message: "First", timestamp: new Date(), changes: { "a/one.csv": Buffer.from("x,y\n1,2\n"), "README.md": Buffer.from("# hi\n") } });

  const first = await (await get("/repos/ann/basin/tree/main?path=a")).json() as { name: string }[];
  assert.deepEqual(first.map((e) => e.name), ["one.csv"]);
  const hits = memoStats.hit;
  assert.deepEqual(await (await get("/repos/ann/basin/tree/main?path=a")).json(), first);
  assert.equal(memoStats.hit, hits + 1, "the second listing came from memory");

  // Commits carry the author's display name, in the list, on its own and on the repository summary: no second lookup needed.
  const list = await (await get("/repos/ann/basin/commits?changes=1&limit=10")).json() as { author: string; authorName: string; changes: unknown[] }[];
  assert.equal(list[0].author, "ann");
  assert.equal(list[0].authorName, "Ann Archer");
  assert.ok(list[0].changes.length > 0);
  const summary = await (await get("/repos/ann/basin")).json() as { head: { authorName: string }; commitCount: number; readme: string };
  assert.equal(summary.head.authorName, "Ann Archer");
  assert.equal(summary.commitCount, 1);
  assert.match(summary.readme, /# hi/);

  // A new commit moves the branch: the same address now gives the new answer, never the remembered one.
  await commitFiles(ctx, repo, { branch: "main", author: "ann", message: "Second", timestamp: new Date(), changes: { "a/two.csv": Buffer.from("x\n1\n") } });
  const second = await (await get("/repos/ann/basin/tree/main?path=a")).json() as { name: string }[];
  assert.deepEqual(second.map((e) => e.name).sort(), ["one.csv", "two.csv"]);
  const after = await (await get("/repos/ann/basin")).json() as { commitCount: number; head: { message: string } };
  assert.deepEqual([after.commitCount, after.head.message], [2, "Second"]);
  const log = await (await get("/repos/ann/basin/commits?limit=10")).json() as { message: string }[];
  assert.deepEqual(log.map((c) => c.message), ["Second", "First"]);
  const file = await (await get("/repos/ann/basin/file/main/a/two.csv")).json() as { path: string; table: { rows: number } };
  assert.equal(file.path, "a/two.csv");

  // Someone who may not see the repository gets nothing, whatever is remembered.
  for (const path of ["/repos/ann/basin/tree/main", "/repos/ann/basin/commits", "/repos/ann/basin/file/main/README.md", `/repos/ann/basin/commits/${(log as unknown as { sha: string }[])[0].sha}`]) {
    assert.equal((await get(path, "bo")).status, 404, `${path} stays private`);
    assert.equal((await get(path, null)).status, 404, `${path} stays private to visitors`);
  }
});

test("a changed display name shows within the half minute's memory being cleared, and responses say how long the server took", async () => {
  const res = await get("/repos/ann/basin");
  assert.match(res.headers.get("server-timing") ?? "", /^app;dur=\d+(\.\d)?$/);
  const patch = await app.request("/v1/user", { method: "PATCH", headers: { authorization: `Bearer ${tokens.ann}`, "content-type": "application/json" }, body: JSON.stringify({ name: "Ann A. Archer" }) });
  assert.equal(patch.status, 200);
  memoClear(); // the remembered answers also hold names, and are only ever as old as their time limit; a test does not wait for it
  const list = await (await get("/repos/ann/basin/commits?limit=1")).json() as { authorName: string }[];
  assert.equal(list[0].authorName, "Ann A. Archer");
});

test("?all=1 gives every folder's listing in one answer, the same as asking for them one at a time", async () => {
  memoClear();
  const owner = (await ctx.db.get("SELECT id FROM owners WHERE handle = 'ann'")) as { id: number };
  const repo = await getRepoFor(ctx, "ann", "basin", owner.id);
  await commitFiles(ctx, repo, { branch: "main", author: "ann", message: "Deep", timestamp: new Date(), changes: { "x/y/z/deep.csv": Buffer.from("a\n1\n"), "x/top.csv": Buffer.from("a\n1\n") } });
  const all = (await (await get("/repos/ann/basin/tree/main?all=1")).json()) as { folders: Record<string, { name: string; path: string; type: string; lastCommit?: { message: string } }[]>; truncated: boolean };
  assert.equal(all.truncated, false);
  assert.deepEqual(Object.keys(all.folders).sort(), ["", "a", "x", "x/y", "x/y/z"]);
  for (const dir of Object.keys(all.folders)) {
    const one = (await (await get(`/repos/ann/basin/tree/main?path=${encodeURIComponent(dir)}`)).json()) as typeof all.folders[string];
    assert.deepEqual(all.folders[dir], one, `"${dir}" lists the same either way, last commits included`);
  }
  assert.equal(all.folders["x/y/z"][0].lastCommit?.message, "Deep");
  assert.equal(all.folders[""].find((e) => e.path === "a")?.lastCommit?.message, "Second", "a folder's last commit is the newest one to touch anything in it");
  assert.equal((await get("/repos/ann/basin/tree/main?all=1", "bo")).status, 404);
});

test("the start-up warm-up reads what a visitor's pages read, so the first visitor is served from memory", async () => {
  // Public repositories are warmed; a private one is not touched.
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${tokens.ann}`, "content-type": "application/json" }, body: JSON.stringify({ name: "open-data", visibility: "public" }) })).status, 201);
  const owner = (await ctx.db.get("SELECT id FROM owners WHERE handle = 'ann'")) as { id: number };
  const repo = await getRepoFor(ctx, "ann", "open-data", owner.id);
  await commitFiles(ctx, repo, { branch: "main", author: "ann", message: "Open", timestamp: new Date(), changes: { "d/one.csv": Buffer.from("a" + String.fromCharCode(10) + "1" + String.fromCharCode(10)) } });
  memoClear();
  const lines: string[] = [];
  const result = await warmUp(app, ctx, { limit: 5, log: (l) => lines.push(l) });
  assert.equal(result.repositories, 1, "only the public repository");
  assert.ok(result.requests >= 6);
  assert.match(lines[0], /Warmed 1 repository/);
  const hits = memoStats.hit;
  const visitor = await app.request("/v1/repos/ann/open-data/tree/main?all=1");
  assert.equal(visitor.status, 200);
  const commits = await app.request("/v1/repos/ann/open-data/commits?changes=1&limit=100&ref=main");
  assert.equal(commits.status, 200);
  assert.equal(memoStats.hit, hits + 2, "both answers were already remembered");
  // Nothing to warm, or something broken, never throws.
  const none = await warmUp({ request: () => { throw new Error("away"); } }, ctx);
  assert.equal(none.repositories, 0);
});

test("the repository summary names the raster its page previews (the shallowest GeoTIFF), so the page can ask for its picture straight away", async () => {
  const owner = (await ctx.db.get("SELECT id FROM owners WHERE handle = 'ann'")) as { id: number };
  const repo = await getRepoFor(ctx, "ann", "open-data", owner.id);
  const before = (await (await app.request("/v1/repos/ann/open-data")).json()) as { previewPath: string | null };
  assert.equal(before.previewPath, null, "no raster yet");
  await commitFiles(ctx, repo, { branch: "main", author: "ann", message: "Rasters", timestamp: new Date(), changes: { "deep/er/b.tif": Buffer.from("not really"), "terrain/a.tiff": Buffer.from("not really"), "z.tif": Buffer.from("not really") } });
  const after = (await (await app.request("/v1/repos/ann/open-data")).json()) as { previewPath: string | null };
  assert.equal(after.previewPath, "z.tif", "the shallowest one, and the new commit gives a new answer");
});
