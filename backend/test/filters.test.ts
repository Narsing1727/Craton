// Saved filters: private to the person, replaced when saved again under the same name, bounded, refused when empty.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who: string | null, body?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}

before(async () => {
  const ctx: Ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["mira", "noor"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
});

test("a filter is saved, listed under its list, and replaced when saved again with the same name", async () => {
  const a = await call("POST", "/user/filters", "mira", { kind: "issues", name: "My open bugs", state: "open", label: "bug", q: "author:mira" });
  assert.equal(a.status, 201);
  const again = await call("POST", "/user/filters", "mira", { kind: "issues", name: "my open bugs", state: "closed", q: "" , label: "bug" });
  assert.equal(again.json.id, a.json.id, "same name (any case) replaces");
  const list = await call("GET", "/user/filters?kind=issues", "mira");
  assert.equal(list.json.length, 1);
  assert.deepEqual([list.json[0].state, list.json[0].label, list.json[0].q], ["closed", "bug", ""]);
  assert.deepEqual((await call("GET", "/user/filters?kind=pulls", "mira")).json, [], "the other list is separate");
});

test("filters are private to their owner", async () => {
  assert.deepEqual((await call("GET", "/user/filters?kind=issues", "noor")).json, []);
  const mine = (await call("GET", "/user/filters?kind=issues", "mira")).json[0];
  assert.equal((await call("DELETE", `/user/filters/${mine.id}`, "noor")).status, 404);
  assert.equal((await call("DELETE", `/user/filters/${mine.id}`, "mira")).status, 204);
  assert.deepEqual((await call("GET", "/user/filters?kind=issues", "mira")).json, []);
});

test("bad input is refused, an empty filter included, and twenty is the most", async () => {
  assert.equal((await call("POST", "/user/filters", "mira", { kind: "wiki", name: "x", q: "a" })).status, 400);
  assert.equal((await call("POST", "/user/filters", "mira", { kind: "issues", name: "", q: "a" })).status, 400);
  assert.equal((await call("POST", "/user/filters", "mira", { kind: "issues", name: "nothing" })).status, 400);
  for (let i = 0; i < 20; i++) assert.equal((await call("POST", "/user/filters", "mira", { kind: "pulls", name: `f${i}`, q: `n${i}` })).status, 201);
  assert.equal((await call("POST", "/user/filters", "mira", { kind: "pulls", name: "one too many", q: "z" })).status, 400);
  assert.equal((await call("POST", "/user/filters", null, { kind: "pulls", name: "x", q: "a" })).status, 401);
});
