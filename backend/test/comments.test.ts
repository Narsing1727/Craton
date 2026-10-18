// Comments can be edited (by their author, and it says so), deleted (by the author or a repository administrator) and
// reacted to; the reactions are counted per emoji, know which are yours, and respect who can see the repository.

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
  return { status: res.status, json };
}
const R = "/repos/alice/open";
const thread = async (who: string | null) => (await call("GET", `${R}/issues/1`, who)).json.thread as any[];

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol", "dave"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run();
  assert.equal((await call("POST", "/repos", "alice", { name: "open", visibility: "private" })).status, 201);
  assert.equal((await call("PUT", `${R}/collaborators/bob`, "alice", { role: "Write" })).status, 201);
  assert.equal((await call("PUT", `${R}/collaborators/carol`, "alice", { role: "Read" })).status, 201);
  assert.equal((await call("POST", `${R}/issues`, "alice", { title: "Gauge 4 reads high" })).status, 201);
});

test("every comment has an id, and a new one starts unedited with no reactions", async () => {
  const made = await call("POST", `${R}/issues/1/comments`, "bob", { body: "  Looks like the datum.  " });
  assert.equal(made.status, 201);
  assert.equal(typeof made.json.id, "number");
  assert.deepEqual([made.json.author, made.json.body, made.json.editedAt, made.json.reactions], ["bob", "Looks like the datum.", null, {}]);
  assert.equal((await call("POST", `${R}/issues/1/comments`, "alice", { body: "Thanks" })).status, 201);
  assert.deepEqual((await thread("alice")).map((c) => c.author), ["bob", "alice"]);
});

test("only the author edits a comment, an edit says so, and the new text cannot be empty", async () => {
  const [mine, theirs] = await thread("bob");
  assert.equal((await call("PATCH", `${R}/comments/${theirs.id}`, "bob", { body: "hijack" })).status, 403, "not someone else's");
  assert.equal((await call("PATCH", `${R}/comments/${mine.id}`, "alice", { body: "hijack" })).status, 403, "not even the repository owner's words");
  assert.equal((await call("PATCH", `${R}/comments/${mine.id}`, "bob", { body: "   " })).status, 400);
  const edited = await call("PATCH", `${R}/comments/${mine.id}`, "bob", { body: "Looks like the vertical datum." });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.body, "Looks like the vertical datum.");
  assert.ok(edited.json.editedAt, "it is marked edited");
  assert.equal((await call("PATCH", `${R}/comments/${mine.id}`, null, { body: "x" })).status, 401);
  assert.equal((await call("PATCH", `${R}/comments/99999`, "bob", { body: "x" })).status, 404);
  assert.equal((await call("PATCH", `${R}/comments/${mine.id}`, "dave", { body: "x" })).status, 404, "someone who cannot see the repository learns nothing");
});

test("reactions are counted per emoji, know whose they are, and asking twice changes nothing", async () => {
  const [c] = await thread("bob");
  const path = `${R}/comments/${c.id}/reactions`;
  assert.equal((await call("PUT", `${path}/rocket`, "bob")).json.reactions.rocket.count, 1);
  assert.equal((await call("PUT", `${path}/rocket`, "bob")).json.reactions.rocket.count, 1, "the same person twice is still one");
  await call("PUT", `${path}/rocket`, "alice");
  await call("PUT", `${path}/eyes`, "carol");
  const seenByBob = (await thread("bob"))[0].reactions;
  assert.deepEqual([seenByBob.rocket.count, seenByBob.rocket.mine, seenByBob.eyes.mine], [2, true, false]);
  assert.deepEqual(seenByBob.rocket.by.sort(), ["alice", "bob"]);
  assert.equal((await thread("carol"))[0].reactions.eyes.mine, true, "mine depends on who is looking");
  assert.equal((await call("GET", `${R}/issues/1`, null)).status, 404, "signed out cannot see a private repository's thread");
  const removed = await call("DELETE", `${path}/rocket`, "bob");
  assert.deepEqual([removed.json.reactions.rocket.count, removed.json.reactions.rocket.mine], [1, false]);
  assert.equal((await call("DELETE", `${path}/rocket`, "alice")).json.reactions.rocket, undefined, "none left, none shown");
  assert.equal((await call("PUT", `${path}/poop`, "bob")).status, 400, "only the named reactions");
  assert.equal((await call("PUT", `${path}/heart`, "dave")).status, 404, "and only where you can see the repository");
  assert.equal((await call("PUT", `${path}/heart`, null)).status, 404, "signed out, a private repository is not even acknowledged");
});

test("the author or an administrator deletes a comment; nobody else, and its reactions go with it", async () => {
  const made = await call("POST", `${R}/issues/1/comments`, "carol", { body: "off topic" });
  const id = made.json.id;
  await call("PUT", `${R}/comments/${id}/reactions/laugh`, "bob");
  assert.equal((await call("DELETE", `${R}/comments/${id}`, "bob")).status, 403, "a writer who is not the author");
  assert.equal((await call("DELETE", `${R}/comments/${id}`, "alice")).status, 204, "the repository's administrator");
  assert.equal((await thread("alice")).some((c) => c.id === id), false);
  assert.equal((await call("DELETE", `${R}/comments/${id}`, "alice")).status, 404);
  const own = await call("POST", `${R}/issues/1/comments`, "bob", { body: "typo" });
  assert.equal((await call("DELETE", `${R}/comments/${own.json.id}`, "bob")).status, 204, "the author");
  const issue = (await call("GET", `${R}/issues/1`, "alice")).json;
  assert.equal(issue.comments, 2, "the count follows");
});

test("a pull request's comments work the same way", async () => {
  ctx.db.prepare("INSERT INTO pulls (repo_id, number, title, author_id, source, target) SELECT r.id, 1, 'Fix datum', o.id, 'fix', 'main' FROM repos r, owners o WHERE r.name = 'open' AND o.handle = 'alice'").run();
  const made = await call("POST", `${R}/pulls/1/comments`, "bob", { body: "Reviewed the geometry." });
  assert.equal(made.status, 201);
  assert.equal((await call("PUT", `${R}/comments/${made.json.id}/reactions/hooray`, "alice")).json.reactions.hooray.count, 1);
  const pr = (await call("GET", `${R}/pulls/1`, "alice")).json;
  assert.equal(pr.thread[0].reactions.hooray.mine, true);
  assert.equal((await call("PATCH", `${R}/comments/${made.json.id}`, "bob", { body: "Reviewed the geometry and flows." })).json.editedAt !== null, true);
  assert.equal((await call("DELETE", `${R}/comments/${made.json.id}`, "bob")).status, 204);
  assert.equal((await call("GET", `${R}/pulls/1`, "alice")).json.comments, 0);
});
