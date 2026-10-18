// Hostile and malformed input: nothing here may crash the server, leak a path, or read without a ceiling.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let app: ReturnType<typeof createApp>;
let token = "";

const call = (method: string, path: string, body?: string | Uint8Array | null, headers: Record<string, string> = {}) =>
  app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body });

before(async () => {
  app = createApp({ db: await openDb(":memory:"), store: new MemoryStore() } as Ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  const made = await call("POST", "/repos", JSON.stringify({ name: "basin", visibility: "private", sample: true }), { "content-type": "application/json" });
  assert.equal(made.status, 201);
});

test("path traversal in file routes finds nothing and never errors", async () => {
  const probes = [
    "/repos/rhea/basin/raw/main/..%2F..%2Fetc%2Fpasswd",
    "/repos/rhea/basin/raw/main/../../../etc/passwd",
    "/repos/rhea/basin/file/main/..%5C..%5Cwindows%5Cwin.ini",
    "/repos/rhea/basin/render/main/%2e%2e/%2e%2e/secret.tif",
    "/repos/rhea/basin/raw/main/terrain%00/basin_dem.tif",
    "/repos/rhea/basin/archive/main?path=../../",
    "/repos/rhea/basin/tree/main?path=../..",
  ];
  for (const p of probes) {
    const res = await call("GET", p);
    assert.ok([200, 400, 404, 415].includes(res.status), `${p} -> ${res.status}`);
    const text = await res.text();
    assert.ok(!/root:|\[fonts\]|ENOENT|node_modules/i.test(text.slice(0, 2000)), `${p} leaked: ${text.slice(0, 120)}`);
  }
});

test("a JSON body past the ceiling is refused with 413, however it is sent", async () => {
  const huge = JSON.stringify({ name: "x".repeat(17 * 1024 * 1024) });
  const res = await call("POST", "/repos", huge, { "content-type": "application/json" });
  assert.equal(res.status, 413);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, "too_large");
  // A stream with no declared length is cut off too, rather than read to the end.
  const chunk = new TextEncoder().encode("a".repeat(1024 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= 40) return controller.close();
      sent++;
      controller.enqueue(chunk);
    },
  });
  const res2 = await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: stream, duplex: "half" } as RequestInit);
  assert.equal(res2.status, 413);
  assert.ok(sent < 40, `read ${sent} MB before refusing`);
});

test("ordinary JSON still works, and a malformed body is a 400, not a crash", async () => {
  const bad = await call("POST", "/repos", "{not json", { "content-type": "application/json" });
  assert.equal(bad.status, 400);
  const ok = await call("POST", "/repos", JSON.stringify({ name: "second", visibility: "private" }), { "content-type": "application/json" });
  assert.equal(ok.status, 201);
});

test("an oversized chunk is refused without being stored", async () => {
  const hash = "0".repeat(64);
  const res = await call("PUT", `/repos/rhea/basin/chunks/${hash}`, new Uint8Array(2 * 1024 * 1024), { "content-type": "application/octet-stream" });
  assert.equal(res.status, 400);
});

test("every error is the JSON shape clients expect, including for unknown routes and methods", async () => {
  for (const [method, p] of [["GET", "/nope"], ["GET", "/repos/rhea/missing"], ["DELETE", "/health"], ["GET", "/repos/rhea/basin/raw/main/not-there.tif"]] as const) {
    const res = await call(method, p);
    assert.ok(res.status >= 400 && res.status < 500, `${method} ${p} -> ${res.status}`);
    const j = (await res.json()) as { error?: { code?: string; message?: string } };
    assert.ok(j.error?.code && j.error?.message, `${method} ${p}: ${JSON.stringify(j)}`);
  }
});

test("/ready says yes when database and store work, and 503 naming the part that does not", async () => {
  const ok = await app.request("/v1/ready");
  assert.equal(ok.status, 200);
  const body = (await ok.json()) as { ready: boolean; checks: Record<string, string> };
  assert.deepEqual([body.ready, body.checks.database, body.checks.store], [true, "ok", "ok"]);

  const broken = await createApp({ db: await openDb(":memory:"), store: { kind: "broken", put: async () => { throw new Error("disk is full"); }, get: async () => null, has: async () => false, delete: async () => {} } } as unknown as Ctx);
  const bad = await broken.request("/v1/ready");
  assert.equal(bad.status, 503);
  const detail = (await bad.json()) as { ready: boolean; checks: Record<string, string> };
  assert.equal(detail.ready, false);
  assert.equal(detail.checks.database, "ok");
  assert.match(detail.checks.store, /failed: disk is full/);
});

test("the access log is one JSON line per request, with route patterns and no secrets", async () => {
  const { config } = await import("../src/config.ts");
  const lines: string[] = [];
  const original = { enabled: config.accessLog.enabled, write: config.accessLog.write };
  config.accessLog.enabled = true;
  config.accessLog.write = (l) => void lines.push(l);
  try {
    const res = await call("GET", "/repos/rhea/basin?secret=not-in-the-log");
    assert.equal(res.status, 200);
    await app.request("/v1/health");
    assert.equal(lines.length, 2);
    const first = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(first).sort(), ["method", "ms", "path", "requestId", "status", "time", "user"]);
    assert.equal(first.method, "GET");
    assert.equal(first.path, "/v1/repos/:owner/:repo", "the route pattern, not the repository's name");
    assert.equal(first.status, 200);
    assert.equal(first.user, "rhea");
    assert.match(first.requestId, /^[0-9a-f-]{36}$/);
    assert.ok(!lines.join("").includes("not-in-the-log"), "no query string");
    assert.ok(!lines.join("").includes(token), "no token");
    assert.equal(JSON.parse(lines[1]).user, null);
  } finally {
    config.accessLog.enabled = original.enabled;
    config.accessLog.write = original.write;
  }
});
