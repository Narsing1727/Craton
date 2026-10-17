// What a person wants emailed: everything on until switched off, only known kinds with true/false accepted, and a switched-off kind
// really is not sent while the same email still reaches someone who kept it on. Also the visibility a new repository starts with.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { sentEmails } from "../src/services/email.ts";
import { mergeNotify, notifyOf } from "../src/services/notify.ts";

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
const accessEmailsTo = (who: string) => sentEmails.filter((e) => e.kind === "repo-access" && e.to === `${who}@example.org`);

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(new Date().toISOString(), u);
  }
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "public" })).status, 201);
});

test("everything is on to begin with, and a change keeps the rest", async () => {
  const start = (await call("GET", "/user", "bob")).json.notify;
  assert.deepEqual(Object.values(start), [true, true, true, true, true]);
  const after = (await call("PATCH", "/user", "bob", { notify: { repo_access: false } })).json.notify;
  assert.equal(after.repo_access, false);
  assert.equal(after.review_requests, true);
  assert.equal((await call("PATCH", "/user", "bob", { notify: { storage: false } })).json.notify.repo_access, false, "the earlier choice stays");
  assert.equal((await call("PATCH", "/user", "bob", { notify: { repo_access: true } })).json.notify.repo_access, true, "and can be switched back on");
});

test("unknown kinds and anything that is not true or false are refused", async () => {
  assert.equal((await call("PATCH", "/user", "bob", { notify: { security: false } })).status, 400);
  assert.equal((await call("PATCH", "/user", "bob", { notify: { storage: "no" } })).status, 400);
  assert.equal((await call("PATCH", "/user", "bob", { notify: [true] })).status, 400);
  assert.throws(() => mergeNotify("{}", null));
  assert.deepEqual(notifyOf("not json"), notifyOf("{}"), "a damaged value is no overrides");
});

test("a switched-off email is not sent, and the same email still reaches someone who kept it on", async () => {
  await call("PATCH", "/user", "bob", { notify: { repo_access: false } });
  assert.equal((await call("PUT", "/repos/alice/basin/collaborators/bob", "alice", { role: "Write" })).status, 201);
  assert.equal((await call("PUT", "/repos/alice/basin/collaborators/carol", "alice", { role: "Read" })).status, 201);
  assert.equal(accessEmailsTo("bob").length, 0, "bob turned it off");
  assert.equal(accessEmailsTo("carol").length, 1, "carol did not");
});

test("a repository created without saying starts with the visibility a person chose, and only two values are accepted", async () => {
  assert.equal((await call("GET", "/user", "carol")).json.defaultVisibility, "public");
  assert.equal((await call("PATCH", "/user", "carol", { defaultVisibility: "secret" })).status, 400);
  assert.equal((await call("PATCH", "/user", "carol", { defaultVisibility: "private" })).json.defaultVisibility, "private");
  ctx.db.prepare("UPDATE users SET plan = 'team' WHERE owner_id = (SELECT id FROM owners WHERE handle = 'carol')").run();
  assert.equal((await call("POST", "/repos", "carol", { name: "quiet" })).json.visibility, "private", "left unsaid, it follows the choice");
  assert.equal((await call("POST", "/repos", "carol", { name: "open", visibility: "public" })).json.visibility, "public", "said, it wins");
});
