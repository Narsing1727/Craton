// The audit log and the per-token request log: what is recorded, who may read it, and what is never written down.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { eventsCsv, labelFor } from "../src/services/audit.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who: string | null, body?: unknown, token?: string) {
  const headers: Record<string, string> = {};
  const bearer = token ?? (who ? tokens[who] : null);
  if (bearer) headers.authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, res };
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol", "dave"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(new Date().toISOString(), u);
  }
  assert.equal((await call("POST", "/orgs", "alice", { handle: "lab", name: "Lab" })).status, 201);
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "private", owner: "lab" })).status, 201);
  assert.equal((await call("PUT", "/repos/lab/basin/collaborators/bob", "alice", { role: "Write" })).status, 201);
  assert.equal((await call("PUT", "/repos/lab/basin/collaborators/carol", "alice", { role: "Read" })).status, 201);
});

const events = async (who: string, path = "/orgs/lab/audit-log") => (await call("GET", path, who)).json as { events: any[]; next: number | null };

test("labels are plain sentences for the common routes and fall back to the route itself", () => {
  assert.equal(labelFor("PATCH", "/repos/:owner/:repo"), "Changed repository settings");
  assert.equal(labelFor("DELETE", "/repos/:owner/:repo/collaborators/:handle"), "Removed a collaborator");
  assert.equal(labelFor("POST", "/repos/:owner/:repo/something-new"), "POST /repos/:owner/:repo/something-new");
});

test("a change is recorded with who, what, where and the outcome; reading is not", async () => {
  const count = (await events("alice")).events.length;
  assert.equal((await call("GET", "/repos/lab/basin", "alice")).status, 200);
  assert.equal((await events("alice")).events.length, count, "reads are not logged");
  assert.equal((await call("PATCH", "/repos/lab/basin", "alice", { description: "Chalakudy basin model" })).status, 200);
  const e = (await events("alice")).events[0];
  assert.equal(e.actor, "alice");
  assert.equal(e.action, "Changed repository settings");
  assert.equal(e.repo, "basin");
  assert.equal(e.owner, "lab");
  assert.equal(e.outcome, "done");
  assert.equal(e.via, "browser");
  assert.ok(!JSON.stringify(e).includes("Chalakudy basin model"), "bodies are never kept");
});

test("a refused attempt by a signed-in person is recorded as denied", async () => {
  // Settings need an admin: a writer is refused, and the refusal is what an administrator wants to see.
  assert.equal((await call("PATCH", "/repos/lab/basin", "bob", { description: "nope" })).status, 403);
  const e = (await events("alice")).events[0];
  assert.deepEqual([e.actor, e.outcome, e.status], ["bob", "denied", 403]);
  const denied = (await call("GET", "/orgs/lab/audit-log?outcome=denied", "alice")).json.events;
  assert.ok(denied.length >= 1 && denied.every((x: any) => x.outcome === "denied"));
  const done = (await call("GET", "/orgs/lab/audit-log?outcome=done", "alice")).json.events;
  assert.ok(done.length >= 1 && done.every((x: any) => x.outcome === "done"));
});

test("who may read it: organization owners, repository admins, and people for their own repositories", async () => {
  assert.equal((await call("GET", "/orgs/lab/audit-log", "bob")).status, 403, "a member who is not an owner");
  assert.equal((await call("GET", "/orgs/lab/audit-log", "dave")).status, 403);
  assert.equal((await call("GET", "/orgs/lab/audit-log", null)).status, 401);
  assert.equal((await call("GET", "/repos/lab/basin/audit-log", "alice")).status, 200);
  assert.equal((await call("GET", "/repos/lab/basin/audit-log", "bob")).status, 403, "write is not admin");
  assert.equal((await call("GET", "/repos/lab/basin/audit-log", "dave")).status, 404, "a stranger cannot tell it exists");
  // A person's own repositories: others' changes appear there.
  assert.equal((await call("POST", "/repos", "dave", { name: "mine", visibility: "private" })).status, 201);
  assert.equal((await call("PUT", "/repos/dave/mine/collaborators/carol", "dave", { role: "Write" })).status, 201);
  assert.equal((await call("PATCH", "/repos/dave/mine", "dave", { description: "mine" })).status, 200);
  assert.equal((await call("PATCH", "/repos/dave/mine", "carol", { description: "x" })).status, 403);
  const mine = (await call("GET", "/user/audit-log", "dave")).json.events;
  assert.ok(mine.some((x: any) => x.actor === "carol" && x.repo === "mine" && x.outcome === "denied"), "what others tried on my repository");
  assert.ok(mine.some((x: any) => x.actor === "dave" && x.outcome === "done"));
  assert.ok(!mine.some((x: any) => x.owner === "lab"), "nothing from the organization");
});

test("filters, paging and the CSV download", async () => {
  for (let i = 0; i < 4; i++) await call("PATCH", "/repos/lab/basin", "bob", { description: `rev ${i}` });
  const page = (await call("GET", "/orgs/lab/audit-log?limit=2&actor=bob", "alice")).json;
  assert.equal(page.events.length, 2);
  assert.ok(page.next);
  assert.ok(page.events.every((e: any) => e.actor === "bob"));
  const more = (await call("GET", `/orgs/lab/audit-log?limit=50&actor=bob&before=${page.next}`, "alice")).json;
  assert.ok(more.events.length >= 1 && more.events.every((e: any) => e.id < page.next));
  const csv = await call("GET", "/orgs/lab/audit-log?format=csv", "alice");
  assert.equal(csv.status, 200);
  assert.match(csv.res.headers.get("content-type") ?? "", /text\/csv/);
  const lines = csv.text.trim().split("\n");
  assert.equal(lines[0], "time,actor,via,action,owner,repository,outcome,status,method,route,ip");
  assert.ok(lines.length > 5);
});

test("a spreadsheet cannot be made to run an actor's or action's text as a formula", () => {
  const csv = eventsCsv([{ id: 1, at: "t", actor: "=HYPERLINK(1)", action: "+cmd", repo: null, owner: null, method: "POST", route: "/x", params: {}, status: 200, outcome: "done", via: null, ip: null }]);
  assert.ok(csv.includes("'=HYPERLINK(1)") && csv.includes("'+cmd"));
});

test("chunk uploads and secrets in a path are never written to the log", async () => {
  // Push chunks into a repository, then confirm nothing about /chunks is in the log.
  await call("POST", "/repos/lab/basin/chunks/missing", "bob", { hashes: ["0".repeat(64)] });
  const rows = ctx.db.prepare("SELECT params, route FROM audit_events").all() as { params: string; route: string }[];
  assert.ok(rows.every((r) => !/\/chunks/.test(r.route)));
  assert.ok(rows.every((r) => !/token|secret/i.test(r.params)));
});

test("a token's recent requests are its owner's to read, and the same change shows in the audit log as made by token", async () => {
  const made = await call("POST", "/user/tokens", "alice", { note: "ci", scopes: ["repo"] });
  assert.equal(made.status, 201, made.text);
  const pat = made.json.token as string;
  const id = (await call("GET", "/user/tokens", "alice")).json.find((t: any) => t.note === "ci").id as number;
  await call("GET", "/repos/lab/basin", null, undefined, pat);
  await call("GET", "/repos/lab/nope", null, undefined, pat);
  await call("PATCH", "/repos/lab/basin", null, { description: "via token" }, pat);
  const log = await call("GET", `/user/tokens/${id}/requests`, "alice");
  assert.equal(log.status, 200);
  assert.equal(log.json.length, 3);
  assert.deepEqual(
    log.json.map((r: any) => [r.method, r.route, r.status]),
    [
      ["PATCH", "/repos/:owner/:repo", 200],
      ["GET", "/repos/:owner/:repo", 404],
      ["GET", "/repos/:owner/:repo", 200],
    ],
  );
  assert.ok(log.json.every((r: any) => typeof r.ms === "number" && r.at));
  assert.equal((await call("GET", `/user/tokens/${id}/requests`, "bob")).status, 404, "someone else's token");
  const e = (await events("alice")).events[0];
  assert.deepEqual([e.actor, e.via], ["alice", "token"]);
});

test("a request to a route that does not exist shows in the token's log (a typo in a script) but never in the audit log", async () => {
  const made = await call("POST", "/user/tokens", "dave", { note: "script", scopes: ["repo"] });
  const pat = made.json.token as string;
  const id = (await call("GET", "/user/tokens", "dave")).json.find((t: any) => t.note === "script").id as number;
  const before = (ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number }).n;
  const res = await call("DELETE", "/repos/dave/mine/not-a-thing/at/all", null, undefined, pat);
  assert.equal(res.status, 404);
  const log = (await call("GET", `/user/tokens/${id}/requests`, "dave")).json;
  assert.deepEqual([log[0].method, log[0].route, log[0].status], ["DELETE", "/repos/dave/mine/not-a-thing/at/all", 404]);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM audit_events").get() as { n: number }).n, before);
});
