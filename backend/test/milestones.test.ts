// Milestones: real records per repository, who may change them, and how issues follow them.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

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
  for (const u of ["alice", "bob", "carol", "dave"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "private" })).status, 201);
  const repo = ctx.db.prepare("SELECT id FROM repos WHERE name = 'basin'").get() as { id: number };
  const grant = ctx.db.prepare("INSERT INTO collaborators (repo_id, user_id, role) VALUES (?, (SELECT id FROM owners WHERE handle = ?), ?)");
  grant.run(repo.id, "bob", "Write");
  grant.run(repo.id, "carol", "Read");
});

const titles = async () => ((await call("GET", "/repos/alice/basin/milestones", "alice")).json as { title: string }[]).map((m) => m.title);

test("a writer creates milestones; the list puts open ones by due date, undated after, closed last", async () => {
  for (const m of [{ title: "Undated" }, { title: "v2.0", due: "2026-12-31" }, { title: "v1.3", due: "2026-03-01", description: "Calibration" }]) {
    const res = await call("POST", "/repos/alice/basin/milestones", "bob", m);
    assert.equal(res.status, 201, res.text);
    assert.equal(res.json.state, "open");
    assert.deepEqual([res.json.open, res.json.closed], [0, 0]);
  }
  assert.deepEqual(await titles(), ["v1.3", "v2.0", "Undated"]);
  const closed = (await call("POST", "/repos/alice/basin/milestones", "alice", { title: "Old", due: "2025-01-01" })).json;
  assert.equal((await call("PATCH", `/repos/alice/basin/milestones/${closed.id}`, "alice", { state: "closed" })).json.state, "closed");
  assert.deepEqual(await titles(), ["v1.3", "v2.0", "Undated", "Old"], "closed goes last whatever its date");
});

test("who may do what", async () => {
  assert.equal((await call("POST", "/repos/alice/basin/milestones", "carol", { title: "Nope" })).status, 403, "a reader can't create");
  assert.equal((await call("POST", "/repos/alice/basin/milestones", null, { title: "Nope" })).status, 401);
  assert.equal((await call("POST", "/repos/alice/basin/milestones", "dave", { title: "Nope" })).status, 404, "a stranger can't even tell the repository exists");
  assert.equal((await call("GET", "/repos/alice/basin/milestones", "carol")).status, 200, "a reader can look");
  assert.equal((await call("GET", "/repos/alice/basin/milestones", "dave")).status, 404);
  assert.equal((await call("DELETE", "/repos/alice/basin/milestones/1", "carol")).status, 403);
  assert.equal((await call("PATCH", "/repos/alice/basin/milestones/1", "carol", { title: "x" })).status, 403);
});

test("titles and dates are checked, and a title is unique whatever its case", async () => {
  const bad = (b: unknown) => call("POST", "/repos/alice/basin/milestones", "alice", b);
  assert.equal((await bad({})).status, 400);
  assert.equal((await bad({ title: "   " })).status, 400);
  assert.equal((await bad({ title: "x".repeat(61) })).status, 400);
  assert.equal((await bad({ title: "Dated", due: "31/12/2026" })).status, 400);
  assert.equal((await bad({ title: "Dated", due: "2026-02-30" })).status, 400, "a day that doesn't exist");
  const dup = await bad({ title: "  V1.3 " });
  assert.equal(dup.status, 409, "same title, different case and spacing");
  assert.match(dup.json.error.message, /already a milestone/);
  assert.equal((await bad({ title: "Dated", due: "2026-02-28" })).status, 201);
  assert.equal((await call("GET", "/repos/alice/basin/milestones/999", "alice")).status, 404);
  assert.equal((await call("PATCH", "/repos/alice/basin/milestones/9999", "alice", { title: "z" })).status, 404);
  assert.equal((await call("PATCH", "/repos/alice/basin/milestones/1", "alice", { state: "paused" })).status, 400);
});

test("an issue can only be given a milestone that exists and is open, and only a writer chooses one", async () => {
  const open = async (who: string, milestone?: string | null) => call("POST", "/repos/alice/basin/issues", who, { title: "Gauge drift", label: "bug", ...(milestone === undefined ? {} : { milestone }) });
  const ok = await open("bob", "v1.3");
  assert.equal(ok.status, 201, ok.text);
  assert.equal(ok.json.milestone, "v1.3");
  assert.equal((await open("bob", "v9.9")).status, 400, "no such milestone");
  assert.match((await open("bob", "v9.9")).json.error.message, /no milestone called/);
  assert.equal((await open("bob", "Old")).status, 400, "closed milestone");
  assert.equal((await open("carol", "v1.3")).status, 403, "a reader reporting a problem can't pick a milestone");
  const plain = await open("carol");
  assert.equal(plain.status, 201, "but can still open an issue");
  assert.equal(plain.json.milestone, null);
  assert.equal((await open("bob", "")).json.milestone, null, "empty means none");
  // The counts follow the issues.
  const m = ((await call("GET", "/repos/alice/basin/milestones", "alice")).json as any[]).find((x) => x.title === "v1.3");
  assert.deepEqual([m.open, m.closed], [1, 0]);
  await call("PATCH", `/repos/alice/basin/issues/${ok.json.number}`, "bob", { state: "closed" });
  const after = ((await call("GET", "/repos/alice/basin/milestones", "alice")).json as any[]).find((x) => x.title === "v1.3");
  assert.deepEqual([after.open, after.closed], [0, 1]);
});

test("changing an issue's milestone later, and clearing it", async () => {
  const n = (await call("POST", "/repos/alice/basin/issues", "bob", { title: "Move me", milestone: "v1.3" })).json.number;
  assert.equal((await call("PATCH", `/repos/alice/basin/issues/${n}`, "bob", { milestone: "v2.0" })).json.milestone, "v2.0");
  assert.equal((await call("PATCH", `/repos/alice/basin/issues/${n}`, "bob", { milestone: "nope" })).status, 400);
  assert.equal((await call("GET", `/repos/alice/basin/issues/${n}`, "bob")).json.milestone, "v2.0", "a refused change changed nothing");
  assert.equal((await call("PATCH", `/repos/alice/basin/issues/${n}`, "bob", { milestone: null })).json.milestone, null);
  assert.equal((await call("PATCH", `/repos/alice/basin/issues/${n}`, "carol", { milestone: "v2.0" })).status, 403);
});

test("renaming a milestone renames it on its issues; deleting only un-assigns them", async () => {
  const list = (await call("GET", "/repos/alice/basin/milestones", "alice")).json as { id: number; title: string }[];
  const v2 = list.find((m) => m.title === "v2.0")!;
  const n = (await call("POST", "/repos/alice/basin/issues", "bob", { title: "Terrain", milestone: "v2.0" })).json.number;
  const renamed = await call("PATCH", `/repos/alice/basin/milestones/${v2.id}`, "bob", { title: "v2.0 terrain", due: "2027-01-31", description: "New LiDAR" });
  assert.equal(renamed.status, 200, renamed.text);
  assert.deepEqual([renamed.json.title, renamed.json.due, renamed.json.description, renamed.json.open], ["v2.0 terrain", "2027-01-31", "New LiDAR", 1]);
  assert.equal((await call("GET", `/repos/alice/basin/issues/${n}`, "bob")).json.milestone, "v2.0 terrain");
  assert.equal((await call("PATCH", `/repos/alice/basin/milestones/${v2.id}`, "bob", { title: "v1.3" })).status, 409, "can't rename onto another");
  assert.equal((await call("PATCH", `/repos/alice/basin/milestones/${v2.id}`, "bob", { title: "V2.0 TERRAIN" })).status, 200, "changing only the case of its own title is fine");
  assert.equal((await call("PATCH", `/repos/alice/basin/milestones/${v2.id}`, "bob", { due: null })).json.due, null, "the date can be cleared");

  const gone = await call("DELETE", `/repos/alice/basin/milestones/${v2.id}`, "bob");
  assert.equal(gone.status, 200);
  assert.equal(gone.json.unassigned, 1);
  const issue = (await call("GET", `/repos/alice/basin/issues/${n}`, "bob")).json;
  assert.equal(issue.state, "open", "the issue is still there");
  assert.equal(issue.milestone, null);
  assert.ok(!(await titles()).some((t) => /v2\.0/i.test(t)));
});

test("milestones belong to their repository", async () => {
  assert.equal((await call("POST", "/repos", "dave", { name: "other", visibility: "private" })).status, 201);
  assert.deepEqual(((await call("GET", "/repos/dave/other/milestones", "dave")).json), [], "a new repository starts with none");
  const res = await call("POST", "/repos/dave/other/issues", "dave", { title: "x", milestone: "v1.3" });
  assert.equal(res.status, 400, "another repository's milestone isn't available here");
});

test("deleting a repository removes its milestones", async () => {
  assert.equal((await call("DELETE", "/repos/dave/other", "dave", {})).status, 204);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM milestones WHERE repo_id NOT IN (SELECT id FROM repos)").get() as { n: number }).n, 0);
});
