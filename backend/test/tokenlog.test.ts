// The per-token request log is written in groups, off the request's path: a request does not wait for a row to be committed, the rows keep the
// time the requests were made, a token keeps its newest 100, and reading the log (or shutting down) writes what is waiting first.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { flushTokenRequests, tokenLogStats } from "../src/services/audit.ts";
import type { Ctx } from "../src/services/context.ts";

test("requests made with a token are logged in a batch, in order, newest 100 kept, and the log reads its own latest requests", async () => {
  const ctx = { db: await openDb(":memory:"), store: new MemoryStore() } as Ctx;
  const app = createApp(ctx);
  const j = { "content-type": "application/json" };
  const su = await app.request("/v1/auth/signup", { method: "POST", headers: j, body: JSON.stringify({ username: "tess", email: "tess@example.org", password: "a-very-long-password" }) });
  const session = ((await su.json()) as { token: string }).token;
  const made = await app.request("/v1/user/tokens", { method: "POST", headers: { ...j, authorization: `Bearer ${session}` }, body: JSON.stringify({ note: "ci", scopes: ["repo"] }) });
  const pat = ((await made.json()) as { token: string }).token;
  const id = ((await (await app.request("/v1/user/tokens", { headers: { authorization: `Bearer ${session}` } })).json()) as { id: number; note: string }[]).find((t) => t.note === "ci")!.id;

  const before = tokenLogStats.written;
  for (let i = 0; i < 5; i++) assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${pat}` } })).status, 200);
  const early = (await ctx.db.get("SELECT COUNT(*) AS n FROM token_requests WHERE token_id = ?", id)) as { n: number };
  assert.equal(early.n, 0, "the requests were answered before any row was written");

  await flushTokenRequests(ctx);
  const rows = (await ctx.db.all("SELECT at, route FROM token_requests WHERE token_id = ? ORDER BY id", id)) as { at: string; route: string }[];
  assert.equal(rows.length, 5);
  assert.ok(rows.every((r) => r.route === "/user"));
  assert.deepEqual(rows.map((r) => r.at), [...rows.map((r) => r.at)].sort(), "each row keeps the time of its own request");
  assert.equal(tokenLogStats.written - before, 5);

  // More than a token keeps: only the newest 100 survive, and a batch of 200 is written without waiting for the timer.
  for (let i = 0; i < 130; i++) await app.request("/v1/user", { headers: { authorization: `Bearer ${pat}` } });
  const log = (await (await app.request(`/v1/user/tokens/${id}/requests`, { headers: { authorization: `Bearer ${session}` } })).json()) as unknown[];
  assert.equal(log.length, 100, "reading the log writes what is waiting first, and trims to the newest 100");
  const stored = (await ctx.db.get("SELECT COUNT(*) AS n FROM token_requests WHERE token_id = ?", id)) as { n: number };
  assert.equal(stored.n, 100);
  await ctx.db.close();
});

test("a log that cannot be written is dropped and counted, never an error for anyone", async () => {
  const ctx = { db: await openDb(":memory:"), store: new MemoryStore() } as Ctx;
  const app = createApp(ctx);
  const j = { "content-type": "application/json" };
  const su = await app.request("/v1/auth/signup", { method: "POST", headers: j, body: JSON.stringify({ username: "uma", email: "uma@example.org", password: "a-very-long-password" }) });
  const session = ((await su.json()) as { token: string }).token;
  const made = await app.request("/v1/user/tokens", { method: "POST", headers: { ...j, authorization: `Bearer ${session}` }, body: JSON.stringify({ note: "ci", scopes: ["repo"] }) });
  const pat = ((await made.json()) as { token: string }).token;
  await app.request("/v1/user", { headers: { authorization: `Bearer ${pat}` } });
  const dropped = tokenLogStats.dropped;
  await ctx.db.run("DROP TABLE token_requests");
  await flushTokenRequests(ctx);
  assert.equal(tokenLogStats.dropped - dropped, 1);
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${pat}` } })).status, 200);
  await ctx.db.close();
});
