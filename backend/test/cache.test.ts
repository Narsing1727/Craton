// The shared cache: the in-memory and the Redis implementation behave the same; servers sharing Redis share their counters; and a Redis that
// is not answering costs nothing but the sharing (it never makes a request fail or wait).
// Redis tests run when CRATON_TEST_REDIS (e.g. redis://localhost:6380) is set; the rest always run.

import { test } from "node:test";
import assert from "node:assert/strict";
import { MemoryCache, RedisCache, type Cache } from "../src/cache/cache.ts";

const REDIS = process.env.CRATON_TEST_REDIS ?? "";
const prefix = () => `ct${process.pid}:${Math.random().toString(36).slice(2, 8)}:`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const kinds: [string, () => Cache][] = [["memory", () => new MemoryCache()]];
if (REDIS) kinds.push(["redis", () => new RedisCache(REDIS, prefix())]);

for (const [name, make] of kinds) {
  test(`${name}: values come back as bytes and expire`, async () => {
    const c = make();
    assert.equal(await c.get("missing"), null);
    await c.set("a", Buffer.from([0, 1, 2, 255]), 30);
    assert.deepEqual([...(await c.get("a"))!], [0, 1, 2, 255]);
    await c.set("text", "hello", 30);
    assert.equal((await c.get("text"))!.toString(), "hello");
    await c.set("short", "x", 1);
    await sleep(1300);
    assert.equal(await c.get("short"), null, "gone after its time");
    await c.del("a", "text");
    assert.equal(await c.get("a"), null);
    assert.equal(await c.status(), "ok");
    await c.close();
  });

  test(`${name}: a sliding window lets max hits through and then says when to come back`, async () => {
    const c = make();
    const w = { max: 3, windowMs: 1500 };
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await c.hit("k", w));
    assert.deepEqual(results.map((r) => r.allowed), [true, true, true, false, false]);
    assert.deepEqual(results.map((r) => r.remaining), [2, 1, 0, 0, 0]);
    assert.ok(results[3].resetMs > 0 && results[3].resetMs <= 1500);
    assert.equal(results[0].limit, 3);
    assert.equal(await c.count("k", 1500), 3, "refused hits are not counted");
    await c.clear("k");
    assert.equal(await c.count("k", 1500), 0);
    assert.equal((await c.hit("k", w)).allowed, true, "clearing starts it over");
    await sleep(1700);
    assert.equal(await c.count("k", 1500), 0, "the window slides");
    assert.equal((await c.hit("k", w)).remaining, 2);
    await c.close();
  });

  test(`${name}: simultaneous hits never let more than max through`, async () => {
    const c = make();
    const out = await Promise.all(Array.from({ length: 40 }, () => c.hit("race", { max: 10, windowMs: 5000 })));
    assert.equal(out.filter((r) => r.allowed).length, 10);
    await c.close();
  });
}

test("memory: the least recently used entries are dropped first when it is full", async () => {
  const c = new MemoryCache();
  for (let i = 0; i < 5100; i++) await c.set(`k${i}`, "v", 60);
  assert.equal(await c.get("k0"), null);
  assert.ok(await c.get("k5099"));
  await c.close();
});

if (REDIS) {
  test("redis: servers that share it share their counters, and what one stores another reads", async () => {
    const shared = prefix();
    const a = new RedisCache(REDIS, shared);
    const b = new RedisCache(REDIS, shared);
    const w = { max: 4, windowMs: 5000 };
    const first = await Promise.all([a.hit("login", w), b.hit("login", w), a.hit("login", w), b.hit("login", w)]);
    assert.equal(first.filter((r) => r.allowed).length, 4);
    assert.equal((await a.hit("login", w)).allowed, false, "the fifth is refused whichever server it reaches");
    assert.equal((await b.hit("login", w)).allowed, false);
    await a.set("tile", Buffer.from("png-bytes"), 30);
    assert.equal((await b.get("tile"))!.toString(), "png-bytes");
    // Another installation's keys (another prefix) are not touched.
    const other = new RedisCache(REDIS, prefix());
    assert.equal(await other.get("tile"), null);
    assert.equal((await other.hit("login", w)).allowed, true);
    await Promise.all([a.close(), b.close(), other.close()]);
  });
}

test("a Redis that is not there: calls answer at once, counters fall back to this server, nothing throws", async () => {
  const c = new RedisCache("redis://127.0.0.1:1", prefix()); // nothing listens on port 1
  const started = Date.now();
  assert.equal(await c.get("x"), null);
  await c.set("x", "y", 10);
  await c.del("x");
  const w = { max: 2, windowMs: 5000 };
  const hits = [await c.hit("k", w), await c.hit("k", w), await c.hit("k", w)];
  assert.deepEqual(hits.map((r) => r.allowed), [true, true, false], "this server still counts, for itself");
  assert.equal(await c.count("k", 5000), 2);
  await c.clear("k");
  assert.equal(await c.count("k", 5000), 0);
  assert.match(await c.status(), /^degraded/);
  assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms: it must not wait on a Redis that is away`);
  await c.close();
});
