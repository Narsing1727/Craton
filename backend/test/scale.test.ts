// Lists that must stay fast on a big installation are done by the database, not by loading everything: they must still say exactly what the
// one-at-a-time rules say. Access in SQL is checked against repoAccess for every person and repository; pages, counts and feeds against
// what was created.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { repoAccess } from "../src/services/accounts.ts";
import { findRepo, listRepos, repoPage } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { backfillPaths } from "../src/services/history.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};
const PEOPLE = ["ann", "bo", "cy", "di", "ed"];

async function call(method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, total: res.headers.get("x-total-count") };
}

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of PEOPLE) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ids[u] = (await ctx.db.get<{ id: number }>("SELECT id FROM owners WHERE handle = ?", u))!.id;
    await ctx.db.run("UPDATE users SET email_verified_at = now_iso() WHERE owner_id = ?", ids[u]);
  }
  // ann: two public and two private repositories. An organization (owned by bo, with cy as a member) has one of each.
  for (const [name, visibility] of [["open-a", "public"], ["open-b", "public"], ["secret-a", "private"], ["secret-b", "private"]]) {
    assert.equal((await call("POST", "/repos", "ann", { name, visibility })).status, 201);
  }
  assert.equal((await call("POST", "/orgs", "bo", { handle: "labs", name: "Labs" })).status, 201);
  await ctx.db.run("INSERT INTO memberships (org_id, user_id, role) VALUES ((SELECT id FROM owners WHERE handle = 'labs'), ?, 'Member')", ids.cy);
  for (const [name, visibility] of [["pub", "public"], ["priv", "private"]]) assert.equal((await call("POST", "/repos", "bo", { owner: "labs", name, visibility })).status, 201);
  // di is invited to one of ann's private repositories.
  const secret = await ctx.db.get<{ id: number }>("SELECT r.id FROM repos r WHERE r.name = 'secret-b'");
  await ctx.db.run("INSERT INTO collaborators (repo_id, user_id, role) VALUES (?, ?, 'Read')", secret!.id, ids.di);
});

test("access decided in SQL agrees with repoAccess for every person and every repository", async () => {
  const everything = await ctx.db.all<{ id: number; owner_id: number; visibility: "public" | "private"; owner: string; name: string }>("SELECT r.id, r.owner_id, r.visibility, o.handle AS owner, r.name FROM repos r JOIN owners o ON o.id = r.owner_id");
  assert.equal(everything.length, 6);
  for (const viewer of [null, ...PEOPLE]) {
    const uid = viewer === null ? null : ids[viewer];
    const expected = [];
    for (const r of everything) if ((await repoAccess(ctx, r, uid)) !== "none") expected.push(`${r.owner}/${r.name}`);
    const got = (await listRepos(ctx, uid)).map((r) => `${r.owner}/${r.name}`);
    assert.deepEqual([...got].sort(), expected.sort(), `what ${viewer ?? "a visitor"} sees`);
  }
  // Spot checks in words: a member of an organization sees its private repository; an invited person sees only the one they were invited to.
  const names = async (u: string) => (await listRepos(ctx, ids[u])).map((r) => `${r.owner}/${r.name}`).sort();
  assert.ok((await names("cy")).includes("labs/priv"));
  assert.ok(!(await names("ed")).includes("labs/priv"));
  assert.deepEqual((await names("di")).filter((n) => n.includes("secret")), ["ann/secret-b"]);
});

test("repository pages: limit, offset and the total, in newest-first order, with the same filters as before", async () => {
  const everyone = await call("GET", "/repos", "cy");
  const total = Number(everyone.total);
  const first = await call("GET", "/repos?limit=2&offset=0", "cy");
  const second = await call("GET", "/repos?limit=2&offset=2", "cy");
  assert.equal(first.json.length, 2);
  assert.equal(second.json.length, 2);
  assert.equal(first.total, String(total));
  assert.deepEqual([...first.json, ...second.json].map((r: any) => `${r.owner}/${r.name}`), everyone.json.slice(0, 4).map((r: any) => `${r.owner}/${r.name}`), "pages are slices of the same order");
  assert.equal((await call("GET", "/repos?owner=ann", "cy")).json.length, 2, "cy is not ann's collaborator: only her public ones");
  assert.equal((await call("GET", "/repos?q=SECRET", "ann")).json.length, 2, "text search ignores case");
  assert.equal((await call("GET", "/repos?q=secret", null)).json.length, 0, "and never finds what a visitor may not see");
  assert.equal((await call("GET", "/repos?q=100%25", "ann")).json.length, 0, "a percent sign is a character, not a wildcard");
  const page = await repoPage(ctx, ids.ann, { owners: ["ann"] }, { limit: 10, offset: 0 });
  assert.equal(page.total, 4);
  assert.deepEqual((await repoPage(ctx, ids.ann, { owners: [] })).rows, [], "no owners, no repositories");
});

test("issues: pages, totals, comment counts and people come out right however they are fetched", async () => {
  for (let i = 1; i <= 7; i++) assert.equal((await call("POST", "/repos/ann/open-a/issues", i % 2 ? "ann" : "bo", { title: `Issue ${i}`, assignee: i === 3 ? "cy" : undefined })).status, 201);
  assert.equal((await call("POST", "/repos/ann/open-a/issues/2/comments", "cy", { body: "one" })).status, 201);
  assert.equal((await call("POST", "/repos/ann/open-a/issues/2/comments", "ann", { body: "two" })).status, 201);
  assert.equal((await call("POST", "/repos/ann/open-a/issues/5/comments", "bo", { body: "three" })).status, 201);
  assert.equal((await call("PATCH", "/repos/ann/open-a/issues/4", "ann", { state: "closed" })).status, 200);

  const all = await call("GET", "/repos/ann/open-a/issues", null);
  assert.deepEqual(all.json.map((i: any) => i.number), [7, 6, 5, 4, 3, 2, 1], "newest first");
  assert.equal(all.total, "7");
  const byNumber = Object.fromEntries(all.json.map((i: any) => [i.number, i]));
  assert.deepEqual([byNumber[2].comments, byNumber[5].comments, byNumber[1].comments], [2, 1, 0]);
  assert.deepEqual([byNumber[1].author, byNumber[2].author, byNumber[3].assignee, byNumber[1].assignee], ["ann", "bo", "cy", null]);

  const page = await call("GET", "/repos/ann/open-a/issues?limit=3&offset=2", null);
  assert.deepEqual(page.json.map((i: any) => i.number), [5, 4, 3]);
  assert.equal(page.total, "7");
  assert.deepEqual((await call("GET", "/repos/ann/open-a/issues?state=closed", null)).json.map((i: any) => i.number), [4]);
  assert.equal((await call("GET", "/repos/ann/open-a/issues?state=open", null)).total, "6");
  assert.equal((await call("GET", "/repos/ann/open-a", "ann")).json.openIssues, 6, "the repository page counts without reading them");
});

test("issues across repositories: only what the viewer can read, newest activity first, with the repository named", async () => {
  assert.equal((await call("POST", "/repos/ann/secret-a/issues", "ann", { title: "A private matter" })).status, 201);
  assert.equal((await call("POST", "/repos/labs/pub/issues", "bo", { title: "In the open" })).status, 201);
  const seenByEd = (await call("GET", "/issues", "ed")).json as { title: string; repo: string }[];
  assert.ok(seenByEd.some((i) => i.repo === "labs/pub" && i.title === "In the open"));
  assert.ok(!seenByEd.some((i) => i.repo === "ann/secret-a"), "ed cannot read that repository");
  const seenByAnn = (await call("GET", "/issues", "ann")).json as { title: string; repo: string; updatedAt: string }[];
  assert.ok(seenByAnn.some((i) => i.repo === "ann/secret-a"));
  assert.deepEqual(seenByAnn.map((i) => i.updatedAt), [...seenByAnn.map((i) => i.updatedAt)].sort().reverse(), "newest first");
  assert.equal((await call("GET", "/issues?limit=2", "ann")).json.length, 2);
  assert.ok((await call("GET", "/issues?state=closed", "ann")).json.every((i: any) => i.number === 4));
});

test("trending ranks by stars gained in the period, public repositories only, and says what the viewer starred", async () => {
  assert.equal((await call("PUT", "/repos/ann/open-b/star", "cy")).status < 300, true);
  assert.equal((await call("PUT", "/repos/ann/open-b/star", "di")).status < 300, true);
  assert.equal((await call("PUT", "/repos/ann/open-a/star", "di")).status < 300, true);
  const t = (await call("GET", "/trending", "cy")).json as { owner: string; name: string; gained: number; starred: boolean }[];
  assert.equal(`${t[0].owner}/${t[0].name}`, "ann/open-b");
  assert.equal(t[0].gained, 2);
  assert.equal(t[0].starred, true);
  assert.ok(!t.some((r) => r.name.startsWith("secret") || r.name === "priv"), "nothing private");
  const mine = (await call("GET", "/user/starred", "di")).json as { name: string }[];
  assert.deepEqual(mine.map((r) => r.name).sort(), ["open-a", "open-b"]);
});

test("search is bounded and the same for text, people and files", async () => {
  const r = (await call("GET", "/search?q=ann", "ann")).json;
  assert.ok(r.people.some((p: any) => p.handle === "ann"));
  assert.ok(r.repositories.every((x: any) => x.owner === "ann" || /ann/i.test(`${x.name} ${x.description}`)));
  assert.equal((await call("GET", "/search?q=labs", null)).json.organizations[0].handle, "labs");
  assert.deepEqual((await call("GET", "/search?q=zzzz-nothing", "ann")).json.repositories, []);
});

test("file names are found through the index: case-blind, literal wildcards, only where the viewer may look, following pushes and the backfill", async () => {
  const open = await findRepo(ctx, "ann", "open-a");
  const secret = await findRepo(ctx, "ann", "secret-a");
  const push = (repo: typeof open, changes: Record<string, Buffer | null>, message: string) => commitFiles(ctx, repo, { branch: "main", author: "ann", message, timestamp: new Date(), changes });
  await push(open, { "terrain/basin_dem.tif": Buffer.from("x".repeat(100)), "notes/Readme_100%.md": Buffer.from("y") }, "add");
  await push(secret, { "keys/server.pem": Buffer.from("k") }, "add key");
  const files = async (q: string, who: string | null) => ((await call("GET", `/search?q=${encodeURIComponent(q)}`, who)).json.files as { repo: string; path: string }[]).map((f) => `${f.repo}:${f.path}`);

  assert.deepEqual(await files("BASIN_DEM", "ann"), ["ann/open-a:terrain/basin_dem.tif"], "case does not matter");
  assert.deepEqual(await files("100%", "ann"), ["ann/open-a:notes/Readme_100%.md"], "a percent sign is a character");
  assert.deepEqual(await files("basin", null), ["ann/open-a:terrain/basin_dem.tif"], "a visitor finds files of public repositories");
  assert.deepEqual(await files("server.pem", null), [], "and not of private ones");
  assert.deepEqual(await files("server.pem", "ed"), []);
  assert.deepEqual(await files("server.pem", "ann"), ["ann/secret-a:keys/server.pem"]);

  await push(open, { "terrain/basin_dem.tif": null, "terrain/new_dem.tif": Buffer.from("z") }, "swap");
  assert.deepEqual(await files("dem", "ann"), ["ann/open-a:terrain/new_dem.tif"], "the index follows the default branch");

  // An installation from before the index: nothing indexed, then the backfill catches up.
  await ctx.db.run("DELETE FROM repo_paths");
  await ctx.db.run("UPDATE repos SET paths_at = NULL");
  assert.deepEqual(await files("dem", "ann"), []);
  assert.ok((await backfillPaths(ctx)) >= 6);
  assert.deepEqual(await files("dem", "ann"), ["ann/open-a:terrain/new_dem.tif"]);
  assert.ok((await ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM repos WHERE paths_at IS NULL"))!.n === 0, "repositories with nothing committed are marked done too");
});
