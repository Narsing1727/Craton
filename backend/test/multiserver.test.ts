// Several API servers on one database (what a deployment behind a load balancer is): background work is done once, and the limits
// that stop password guessing are shared. Each "server" here is its own context over the same database.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { deliverDue } from "../src/services/webhooks.ts";
import { sendDue } from "../src/services/digest.ts";
import { config } from "../src/config.ts";

let db: Awaited<ReturnType<typeof openDb>>;
let servers: Ctx[];
let apps: ReturnType<typeof createApp>[];
let receiver: http.Server;
let hits = 0;
let token = "";

async function call(app: ReturnType<typeof createApp>, method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${who}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

before(async () => {
  config.webhooks.allowPrivate = true;
  config.webhooks.autoDeliver = false;
  receiver = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      hits++;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  db = await openDb(":memory:");
  const store = new MemoryStore();
  servers = [0, 1, 2].map(() => ({ db, store }));
  apps = servers.map((s) => createApp(s));
  const res = await call(apps[0], "POST", "/auth/signup", null, { username: "rhea", email: "rhea@example.org", password: "a-very-long-password" });
  token = res.json.token;
  await db.run("UPDATE users SET email_verified_at = now_iso() WHERE email = 'rhea@example.org'");
  assert.equal((await call(apps[0], "POST", "/repos", token, { name: "basin", visibility: "private" })).status, 201);
});
after(async () => {
  config.webhooks.allowPrivate = false;
  config.webhooks.autoDeliver = true;
  await new Promise((r) => receiver.close(r));
});

test("every server sweeping for due webhook deliveries at once still sends each delivery once", async () => {
  const url = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;
  const made = await call(apps[0], "POST", "/repos/rhea/basin/webhooks", token, { url, events: ["push"] });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  for (let i = 0; i < 6; i++) assert.equal((await call(apps[0], "POST", `/repos/rhea/basin/webhooks/${made.json.id}/ping`, token)).status, 202);
  const pending = (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE status = 'pending'"))!.n;
  assert.ok(pending >= 6);
  hits = 0;
  await Promise.all(servers.map((s) => deliverDue(s)));
  assert.equal(hits, pending, `${pending} deliveries, three servers, ${pending} sends`);
  const log = await call(apps[1], "GET", `/repos/rhea/basin/webhooks/${made.json.id}/deliveries`, token);
  assert.deepEqual([...new Set((log.json as { status: string }[]).map((d) => d.status))], ["succeeded"]);
  // And a delivery that a server took but never finished comes due again once its lease has run out.
  await call(apps[0], "POST", `/repos/rhea/basin/webhooks/${made.json.id}/ping`, token);
  const claimed = await db.all<{ id: number }>("UPDATE webhook_deliveries SET next_attempt_at = ? WHERE status = 'pending' RETURNING id", new Date(Date.now() + 3 * 60_000).toISOString());
  assert.equal(claimed.length, 1);
  hits = 0;
  await deliverDue(servers[2]);
  assert.equal(hits, 0, "while another server holds it, nobody else sends it");
  await db.run("UPDATE webhook_deliveries SET next_attempt_at = ? WHERE status = 'pending'", new Date(Date.now() - 1000).toISOString());
  await deliverDue(servers[2]);
  assert.equal(hits, 1, "after the lease, it is sent");
});

test("the weekly digest is claimed per person: servers running it together send one email", async () => {
  await db.run("UPDATE users SET digest = 'weekly', digest_sent_at = NULL WHERE email = 'rhea@example.org'");
  const sent = (await Promise.all(servers.map((s) => sendDue(s)))).reduce((a, b) => a + b, 0);
  // Nothing was unread, so no email is made, but the person's turn is taken exactly once.
  assert.ok(sent <= 1);
  const row = await db.get<{ digest_sent_at: string | null }>("SELECT digest_sent_at FROM users WHERE email = 'rhea@example.org'");
  assert.ok(row!.digest_sent_at, "the turn was recorded");
  const again = (await Promise.all(servers.map((s) => sendDue(s)))).reduce((a, b) => a + b, 0);
  assert.equal(again, 0, "and is not taken again within the week");
});

test("failed sign-ins on one server lock the account on every server", async () => {
  const max = config.limits.lockout.max;
  for (let i = 0; i < max; i++) {
    const r = await call(apps[i % apps.length], "POST", "/auth/login", null, { login: "rhea", password: "wrong-password-here" });
    assert.equal(r.status, 401, `attempt ${i + 1}`);
  }
  for (const app of apps) {
    const r = await call(app, "POST", "/auth/login", null, { login: "rhea", password: "a-very-long-password" });
    assert.equal(r.status, 429, "even the right password waits");
    assert.equal(r.json.error.code, "account_locked");
  }
  await db.run("DELETE FROM rate_hits WHERE key = 'fail:rhea'");
  assert.equal((await call(apps[2], "POST", "/auth/login", null, { login: "rhea", password: "a-very-long-password" })).status, 200);
});
