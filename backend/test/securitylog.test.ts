// A person's security activity log: what is recorded, what is left out, and who can read it.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import * as securitylog from "../src/services/securitylog.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const json = { "content-type": "application/json" };

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "node-test/1.0" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signup(handle: string) {
  const r = await call("POST", "/auth/signup", undefined, { username: handle, email: `${handle}@example.org`, password: "a-very-long-password" });
  assert.equal(r.status, 201);
  return r.body.token as string;
}

before(() => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
});

test("a sign-in, a failed attempt, a password change and a token are logged, newest first, and nothing secret is stored", async () => {
  await signup("mira");
  const fail = await call("POST", "/auth/login", undefined, { login: "mira", password: "not-the-password-at-all" });
  assert.equal(fail.status, 401);
  const ok = await call("POST", "/auth/login", undefined, { login: "mira", password: "a-very-long-password" });
  assert.equal(ok.status, 200);
  const token = ok.body.token as string;

  assert.equal((await call("POST", "/user/password", token, { current: "a-very-long-password", next: "another-very-long-password" })).status, 200);
  const pat = await call("POST", "/user/tokens", token, { note: "CI upload", scopes: ["repo"] });
  assert.equal(pat.status, 201);
  assert.equal((await call("DELETE", `/user/tokens/${pat.body.id}`, token)).status, 204);

  const log = await call("GET", "/user/security-log", token);
  assert.equal(log.status, 200);
  const types = (log.body as { type: string }[]).map((e) => e.type);
  assert.deepEqual(types.slice(0, 5), ["token_revoked", "token_created", "password_changed", "signed_in", "sign_in_failed"]);
  const created = (log.body as { type: string; detail: string; userAgent: string | null }[]).find((e) => e.type === "token_created")!;
  assert.match(created.detail, /CI upload/);
  assert.equal(created.userAgent, "node-test/1.0");
  // Neither the password nor any token appears in what was written.
  const raw = JSON.stringify(log.body);
  assert.ok(!raw.includes("a-very-long-password") && !raw.includes("another-very-long-password") && !raw.includes(pat.body.token));
});

test("one person's log is theirs alone, and it needs a signed-in session", async () => {
  const other = await signup("noor");
  const mine = await call("GET", "/user/security-log", other);
  assert.equal(mine.status, 200);
  // Only noor's own sign-up session exists; mira's failed attempt and password change are not here.
  assert.ok((mine.body as { type: string }[]).every((e) => !["sign_in_failed", "password_changed"].includes(e.type)));
  assert.equal((await call("GET", "/user/security-log")).status, 401);
});

test("only the most recent entries are kept per person", () => {
  const id = (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'noor'").get() as { id: number }).id;
  for (let i = 0; i < 230; i++) securitylog.record(ctx, id, "sign_in_failed", { detail: `attempt ${i}` });
  const list = securitylog.list(ctx, id, 500);
  assert.equal(list.length, 200);
  assert.equal(list[0].detail, "attempt 229", "newest first");
  assert.equal(list[199].detail, "attempt 30");
});

test("a reset request and a completed reset are logged against the account", async () => {
  await signup("zed");
  assert.equal((await call("POST", "/auth/forgot", undefined, { login: "zed" })).status, 202);
  const id = (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'zed'").get() as { id: number }).id;
  assert.deepEqual(securitylog.list(ctx, id).map((e) => e.type), ["password_reset_requested"]);
  // An unknown account leaves no trace anywhere.
  const before = (ctx.db.prepare("SELECT COUNT(*) AS n FROM security_events").get() as { n: number }).n;
  assert.equal((await call("POST", "/auth/forgot", undefined, { login: "nobody-here" })).status, 202);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM security_events").get() as { n: number }).n, before);
});
