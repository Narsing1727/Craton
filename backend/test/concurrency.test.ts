// Things that must stay right when several requests arrive at once. On a real PostgreSQL server (CRATON_TEST_PG) requests really do run
// side by side on separate connections; on the in-process database they queue, so these pass trivially there and earn their keep on the server.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";

const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
};

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-passphrase-1" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "basin", visibility: "private" })).status, 201);
});

test("issues created at the same moment each get their own number", async () => {
  const made = await Promise.all(Array.from({ length: 12 }, (_, i) => call("POST", "/repos/alice/basin/issues", { title: `Gauge ${i} reads high` })));
  assert.deepEqual(made.map((r) => r.status), Array(12).fill(201), made.map((r) => r.text).join("\n"));
  const numbers = made.map((r) => r.json.number as number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 12 }, (_, i) => i + 1));
});
