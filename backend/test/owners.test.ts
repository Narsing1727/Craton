// CODEOWNERS: parsing, last-match-wins, and review requests made automatically when a pull request opens.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { ownersForPaths, ownersOf, parseOwners } from "../src/services/owners.ts";

const FILE = `# terrain belongs to the survey team
terrain/**        @priyam @Arjun
*.shp             @lakshmi     # shapefiles
gauges.csv        @arjun
terrain/raw/**    @lakshmi
not a rule line
`;

test("rules are parsed, comments and malformed lines skipped, handles lower-cased", () => {
  const rules = parseOwners(FILE);
  assert.deepEqual(rules.map((r) => [r.pattern, r.owners]), [
    ["terrain/**", ["priyam", "arjun"]],
    ["*.shp", ["lakshmi"]],
    ["gauges.csv", ["arjun"]],
    ["terrain/raw/**", ["lakshmi"]],
  ]);
  assert.deepEqual(parseOwners(null), []);
});

test("the last matching rule wins, and files nobody owns have no owner", () => {
  const rules = parseOwners(FILE);
  assert.deepEqual(ownersOf(rules, "terrain/basin_dem.tif"), ["priyam", "arjun"]);
  assert.deepEqual(ownersOf(rules, "terrain/raw/tile1.tif"), ["lakshmi"], "the later, more specific rule overrides");
  assert.deepEqual(ownersOf(rules, "vectors/catchment.shp"), ["lakshmi"]);
  assert.deepEqual(ownersOf(rules, "README.md"), []);
  const by = ownersForPaths(rules, ["terrain/a.tif", "terrain/raw/b.tif", "gauges.csv", "README.md"]);
  assert.deepEqual(by.map((o) => [o.handle, o.files]), [["arjun", ["terrain/a.tif", "gauges.csv"]], ["lakshmi", ["terrain/raw/b.tif"]], ["priyam", ["terrain/a.tif"]]]);
});

let app: ReturnType<typeof createApp>;
let ctx: Ctx;
const tokens: Record<string, string> = {};

async function call(who: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${tokens[who]}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "arjun", "lakshmi", "outsider"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  assert.equal((await call("rhea", "POST", "/repos", { name: "basin", visibility: "private" })).status, 201);
  // Sharing needs a confirmed email.
  ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = 'rhea')").run(new Date().toISOString());
  for (const u of ["arjun", "lakshmi"]) assert.equal((await call("rhea", "PUT", `/repos/rhea/basin/collaborators/${u}`, { role: "Write" })).status, 201);
  const rhea = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'rhea'").get() as { id: number };
  const repo = getRepoFor(ctx, "rhea", "basin", rhea.id, "write");
  await commitFiles(ctx, repo, {
    branch: "main", author: "rhea", message: "Initial", timestamp: new Date(),
    changes: { "CODEOWNERS": Buffer.from("terrain/** @arjun\n*.shp @lakshmi\n*.md @outsider @rhea\n"), "terrain/a.tif": Buffer.from("a"), "vectors/c.shp": Buffer.from("c"), "README.md": Buffer.from("r") },
  });
  await commitFiles(ctx, repo, { branch: "feature", from: "main", author: "rhea", message: "Edit terrain and a shapefile", timestamp: new Date(), changes: { "terrain/a.tif": Buffer.from("a2"), "vectors/c.shp": Buffer.from("c2") } });
});

test("opening a pull request asks the owners of the changed files, and reports who", async () => {
  const made = await call("rhea", "POST", "/repos/rhea/basin/pulls", { title: "Terrain and shapes", source: "feature" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual([...made.json.ownersAsked].sort(), ["arjun", "lakshmi"]);
  assert.deepEqual([...made.json.reviewRequests.map((r: any) => r.handle ?? r)].sort(), ["arjun", "lakshmi"]);
});

test("the owners endpoint lists each owner with their files and where they stand", async () => {
  const r = await call("rhea", "GET", "/repos/rhea/basin/pulls/1/owners");
  assert.equal(r.status, 200);
  const by = new Map<string, any>(r.json.map((o: any) => [o.handle, o]));
  assert.deepEqual(by.get("arjun").files, ["terrain/a.tif"]);
  assert.deepEqual(by.get("lakshmi").files, ["vectors/c.shp"]);
  assert.equal(by.get("arjun").requested, true);
  assert.equal(by.get("arjun").state, null);
  // After a review, the owner's state shows.
  assert.equal((await call("arjun", "POST", "/repos/rhea/basin/pulls/1/reviews", { state: "approved" })).status, 200);
  const after = await call("rhea", "GET", "/repos/rhea/basin/pulls/1/owners");
  assert.equal(after.json.find((o: any) => o.handle === "arjun").state, "approved");
});

test("the author and people who cannot see the repository are never asked", async () => {
  const rhea = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'rhea'").get() as { id: number };
  const repo = getRepoFor(ctx, "rhea", "basin", rhea.id, "write");
  await commitFiles(ctx, repo, { branch: "docs", from: "main", author: "rhea", message: "Docs", timestamp: new Date(), changes: { "README.md": Buffer.from("r2") } });
  const made = await call("rhea", "POST", "/repos/rhea/basin/pulls", { title: "Docs only", source: "docs" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  // README.md is owned by @outsider (no access to this private repository) and @rhea (the author).
  assert.deepEqual(made.json.ownersAsked, []);
});

test("with owner approval required, merging waits for every owner and for approvals of the current head", async () => {
  assert.equal((await call("rhea", "PATCH", "/repos/rhea/basin", { requireOwnerReview: true, requireChecks: false })).status, 200);
  // Pull request 1 changes terrain (arjun, approved) and a shapefile (lakshmi, not yet).
  const blocked = await call("rhea", "POST", "/repos/rhea/basin/pulls/1/merge");
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error.code, "owner_review_required");
  assert.match(blocked.json.error.message, /@lakshmi/);
  assert.doesNotMatch(blocked.json.error.message, /@arjun/);
  assert.equal((await call("lakshmi", "POST", "/repos/rhea/basin/pulls/1/reviews", { state: "approved" })).status, 200);
  const merged = await call("rhea", "POST", "/repos/rhea/basin/pulls/1/merge");
  assert.equal(merged.status, 200, JSON.stringify(merged.json));
});

test("an approval of an earlier version of the branch no longer counts", async () => {
  const rhea = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'rhea'").get() as { id: number };
  const repo = getRepoFor(ctx, "rhea", "basin", rhea.id, "write");
  await commitFiles(ctx, repo, { branch: "terr2", from: "main", author: "rhea", message: "Terrain again", timestamp: new Date(), changes: { "terrain/a.tif": Buffer.from("a3") } });
  const made = await call("rhea", "POST", "/repos/rhea/basin/pulls", { title: "Terrain again", source: "terr2" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const n = made.json.number;
  assert.equal((await call("arjun", "POST", `/repos/rhea/basin/pulls/${n}/reviews`, { state: "approved" })).status, 200);
  const ok = await call("rhea", "GET", `/repos/rhea/basin/pulls/${n}/owners`);
  assert.equal(ok.json[0].state, "approved");
  assert.equal(ok.json[0].current, true);
  // The branch moves on after the approval.
  await commitFiles(ctx, repo, { branch: "terr2", author: "rhea", message: "One more change", timestamp: new Date(), changes: { "terrain/a.tif": Buffer.from("a4") } });
  const stale = await call("rhea", "GET", `/repos/rhea/basin/pulls/${n}/owners`);
  assert.equal(stale.json[0].current, false);
  const blocked = await call("rhea", "POST", `/repos/rhea/basin/pulls/${n}/merge`);
  assert.equal(blocked.status, 409);
  assert.match(blocked.json.error.message, /@arjun/);
});

test("a preview says who would own how much, who is not a person here, and what nobody owns", async () => {
  const text = "terrain/** @arjun @ghost\n*.shp @outsider\nbad line without owner\n";
  const r = await call("rhea", "POST", "/repos/rhea/basin/owners/preview", { text });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.rules, 2);
  const by = new Map<string, any>(r.json.people.map((p: any) => [p.handle, p]));
  assert.equal(by.get("arjun").problem, null);
  assert.ok(by.get("arjun").files >= 1);
  assert.match(by.get("ghost").problem, /No person/);
  assert.match(by.get("outsider").problem, /Cannot see/);
  assert.equal(r.json.skipped.length, 1);
  assert.equal(r.json.skipped[0].line, 3);
  assert.ok(r.json.unowned >= 1, "README.md has no rule in this text");
  assert.equal((await call("rhea", "POST", "/repos/rhea/basin/owners/preview", {})).status, 400);
  assert.equal((await call("outsider", "POST", "/repos/rhea/basin/owners/preview", { text })).status, 404, "a private repository stays hidden");
});
