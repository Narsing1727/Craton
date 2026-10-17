// Sharing one repository with one person: who can, what each role allows, and how it ends.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { sentEmails } from "../src/services/email.ts";

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
const R = "/repos/alice/basin";
const handles = async (who: string) => ((await call("GET", `${R}/collaborators`, who)).json as { handle: string; role: string }[]).map((c) => `${c.handle}:${c.role}`);
const visibleTo = async (who: string) => ((await call("GET", "/repos", who)).json as { owner: string; name: string }[]).some((r) => r.owner === "alice" && r.name === "basin");

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol", "dave", "erin"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "private" })).status, 201);
  assert.equal((await call("POST", "/orgs", "alice", { handle: "lab", name: "Lab" })).status, 201);
});

test("sharing needs a confirmed email, like inviting to an organization", async () => {
  const res = await call("PUT", `${R}/collaborators/bob`, "alice", { role: "Write" });
  assert.equal(res.status, 403);
  assert.equal(res.json.error.code, "email_unverified");
  ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run(new Date().toISOString());
});

test("an admin adds people with a role; they are told by email; the repository becomes theirs to see", async () => {
  assert.equal(await visibleTo("bob"), false, "private: invisible before");
  assert.equal((await call("GET", R, "bob")).status, 404);
  const added = await call("PUT", `${R}/collaborators/bob`, "alice", { role: "Write" });
  assert.equal(added.status, 201, added.text);
  assert.deepEqual(added.json, [{ handle: "bob", name: "bob", role: "Write" }]);
  assert.equal((await call("PUT", `${R}/collaborators/@Carol`, "alice", { role: "read" })).status, 201, "an @ and any case are fine");
  assert.deepEqual(await handles("alice"), ["bob:Write", "carol:Read"]);
  const mail = [...sentEmails].reverse().find((m) => m.to === "bob@example.org" && m.kind === "repo-access");
  assert.ok(mail && /alice/.test(mail.subject) && /alice\/basin/.test(mail.text), "bob was told");
  assert.equal(await visibleTo("bob"), true);
  assert.equal((await call("GET", R, "carol")).status, 200);
  assert.equal(await visibleTo("dave"), false, "someone else still can't see it");
});

test("the person sees what was shared with them, with their role", async () => {
  assert.deepEqual((await call("GET", "/user/shared", "bob")).json, [{ owner: "alice", name: "basin", role: "Write" }]);
  assert.deepEqual((await call("GET", "/user/shared", "dave")).json, []);
  assert.equal((await call("GET", "/user/shared", null)).status, 401);
});

test("roles mean what they say", async () => {
  const issue = (who: string, body: object) => call("POST", `${R}/issues`, who, { title: "Gauge drift", ...body });
  assert.equal((await issue("carol", {})).status, 201, "a reader can report a problem");
  assert.equal((await call("PATCH", `${R}/issues/1`, "carol", { state: "closed" })).status, 403, "but not manage issues");
  assert.equal((await call("PATCH", `${R}/issues/1`, "bob", { state: "closed" })).status, 200, "a writer can");
  assert.equal((await call("POST", `${R}/milestones`, "bob", { title: "v1" })).status, 201);
  assert.equal((await call("PATCH", R, "bob", { description: "x" })).status, 403, "a writer can't change settings");
  assert.equal((await call("PUT", `${R}/collaborators/dave`, "bob", { role: "Read" })).status, 403, "or share it");
  assert.equal((await call("GET", `${R}/collaborators`, "bob")).status, 200, "but can see who has access");
  assert.equal((await call("GET", `${R}/collaborators`, "carol")).status, 403, "a reader can't");
  assert.equal((await call("GET", `${R}/collaborators`, "dave")).status, 404, "a stranger can't tell it exists");
  assert.equal((await call("GET", `${R}/collaborators`, null)).status, 404);
  assert.equal((await call("PUT", `${R}/collaborators/dave`, null, { role: "Read" })).status, 401);
});

test("changing a role takes effect at once", async () => {
  const up = await call("PUT", `${R}/collaborators/carol`, "alice", { role: "Write" });
  assert.equal(up.status, 200, "not a new person");
  assert.equal((await call("PATCH", `${R}/issues/1`, "carol", { state: "open" })).status, 200);
  assert.equal((await call("PUT", `${R}/collaborators/bob`, "alice", { role: "Admin" })).status, 200);
  assert.equal((await call("PATCH", R, "bob", { description: "set by bob" })).status, 200, "an admin can change settings");
  assert.equal((await call("PUT", `${R}/collaborators/bob`, "alice", { role: "Read" })).status, 200);
  assert.equal((await call("PATCH", `${R}/issues/1`, "bob", { state: "closed" })).status, 403, "demoted");
  const mails = sentEmails.filter((m) => m.kind === "repo-access" && m.to === "carol@example.org").length;
  assert.equal(mails, 1, "a role change isn't a second invitation");
});

test("what can't be added, and what is checked", async () => {
  const put = (handle: string, body: object) => call("PUT", `${R}/collaborators/${handle}`, "alice", body);
  assert.equal((await put("alice", { role: "Read" })).status, 400, "the owner");
  assert.equal((await put("lab", { role: "Read" })).status, 400, "an organization");
  assert.equal((await put("nobody", { role: "Read" })).status, 404);
  assert.equal((await put("dave", { role: "Owner" })).status, 400);
  assert.match((await put("dave", { role: "Owner" })).json.error.message, /Read, Write, Admin/);
  assert.equal((await put("dave", {})).status, 201, "no role means Read");
  assert.deepEqual((await handles("alice")).filter((h) => h.startsWith("dave")), ["dave:Read"]);
});

test("removing someone ends their access and releases their file locks", async () => {
  ctx.db.prepare("INSERT INTO file_locks (repo_id, path, user_id, reason) VALUES ((SELECT id FROM repos WHERE name = 'basin'), 'dem.tif', (SELECT id FROM owners WHERE handle = 'carol'), '')").run();
  assert.equal((await call("DELETE", `${R}/collaborators/carol`, "bob")).status, 403, "only an admin removes");
  const gone = await call("DELETE", `${R}/collaborators/carol`, "alice");
  assert.equal(gone.status, 200);
  assert.ok(!gone.json.some((c: any) => c.handle === "carol"));
  assert.equal((await call("GET", R, "carol")).status, 404);
  assert.equal(await visibleTo("carol"), false);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM file_locks WHERE user_id = (SELECT id FROM owners WHERE handle = 'carol')").get() as { n: number }).n, 0);
  assert.equal((await call("DELETE", `${R}/collaborators/carol`, "alice")).status, 404, "already gone");
});

test("you can always leave a repository that was shared with you", async () => {
  assert.equal((await call("DELETE", `${R}/collaborators/dave`, "dave")).status, 200);
  assert.equal((await call("GET", R, "dave")).status, 404);
  assert.deepEqual(await handles("alice"), ["bob:Read"]);
  assert.equal((await call("DELETE", `${R}/collaborators/erin`, "erin")).status, 404, "a stranger just sees nothing there");
});

test("deleting a repository removes who it was shared with", async () => {
  assert.equal((await call("DELETE", R, "alice", {})).status, 204);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM collaborators").get() as { n: number }).n, 0);
});
