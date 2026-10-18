// "Must be locked before changing": the pattern matcher, and a push that touches a matching file without
// holding its lock being refused (while merges, unrelated files and the holder's own pushes are not).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { cleanPatterns, matchesAny, patternToRegExp } from "../src/core/globs.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

async function call(method: string, path: string, who: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${tokens[who]}` };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}
const repoOf = (who: string) => getRepoFor(ctx, "rhea", "basin", ids[who]);
const bytes = (s: string) => Buffer.from(s.repeat(2000));

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "sol"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ids[u] = (await ctx.db.get("SELECT id FROM owners WHERE handle = ?", u) as { id: number }).id;
  }
  const res = await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private", sample: true }) });
  assert.equal(res.status, 201);
});

test("patterns work like .gitignore: a bare name matches at any depth, a slash anchors it, ** crosses folders", () => {
  assert.ok(patternToRegExp("*.gdb").test("survey.gdb"));
  assert.ok(patternToRegExp("*.gdb").test("data/field/survey.gdb"));
  assert.ok(!patternToRegExp("*.gdb").test("survey.gdb.txt"));
  assert.ok(patternToRegExp("model/*.p0*").test("model/plan.p01"));
  assert.ok(!patternToRegExp("model/*.p0*").test("other/model/plan.p01"));
  assert.ok(!patternToRegExp("model/*.p0*").test("model/sub/plan.p01"), "* stays inside one folder");
  assert.ok(patternToRegExp("model/**/*.hdf").test("model/a/b/run.hdf"));
  assert.ok(patternToRegExp("model/**/*.hdf").test("model/run.hdf"), "** may match no folder at all");
  assert.ok(patternToRegExp("dem?.tif").test("dem1.tif"));
  assert.ok(patternToRegExp("*.G01").test("plan.g01"), "case does not matter");
  assert.ok(matchesAny(["*.shp", "*.dbf"], "vectors/catchment.dbf"));
});

test("pattern lists are cleaned, deduplicated and bounded", () => {
  assert.deepEqual(cleanPatterns("  *.gdb \n\n# a comment\n*.gdb\nmodel/*.p0*\n").patterns, ["*.gdb", "model/*.p0*"]);
  assert.ok(cleanPatterns(["../etc/passwd"]).problem);
  assert.ok(cleanPatterns(["a\\b"]).problem);
  assert.ok(cleanPatterns(Array.from({ length: 31 }, (_, i) => `f${i}.x`)).problem);
});

test("only repository admins can set the patterns, and they come back on the repository", async () => {
  assert.equal((await call("PATCH", "/repos/rhea/basin", "sol", { lockPatterns: ["*.p0*"] })).status, 404, "a stranger cannot even see the private repository");
  const ok = await call("PATCH", "/repos/rhea/basin", "rhea", { lockPatterns: ["model/*.p0*", "*.gdb"] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.lockPatterns, ["model/*.p0*", "*.gdb"]);
  const bad = await call("PATCH", "/repos/rhea/basin", "rhea", { lockPatterns: ["../x"] });
  assert.equal(bad.status, 400);
});

test("changing a matching file without holding its lock is refused; locking it first lets the push through", async () => {
  const repo = await repoOf("rhea");
  await assert.rejects(
    commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Edit plan", timestamp: new Date(), changes: { "model/plan.p01": bytes("a") } }),
    (err: any) => {
      assert.equal(err.status, 409);
      assert.equal(err.code, "lock_required");
      assert.match(err.message, /model\/plan\.p01/);
      return true;
    },
  );
  // A file that matches no pattern is unaffected.
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Readme", timestamp: new Date(), changes: { "README.md": bytes("b") } });
  // Hold the lock and the same change goes through.
  assert.equal((await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "model/plan.p01", reason: "recalibration" })).status, 201);
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Edit plan", timestamp: new Date(), changes: { "model/plan.p01": bytes("a") } });
});

test("somebody else holding the lock still refuses the push, with the holder's own message", async () => {
  await assert.rejects(
    commitFiles(ctx, await repoOf("rhea"), { branch: "main", author: "sol", message: "Edit plan", timestamp: new Date(), changes: { "model/plan.p01": bytes("c") } }),
    { code: "locked" },
  );
});

test("a trailing ** means everything inside the folder, at any depth", () => {
  assert.equal(patternToRegExp("terrain/**").test("terrain/basin_dem.tif"), true);
  assert.equal(patternToRegExp("terrain/**").test("terrain/raw/tile1.tif"), true);
  assert.equal(patternToRegExp("terrain/**").test("vectors/terrain/x.tif"), false, "anchored at the root");
  assert.equal(patternToRegExp("**/*.tif").test("a/b/c.tif"), true);
  assert.equal(patternToRegExp("**/*.tif").test("c.tif"), true);
});
