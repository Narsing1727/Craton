// First-run flows: sign-out, profile and onboarding state, password reset, the sample project,
// and the getting-started checklist.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { requestPasswordReset } from "../src/services/accounts.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

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
  return { status: res.status, json, text };
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const r = await call("POST", "/auth/signup", null, { username: "nina", email: "nina@example.org", password: "a-very-long-password" });
  assert.equal(r.status, 201, r.text);
  tokens.nina = r.json.token;
});

test("a new account starts un-onboarded, with only the account step done", async () => {
  const me = await call("GET", "/user", "nina");
  assert.equal(me.json.onboardedAt, null);
  assert.equal(me.json.name, "nina");
  const list = await call("GET", "/user/onboarding", "nina");
  assert.deepEqual(list.json.map((i: any) => [i.id, i.done]), [["account", true], ["repository", false], ["merge", false], ["cli", false], ["push", false]]);
});

test("profile updates are validated and onboarding completes once", async () => {
  assert.equal((await call("PATCH", "/user", "nina", { role: "astronaut" })).status, 400);
  assert.equal((await call("PATCH", "/user", "nina", { name: "   " })).status, 400);
  const saved = await call("PATCH", "/user", "nina", { name: "Nina Das", bio: "Floodplain mapping", role: "gis", onboarded: true });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.name, "Nina Das");
  assert.equal(saved.json.role, "gis");
  assert.ok(saved.json.onboardedAt);
  const again = await call("PATCH", "/user", "nina", { onboarded: true });
  assert.equal(again.json.onboardedAt, saved.json.onboardedAt, "the first completion time is kept");
});

test("the sample project is a real repository with checks and a pull request to review", async () => {
  const r = await call("POST", "/repos", "nina", { name: "sample-basin", visibility: "private", sample: true });
  assert.equal(r.status, 201, r.text);
  assert.ok(r.json.tags.includes("DEM") && r.json.tags.includes("HEC-RAS"));
  assert.ok(r.json.sizeBytes > 1_000_000);

  const files = (await call("GET", "/repos/nina/sample-basin/tree/main", "nina")).json.map((e: any) => e.path);
  assert.deepEqual(files.sort(), ["README.md", "gauges.csv", "model", "terrain", "vectors"]);
  const checks = (await call("GET", "/repos/nina/sample-basin/checks", "nina")).json;
  assert.ok(checks.length >= 2 && checks.every((c: any) => c.status === "passed"), JSON.stringify(checks.map((c: any) => c.status)));

  const pulls = (await call("GET", "/repos/nina/sample-basin/pulls", "nina")).json;
  assert.equal(pulls.length, 1);
  assert.equal(pulls[0].checks, "passed");
  // Only a few rows of the DEM changed, so only a few chunks are new.
  const cmp = (await call("GET", "/repos/nina/sample-basin/compare/main...sample-resurvey", "nina")).json;
  assert.deepEqual(cmp.changes.map((c: any) => c.path), ["terrain/basin_dem.tif"]);
  assert.ok(cmp.changes[0].chunks.shared > cmp.changes[0].chunks.added);

  // The importer's commits aren't the user's own push.
  let list = (await call("GET", "/user/onboarding", "nina")).json;
  assert.deepEqual(list.filter((i: any) => i.done).map((i: any) => i.id), ["account", "repository"]);

  // Merging the sample pull request checks off the review step.
  const merged = await call("POST", `/repos/nina/sample-basin/pulls/${pulls[0].number}/merge`, "nina", {});
  assert.equal(merged.status, 200, merged.text);
  list = (await call("GET", "/user/onboarding", "nina")).json;
  assert.ok(list.find((i: any) => i.id === "merge").done);
});

test("using a CLI token and pushing check off the last steps", async () => {
  const pat = await call("POST", "/user/tokens", "nina", { note: "laptop" });
  tokens.ninaPat = pat.json.token;
  await call("GET", "/user", "ninaPat");
  let list = (await call("GET", "/user/onboarding", "nina")).json;
  assert.ok(list.find((i: any) => i.id === "cli").done);
  assert.ok(!list.find((i: any) => i.id === "push").done);

  // Creating a branch in the app isn't a push; pushing a commit is.
  assert.equal((await call("POST", "/repos/nina/sample-basin/branches", "ninaPat", { name: "my-change", from: "main" })).status, 201);
  assert.ok(!(await call("GET", "/user/onboarding", "nina")).json.find((i: any) => i.id === "push").done);
  const ninaId = (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'nina'").get() as { id: number }).id;
  const repo = getRepoFor(ctx, "nina", "sample-basin", ninaId, "write");
  await commitFiles(ctx, repo, { branch: "my-change", author: "nina", message: "Add notes", timestamp: new Date(), changes: { "notes.md": Buffer.from("# Notes") } });
  list = (await call("GET", "/user/onboarding", "nina")).json;
  assert.ok(list.every((i: any) => i.done), JSON.stringify(list));
});

test("sign out revokes only that session", async () => {
  const second = await call("POST", "/auth/login", null, { login: "nina", password: "a-very-long-password" });
  tokens.ninaTwo = second.json.token;
  assert.equal((await call("POST", "/auth/logout", "ninaTwo")).status, 204);
  assert.equal((await call("GET", "/user", "ninaTwo")).status, 401);
  assert.equal((await call("GET", "/user", "nina")).status, 200);
  assert.equal((await call("GET", "/user", "ninaPat")).status, 200, "tokens aren't sessions");
});

test("password reset: same answer for unknown accounts, one-time link, signs out sessions", async () => {
  const unknown = await call("POST", "/auth/forgot", null, { login: "nobody@example.org" });
  const known = await call("POST", "/auth/forgot", null, { login: "nina@example.org" });
  assert.equal(unknown.status, 202);
  assert.equal(known.status, 202);
  assert.deepEqual(unknown.json, known.json);

  const reset = requestPasswordReset(ctx, "nina")!;
  assert.equal((await call("POST", "/auth/reset", null, { token: reset.token, password: "short" })).status, 400);
  const ok = await call("POST", "/auth/reset", null, { token: reset.token, password: "another-long-password" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await call("POST", "/auth/reset", null, { token: reset.token, password: "another-long-password" })).status, 400, "links work once");
  assert.equal((await call("GET", "/user", "nina")).status, 401, "old sessions are signed out");
  assert.equal((await call("POST", "/auth/login", null, { login: "nina", password: "a-very-long-password" })).status, 401);
  assert.equal((await call("POST", "/auth/login", null, { login: "nina", password: "another-long-password" })).status, 200);
});
