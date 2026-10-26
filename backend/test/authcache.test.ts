// Which token a request carries is remembered for a couple of seconds, so a page's burst of calls looks it up once; but who the person is stays
// fresh, and a revoked token or a signed-out session stops working at once.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb, type DB } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

async function setup() {
  const real = await openDb(":memory:");
  const seen: string[] = [];
  const counted = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (["get", "all", "run", "insert"].includes(String(prop))) {
        return (...args: unknown[]) => {
          seen.push(String(args[0]).replace(/\s+/g, " "));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value.bind(target);
    },
  }) as DB;
  const ctx = { db: counted, store: new MemoryStore() } as Ctx;
  const app = createApp(ctx);
  const j = { "content-type": "application/json" };
  const su = await app.request("/v1/auth/signup", { method: "POST", headers: j, body: JSON.stringify({ username: "ines", email: "ines@example.org", password: "a-very-long-password" }) });
  const session = ((await su.json()) as { token: string }).token;
  return { ctx, app, real, seen, session, j };
}
const lookups = (seen: string[]) => seen.filter((q) => /FROM tokens WHERE token_hash/.test(q)).length;

test("a burst of calls with one token looks it up once, and stamps 'last used' once", async () => {
  const { app, seen, session } = await setup();
  seen.length = 0;
  for (let i = 0; i < 10; i++) assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${session}` } })).status, 200);
  assert.equal(lookups(seen), 1, "one lookup for ten requests");
  assert.ok(seen.filter((q) => /UPDATE tokens SET last_used_at/.test(q)).length <= 1);
});

test("who the person is is always fresh: a changed plan shows at once even while the token is remembered", async () => {
  const { app, real, session } = await setup();
  const get = async () => ((await (await app.request("/v1/user", { headers: { authorization: `Bearer ${session}` } })).json()) as { plan: string }).plan;
  const first = await get();
  await real.run("UPDATE users SET plan = 'team' WHERE owner_id = (SELECT id FROM owners WHERE handle = 'ines')");
  assert.notEqual(first, "team");
  assert.equal(await get(), "team");
});

test("a revoked token and a signed-out session stop working on the very next request", async () => {
  const { app, session, j } = await setup();
  const auth = { authorization: `Bearer ${session}`, ...j };
  const made = await app.request("/v1/user/tokens", { method: "POST", headers: auth, body: JSON.stringify({ note: "ci", scopes: ["repo"] }) });
  const pat = ((await made.json()) as { token: string }).token;
  const id = ((await (await app.request("/v1/user/tokens", { headers: auth })).json()) as { id: number; note: string }[]).find((t) => t.note === "ci")!.id;
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${pat}` } })).status, 200);
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${pat}` } })).status, 200, "remembered");
  assert.equal((await app.request(`/v1/user/tokens/${id}`, { method: "DELETE", headers: auth })).status, 204);
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${pat}` } })).status, 401, "revoked: no grace period on this server");

  const out = await app.request("/v1/auth/logout", { method: "POST", headers: auth });
  assert.ok(out.status === 204 || out.status === 200, `signout ${out.status}`);
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${session}` } })).status, 401, "signed out");
});

test("a token nobody knows is refused and not remembered", async () => {
  const { app, seen } = await setup();
  seen.length = 0;
  for (let i = 0; i < 3; i++) assert.equal((await app.request("/v1/user", { headers: { authorization: "Bearer nope-nope-nope" } })).status, 401);
  assert.equal(lookups(seen), 3, "every unknown token is checked against the database");
});
