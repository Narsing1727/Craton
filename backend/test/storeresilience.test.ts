// An object store that has a bad moment (503 SlowDown, a reset connection, a call that never answers, role credentials that ran out) must not
// fail a push; one that is really down must be refused at once with a 503 the API can explain, and must be probed again by itself.

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import { S3Store } from "../src/storage/s3-store.ts";
import { R2Store } from "../src/storage/r2-store.ts";
import { StorageUnavailableError, storeStats } from "../src/storage/resilient.ts";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { render } from "../src/api/metrics.ts";
import type { ChunkStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

type Step = "ok" | "503" | "500" | "429" | "reset" | "hang" | "403-expired" | "403-denied" | "400-timeout";
let script: Step[] = [];
let fallback: Step = "ok";
let hits = 0;
const objects = new Map<string, Buffer>();
const sockets = new Set<import("node:net").Socket>();
let server: http.Server;
let endpoint = "";

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      hits++;
      const step = script.shift() ?? fallback;
      const url = req.url ?? "";
      const fail = (status: number, code: string, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/xml", ...headers });
        res.end(`<Error><Code>${code}</Code></Error>`);
      };
      if (step === "reset") return void req.socket.destroy();
      if (step === "hang") return; // never answers
      if (step === "503") return fail(503, "SlowDown");
      if (step === "500") return fail(500, "InternalError");
      if (step === "429") return fail(429, "TooManyRequests", { "retry-after": "0" });
      if (step === "403-expired") return fail(403, "ExpiredToken");
      if (step === "403-denied") return fail(403, "AccessDenied");
      if (step === "400-timeout") return fail(400, "RequestTimeout");
      if (req.method === "PUT") {
        objects.set(url, Buffer.concat(chunks));
        res.statusCode = 200;
        return res.end();
      }
      if (req.method === "DELETE") {
        objects.delete(url);
        res.statusCode = 204;
        return res.end();
      }
      const body = objects.get(url);
      if (!body) {
        res.statusCode = 404;
        return res.end();
      }
      res.statusCode = 200;
      res.end(req.method === "HEAD" ? undefined : body);
    });
  });
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  for (const s of sockets) s.destroy();
  server.close();
});
beforeEach(() => {
  script = [];
  fallback = "ok";
  hits = 0;
  objects.clear();
});

const HASH = "cd" + "e".repeat(62);
// Short waits so the suite stays fast; the logic is the same as with the real defaults.
const fast = { attempts: 4, baseMs: 2, maxMs: 10, timeoutMs: 400, perMegabyteMs: 0, breakerFailures: 2, breakerOpenMs: 300 };
const make = (retry = {}) => new S3Store({ bucket: "b", region: "us-east-1", endpoint, accessKeyId: "a", secretAccessKey: "s", retry: { ...fast, ...retry } });

test("a few 503 SlowDown answers are tried again and the write goes through", async () => {
  const before = storeStats.retries;
  script = ["503", "503"];
  await make().put(HASH, Buffer.from("payload"));
  assert.equal(hits, 3, "two refusals, then the write");
  assert.equal(storeStats.retries - before, 2);
  assert.deepEqual(await make().get(HASH), Buffer.from("payload"));
});

test("500, 429 (with Retry-After) and the 400 RequestTimeout S3 sometimes sends are all tried again", async () => {
  script = ["500", "429", "400-timeout"];
  await make().put(HASH, Buffer.from("x"));
  assert.equal(hits, 4);
});

test("a connection reset in the middle is tried again", async () => {
  script = ["reset", "reset"];
  assert.deepEqual(await make().get(HASH), null, "the object is not there, which is a plain answer once the store answers");
  assert.equal(hits, 3);
});

test("a call that never answers times out and is tried again instead of hanging the push", async () => {
  const before = storeStats.timeouts;
  script = ["hang"];
  const started = Date.now();
  await make({ timeoutMs: 150 }).put(HASH, Buffer.from("slow"));
  assert.ok(Date.now() - started < 2000);
  assert.ok(storeStats.timeouts > before);
  assert.equal(objects.size, 1);
});

test("an answer that is the caller's fault is not tried again: 404 is absence, 403 AccessDenied is an error", async () => {
  const store = make();
  assert.equal(await store.has(HASH), false);
  assert.equal(await store.get(HASH), null);
  assert.equal(hits, 2, "each asked once");
  hits = 0;
  script = ["403-denied"];
  await assert.rejects(store.put(HASH, Buffer.from("x")), (err: Error) => !(err instanceof StorageUnavailableError) && /403/.test(err.message));
  assert.equal(hits, 1, "no retries for a permission problem");
});

test("a failed HEAD is not read as 'the chunk is missing'", async () => {
  script = ["403-denied"];
  await assert.rejects(make().has(HASH), /403/);
});

test("when every try fails the call says the store is unavailable, after exactly the attempts it was given", async () => {
  fallback = "503";
  await assert.rejects(make().put(HASH, Buffer.from("x")), (err: Error) => err instanceof StorageUnavailableError && /after 4 tries/.test(err.message) && /503 SlowDown/.test(err.message));
  assert.equal(hits, 4);
});

test("after repeated failures the store counts as down: calls are refused at once, then one probe finds it back", async () => {
  const store = make();
  fallback = "503";
  for (let i = 0; i < 2; i++) await assert.rejects(store.get(HASH), StorageUnavailableError);
  hits = 0;
  const started = Date.now();
  await assert.rejects(store.get(HASH), (err: Error) => err instanceof StorageUnavailableError && /not answering/.test(err.message));
  assert.ok(Date.now() - started < 50, "refused without a round trip");
  assert.equal(hits, 0, "the store is not even asked while it is marked down");
  // the store recovers; after the cool-off one probe goes through and normal service resumes
  fallback = "ok";
  await new Promise((r) => setTimeout(r, 350));
  await store.put(HASH, Buffer.from("back"));
  assert.deepEqual(await store.get(HASH), Buffer.from("back"));
});

test("a probe that fails keeps the store marked down", async () => {
  const store = make({ breakerFailures: 1, breakerOpenMs: 200 });
  fallback = "503";
  await assert.rejects(store.get(HASH), StorageUnavailableError);
  await new Promise((r) => setTimeout(r, 250));
  hits = 0;
  await assert.rejects(store.get(HASH), /after 4 tries/); // the probe, which tried all its attempts
  assert.equal(hits, 4);
  hits = 0;
  await assert.rejects(store.get(HASH), /not answering/);
  assert.equal(hits, 0);
});

test("role credentials that ran out are fetched again and the call repeated, without using up a try", async () => {
  let fetched = 0;
  const store = new S3Store({
    bucket: "b",
    region: "us-east-1",
    endpoint,
    retry: { ...fast, attempts: 1 },
    credentials: async () => ({ accessKeyId: "ASIA", secretAccessKey: "s", sessionToken: `t${++fetched}`, expiresAt: Date.now() + 3_600_000 }),
  });
  script = ["403-expired"];
  await store.put(HASH, Buffer.from("fresh"));
  assert.equal(fetched, 2);
  assert.equal(hits, 2);
});

test("R2 gets the same treatment", async () => {
  const r2 = new R2Store({ accountId: "acct", bucket: "b", accessKeyId: "a", secretAccessKey: "s", retry: fast });
  // R2 talks https to its own host; point the request at the stand-in by swapping the address it builds
  (r2 as unknown as { host: string }).host = endpoint.replace("http://", "");
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: unknown, init?: RequestInit) => realFetch(String(input).replace("https://", "http://"), init)) as typeof fetch;
  try {
    script = ["503", "reset"];
    await r2.put(HASH, Buffer.from("r2"));
    assert.deepEqual(await r2.get(HASH), Buffer.from("r2"));
    assert.equal(hits, 4);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the API answers 503 with Retry-After and a plain message when the storage is away, and the metrics count it", async () => {
  const down: ChunkStore = {
    kind: "down",
    put: async () => Promise.reject(new StorageUnavailableError("the store did not answer")),
    replace: async () => Promise.reject(new StorageUnavailableError("the store did not answer")),
    get: async () => Promise.reject(new StorageUnavailableError("the store did not answer")),
    has: async () => false,
    delete: async () => undefined,
  };
  const app = createApp({ db: await openDb(":memory:"), store: down } as Ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "kavi", email: "kavi@example.org", password: "a-very-long-password" }) });
  const token = ((await res.json()) as { token: string }).token;
  const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: h, body: JSON.stringify({ name: "basin", visibility: "private" }) })).status, 201);
  const data = Buffer.from("some bytes");
  const hash = createHash("sha256").update(data).digest("hex");
  const up = await app.request(`/v1/repos/kavi/basin/chunks/${hash}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: data });
  assert.equal(up.status, 503);
  assert.ok(Number(up.headers.get("retry-after")) >= 1);
  const body = (await up.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "storage_unavailable");
  assert.ok(!/did not answer/.test(body.error.message), "the internal reason stays in the log");
  const text = render({ version: "t", database: { kind: "pglite", pool: null }, cache: { kind: "memory", status: "ok" } });
  assert.match(text, /craton_object_store_total\{kind="retries"\} \d+/);
  assert.match(text, /craton_object_store_total\{kind="breaker_opened"\} \d+/);
});
