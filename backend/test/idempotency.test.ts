// Idempotency-Key: a retried mutating request with the same key gets back the exact first
// response instead of being applied twice. See src/api/idempotency.ts.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { reset as resetIdempotency } from "../src/api/idempotency.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who: string | null, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["mira", "jun"]) {
    const r = await call("POST", "/auth/signup", null, { username: u, email: `${u}@example.org`, password: "a-very-long-password" });
    assert.equal(r.status, 201, r.text);
    tokens[u] = r.json.token;
  }
  ctx.db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
  await call("POST", "/repos", "mira", { name: "idem-basin", visibility: "public" });
  resetIdempotency();
});

test("a retried request with the same key is applied once, and the retry sees the first response", async () => {
  const key = "star-attempt-1";
  const first = await call("PUT", "/repos/mira/idem-basin/star", "jun", undefined, { "idempotency-key": key });
  assert.equal(first.status, 200);
  assert.equal(first.json.stars, 1);
  assert.ok(!first.headers.get("idempotency-replayed"));

  // A dropped connection, then a retry with the identical key: not applied again.
  const retry = await call("PUT", "/repos/mira/idem-basin/star", "jun", undefined, { "idempotency-key": key });
  assert.equal(retry.status, 200);
  assert.equal(retry.json.stars, 1, "the star wasn't counted twice");
  assert.equal(retry.headers.get("idempotency-replayed"), "true");

  // Confirmed independently: only one star exists.
  assert.equal((await call("GET", "/repos/mira/idem-basin", "jun")).json.stars, 1);
});

test("a different key is a genuinely new request", async () => {
  await call("DELETE", "/repos/mira/idem-basin/star", "jun"); // clean slate, no key needed
  const a = await call("PUT", "/repos/mira/idem-basin/star", "jun", undefined, { "idempotency-key": "attempt-a" });
  assert.equal(a.json.stars, 1);
  // Unstar and restar with a different key: a real second request, correctly applied.
  await call("DELETE", "/repos/mira/idem-basin/star", "jun");
  const b = await call("PUT", "/repos/mira/idem-basin/star", "jun", undefined, { "idempotency-key": "attempt-b" });
  assert.equal(b.json.stars, 1);
  assert.ok(!b.headers.get("idempotency-replayed"));
});

test("the same key value from two different people never collides", async () => {
  const key = "shared-key";
  const mira = await call("POST", "/repos", "mira", { name: "mira-solo", visibility: "public" }, { "idempotency-key": key });
  const jun = await call("POST", "/repos", "jun", { name: "jun-solo", visibility: "public" }, { "idempotency-key": key });
  assert.equal(mira.status, 201);
  assert.equal(jun.status, 201, "jun's request used the same key text but is a different actor, so it still applied");
  assert.notEqual(mira.json.name, jun.json.name);
});

test("replays an error exactly, including its status, so a retry can't succeed differently than the first attempt", async () => {
  const key = "duplicate-name";
  await call("POST", "/repos", "mira", { name: "idem-basin", visibility: "public" }, { "idempotency-key": key });
  const first = await call("POST", "/repos", "mira", { name: "idem-basin", visibility: "public" }, { "idempotency-key": "first-of-dupe" });
  assert.equal(first.status, 409, first.text); // name already taken, from the very first setup repo
  const retry = await call("POST", "/repos", "mira", { name: "idem-basin", visibility: "public" }, { "idempotency-key": "first-of-dupe" });
  assert.equal(retry.status, 409);
  assert.equal(retry.json.error.code, first.json.error.code);
  assert.equal(retry.headers.get("idempotency-replayed"), "true");
});

test("a key over 255 characters is refused; no key is simply ignored", async () => {
  const tooLong = "x".repeat(256);
  const r = await call("PUT", "/repos/mira/idem-basin/star", "jun", undefined, { "idempotency-key": tooLong });
  assert.equal(r.status, 400);
  assert.equal(r.json.error.code, "bad_request");

  // Two plain requests with no key at all: each is its own request, as before this feature existed.
  await call("DELETE", "/repos/mira/idem-basin/star", "jun");
  const x = await call("PUT", "/repos/mira/idem-basin/star", "jun");
  const y = await call("PUT", "/repos/mira/idem-basin/star", "jun");
  assert.equal(x.json.stars, 1);
  assert.equal(y.json.stars, 1, "starring twice without a key is just idempotent by nature, not via the cache");
  assert.ok(!y.headers.get("idempotency-replayed"), "no key means no replay bookkeeping at all");
});

test("GET requests ignore the header entirely", async () => {
  const a = await call("GET", "/repos/mira/idem-basin", "jun", undefined, { "idempotency-key": "read-key" });
  const b = await call("GET", "/repos/mira/idem-basin", "jun", undefined, { "idempotency-key": "read-key" });
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.ok(!b.headers.get("idempotency-replayed"), "reads were never cached by this mechanism");
});
