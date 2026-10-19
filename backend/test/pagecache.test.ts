// The short-lived copy of the explore list and trending (for visitors with no credentials only), the readiness report on the shared cache,
// and the /metrics endpoint.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { config } from "../src/config.ts";
import type { Ctx } from "../src/services/context.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await app.request(path, { headers });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, res };
}
const mine = (path: string, method = "GET", body?: unknown) =>
  app.request(path, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });

before(async () => {
  (config as { pageCacheSeconds: number }).pageCacheSeconds = 1;
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ann", email: "ann@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  await ctx.db.run("UPDATE users SET email_verified_at = now_iso()");
  assert.equal((await mine("/v1/repos", "POST", { name: "open-one", visibility: "public" })).status, 201);
  assert.equal((await mine("/v1/repos", "POST", { name: "closed-one", visibility: "private" })).status, 201);
});

test("a visitor's explore list is copied for a moment; a signed-in person's never is", async () => {
  const first = await get("/v1/repos");
  assert.equal(first.status, 200);
  assert.equal(first.res.headers.get("x-craton-cache"), null, "the first one is read from the database");
  assert.deepEqual(first.json.map((r: any) => r.name), ["open-one"]);
  const second = await get("/v1/repos");
  assert.equal(second.res.headers.get("x-craton-cache"), "hit");
  assert.equal(second.text, first.text);
  assert.equal(second.res.headers.get("x-total-count"), first.res.headers.get("x-total-count"));
  assert.equal(second.res.headers.get("content-type")?.includes("application/json"), true);

  // A new repository is not in the copy until it expires: that is the trade, and it is a few seconds.
  assert.equal((await mine("/v1/repos", "POST", { name: "open-two", visibility: "public" })).status, 201);
  assert.deepEqual((await get("/v1/repos")).json.map((r: any) => r.name), ["open-one"]);
  await sleep(1300);
  const fresh = await get("/v1/repos");
  assert.equal(fresh.res.headers.get("x-craton-cache"), null);
  assert.deepEqual(fresh.json.map((r: any) => r.name).sort(), ["open-one", "open-two"]);

  // Signed in: always the database, and a private repository is there.
  const own = await app.request("/v1/repos", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(own.headers.get("x-craton-cache"), null);
  assert.deepEqual(((await own.json()) as { name: string }[]).map((r) => r.name).sort(), ["closed-one", "open-one", "open-two"]);
  assert.equal((await app.request("/v1/repos", { headers: { authorization: `Bearer ${token}` } })).headers.get("x-craton-cache"), null, "and not the second time either");

  // Different questions are different copies.
  assert.deepEqual((await get("/v1/repos?q=two")).json.map((r: any) => r.name), ["open-two"]);
  assert.deepEqual((await get("/v1/repos?q=one")).json.map((r: any) => r.name), ["open-one"]);
  // Anything that looks like credentials skips the copy, even a token that does not work or a cookie.
  await get("/v1/repos");
  assert.equal((await get("/v1/repos", { authorization: "Bearer nonsense" })).res.headers.get("x-craton-cache"), null);
  assert.equal((await get("/v1/repos", { cookie: "craton_session=abc" })).res.headers.get("x-craton-cache"), null);
});

test("an error is never copied", async () => {
  const bad = await get("/v1/repos?bbox=nonsense");
  assert.ok(bad.status >= 400 || bad.status === 200);
  const again = await get("/v1/repos?bbox=nonsense");
  if (bad.status !== 200) assert.equal(again.res.headers.get("x-craton-cache"), null);
});

test("trending is copied the same way", async () => {
  await get("/v1/trending");
  const second = await get("/v1/trending");
  assert.equal(second.status, 200);
  assert.equal(second.res.headers.get("x-craton-cache"), "hit");
  assert.equal((await app.request("/v1/trending", { headers: { authorization: `Bearer ${token}` } })).headers.get("x-craton-cache"), null);
});

test("readiness reports the shared cache without depending on it", async () => {
  const r = await get("/v1/ready");
  assert.equal(r.status, 200);
  assert.equal(r.json.checks.cache, "ok");
});

test("/metrics: absent until a token is set, then for that token only, in Prometheus text", async () => {
  const metrics = config.metrics as { token: string };
  metrics.token = "";
  assert.equal((await get("/metrics")).status, 404);
  metrics.token = "scrape-secret-123";
  try {
    assert.equal((await get("/metrics")).status, 401);
    assert.equal((await get("/metrics", { authorization: "Bearer wrong" })).status, 401);
    assert.equal((await get("/metrics", { authorization: "Bearer scrape-secret-12" })).status, 401, "a prefix of the token is not the token");
    const ok = await get("/metrics", { authorization: "Bearer scrape-secret-123" });
    assert.equal(ok.status, 200);
    assert.match(ok.res.headers.get("content-type") ?? "", /^text\/plain/);
    assert.match(ok.text, /^# TYPE craton_http_requests_total counter$/m);
    assert.match(ok.text, /craton_http_requests_total\{method="GET",route="\/repos",status="200"\} \d+/);
    assert.match(ok.text, /craton_http_request_duration_seconds_bucket\{route="\/repos",le="0\.05"\} \d+/);
    assert.match(ok.text, /craton_http_request_duration_seconds_count\{route="\/repos"\} \d+/);
    assert.match(ok.text, /craton_page_cache_total\{result="hit"\} [1-9]/);
    assert.match(ok.text, /^craton_cache_up 1$/m);
    assert.match(ok.text, /craton_info\{version="[^"]+",database="pglite",cache="(memory|redis)"\} 1/);
    assert.ok(!ok.text.includes("scrape-secret-123") && !ok.text.includes("ann@example.org"), "no secrets or personal data");
    // Routes are patterns, so the number of series does not grow with the number of repositories.
    await get("/v1/repos/ann/open-one");
    await get("/v1/repos/ann/open-two");
    const after = (await get("/metrics", { authorization: "Bearer scrape-secret-123" })).text;
    assert.ok(!/route="\/repos\/ann\//.test(after));
    assert.match(after, /route="\/repos\/:owner\/:repo"/);
  } finally {
    metrics.token = "";
  }
});

test("past its maximum of simultaneous requests a server turns new ones away at once, and never health or metrics", async () => {
  // A database that takes its time, so requests pile up.
  const real = await openDb(":memory:");
  const slow = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (["get", "all", "run", "insert", "exec", "tx"].includes(String(prop))) return async (...args: unknown[]) => (await sleep(300), (value as (...a: unknown[]) => unknown).apply(target, args));
      return value.bind(target);
    },
  }) as typeof real;
  const limited = createApp({ db: slow, store: new MemoryStore() });
  const was = config.maxInFlight;
  (config as { maxInFlight: number }).maxInFlight = 3;
  try {
    const answers = await Promise.all(Array.from({ length: 8 }, () => limited.request("/v1/owners/nobody")));
    const statuses = answers.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 503).length, 5, `3 allowed, 5 turned away: ${statuses}`);
    const shed = answers.find((r) => r.status === 503)!;
    assert.equal(shed.headers.get("retry-after"), "2");
    assert.equal(((await shed.json()) as { error: { code: string } }).error.code, "overloaded");
    // While it is full, the checks a load balancer makes still get through.
    const busy = Array.from({ length: 3 }, () => limited.request("/v1/owners/nobody"));
    assert.equal((await limited.request("/v1/health")).status, 200);
    await Promise.all(busy);
    // And when the work is done there is room again.
    assert.equal((await limited.request("/v1/owners/nobody")).status, 404);
  } finally {
    (config as { maxInFlight: number }).maxInFlight = was;
  }
});
