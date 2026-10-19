// When the database can not be reached (a restart, a failover, no free connection, a statement past its limit), the API says so with 503 and
// Retry-After, instead of "something went wrong"; a request that is merely wrong is still a 4xx and a bug is still a 500.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { isDatabaseUnavailable, openDb, type DB } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";

test("which errors mean the database is unreachable or too busy", () => {
  const e = (props: Record<string, unknown>, message = "x") => Object.assign(new Error(message), props);
  for (const err of [
    e({ code: "ECONNREFUSED" }),
    e({ code: "ECONNRESET" }),
    e({ code: "ETIMEDOUT" }),
    e({ code: "57P01" }), // terminating connection due to administrator command (a failover)
    e({ code: "57P03" }), // the database system is starting up
    e({ code: "53300" }), // too many connections
    e({ code: "08006" }), // connection failure
    e({ code: "57014" }), // the statement ran past its limit
    e({}, "Connection terminated unexpectedly"),
    e({}, "timeout exceeded when trying to connect"),
    e({ errors: [{ code: "ECONNREFUSED" }] }, "AggregateError"),
  ]) assert.equal(isDatabaseUnavailable(err), true, `${err.code ?? err.message}`);
  for (const err of [e({ code: "23505" }), e({ code: "42601" }), e({ code: "22P02" }), e({}, "Cannot read properties of undefined"), null, undefined]) assert.equal(isDatabaseUnavailable(err), false);
});

test("an unreachable database is a 503 with Retry-After; the readiness check says so too; a bug is still a 500", async () => {
  const real = await openDb(":memory:");
  let mode: "up" | "down" | "bug" = "up";
  // The same database, with a switch that makes every statement fail the way a dropped connection does.
  const flaky = new Proxy(real, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (["get", "all", "run", "insert", "exec", "tx"].includes(String(prop))) {
        return (...args: unknown[]) => {
          if (mode === "down") return Promise.reject(Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { code: "ECONNREFUSED" }));
          if (mode === "bug") return Promise.reject(new TypeError("Cannot read properties of undefined (reading 'x')"));
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return value.bind(target);
    },
  }) as DB;
  const app = createApp({ db: flaky, store: new MemoryStore() });

  assert.equal((await app.request("/v1/repos")).status, 200);
  assert.equal((await app.request("/v1/owners/nobody")).status, 404, "an unknown name is a 404 while the database is up");
  mode = "down";
  // The explore list for a visitor was copied a moment ago, so it is still served while the database is away.
  const stillThere = await app.request("/v1/repos");
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.headers.get("x-craton-cache"), "hit");
  const down = await app.request("/v1/owners/nobody");
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("retry-after"), "5");
  const body = (await down.json()) as { error: { code: string; message: string } };
  assert.equal(body.error.code, "database_unavailable");
  assert.ok(!/ECONNREFUSED|10\.0\.0\.5/.test(body.error.message), "no addresses or internals in the answer");
  const ready = await app.request("/v1/ready");
  assert.equal(ready.status, 503);
  assert.match(JSON.stringify(await ready.json()), /database/);
  assert.equal((await app.request("/v1/health")).status, 200, "the process itself is alive, which is what health means");

  mode = "bug";
  const bug = await app.request("/v1/owners/nobody");
  assert.equal(bug.status, 500);
  assert.equal(((await bug.json()) as { error: { code: string } }).error.code, "internal");

  mode = "up";
  assert.equal((await app.request("/v1/owners/nobody")).status, 404, "and it recovers by itself");
});
