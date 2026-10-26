// A request keeps the trace it arrived with (W3C traceparent) and the answer names this server's span; a server that is being stopped says so
// to the load balancer (readiness 503, Connection: close) before it closes anything.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { parseTraceparent, startTrace } from "../src/api/trace.ts";
import { lifecycle } from "../src/api/lifecycle.ts";
import { config } from "../src/config.ts";
import type { Ctx } from "../src/services/context.ts";

after(() => {
  lifecycle.draining = false;
});

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";

test("only a well-formed traceparent is believed", () => {
  assert.deepEqual(parseTraceparent(`00-${TRACE}-00f067aa0ba902b7-01`), { traceId: TRACE, flags: "01" });
  assert.deepEqual(parseTraceparent(`00-${TRACE.toUpperCase()}-00F067AA0BA902B7-00`), { traceId: TRACE, flags: "00" }, "case does not matter");
  for (const bad of [undefined, "", "garbage", `00-${TRACE}-00f067aa0ba902b7`, `ff-${TRACE}-00f067aa0ba902b7-01`, `00-${"0".repeat(32)}-00f067aa0ba902b7-01`, `00-${TRACE}-${"0".repeat(16)}-01`, `00-${TRACE.slice(1)}-00f067aa0ba902b7-01`]) {
    assert.equal(parseTraceparent(bad), null, String(bad));
  }
  const fresh = startTrace(undefined);
  assert.match(fresh.header, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  assert.notEqual(startTrace(undefined).traceId, fresh.traceId, "a new trace each time");
});

test("the API continues the caller's trace, starts one when there is none, and logs the trace id", async () => {
  const lines: string[] = [];
  const write = config.accessLog.write;
  const enabled = config.accessLog.enabled;
  config.accessLog.enabled = true;
  config.accessLog.write = (line) => void lines.push(line);
  try {
    const app = createApp({ db: await openDb(":memory:"), store: new MemoryStore() } as Ctx);
    const given = await app.request("/v1/health", { headers: { traceparent: `00-${TRACE}-00f067aa0ba902b7-01` } });
    const answer = given.headers.get("traceparent")!;
    assert.match(answer, new RegExp(`^00-${TRACE}-[0-9a-f]{16}-01$`));
    assert.ok(!answer.includes("00f067aa0ba902b7"), "the answer names this server's own span, not the caller's");
    const none = await app.request("/v1/health");
    assert.match(none.headers.get("traceparent")!, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const bad = await app.request("/v1/health", { headers: { traceparent: "not a trace" } });
    assert.match(bad.headers.get("traceparent")!, /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/, "a bad header is ignored, not an error");
    assert.equal(bad.status, 200);
    const logged = lines.map((l) => JSON.parse(l) as { traceId: string });
    assert.equal(logged[0].traceId, TRACE);
    assert.equal(logged.length, 3);
    assert.ok(logged.every((l) => /^[0-9a-f]{32}$/.test(l.traceId)));
  } finally {
    config.accessLog.enabled = enabled;
    config.accessLog.write = write;
  }
});

test("a draining server fails readiness at once, tells clients to reconnect elsewhere, and keeps serving the requests it already has", async () => {
  const app = createApp({ db: await openDb(":memory:"), store: new MemoryStore() } as Ctx);
  const up = await app.request("/v1/ready");
  assert.equal(up.status, 200);
  assert.notEqual(up.headers.get("connection"), "close");
  lifecycle.draining = true;
  try {
    const res = await app.request("/v1/ready");
    assert.equal(res.status, 503, "not from the five-second copy of the last answer");
    assert.deepEqual(((await res.json()) as { checks: Record<string, string> }).checks, { server: "draining" });
    assert.equal(res.headers.get("connection"), "close");
    const other = await app.request("/v1/repos");
    assert.equal(other.status, 200, "requests that still arrive are answered");
    assert.equal(other.headers.get("connection"), "close");
  } finally {
    lifecycle.draining = false;
  }
  assert.equal((await app.request("/v1/ready")).status, 200, "and it comes back if the stop was cancelled");
});
