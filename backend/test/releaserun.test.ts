// A release can say which model run produced it. The description is checked field by field, stored with the release,
// returned with it and carried into the STAC export; a release without one is unchanged.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { cleanRun } from "../src/services/releases.ts";

let app: ReturnType<typeof createApp>;
let token = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json };
}

before(async () => {
  app = createApp({ db: openDb(":memory:"), store: new MemoryStore() } as Ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "basin", visibility: "private", sample: true })).status, 201);
});

const RUN = { software: "HEC-RAS", version: "6.5", plan: "p01 100-year flood", runtimeSeconds: 5400.25, completedAt: "2026-10-16T08:30:00Z", notes: "Manning n from calibration v3.", inputs: [{ repo: "hydrolab/chalakudy-basin", commit: "ABCDEF1234567", note: "terrain" }] };

test("a release keeps the run it was made from, and hands it back", async () => {
  const made = await call("POST", "/repos/rhea/basin/releases", { tag: "v1.0.0", title: "Flood run", run: RUN });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.deepEqual(made.json.run, { ...RUN, completedAt: "2026-10-16T08:30:00.000Z", inputs: [{ repo: "hydrolab/chalakudy-basin", commit: "abcdef1234567", note: "terrain" }] }, "commits are lower-cased, times normalised");
  const listed = (await call("GET", "/repos/rhea/basin/releases")).json;
  assert.equal(listed[0].run.software, "HEC-RAS");
});

test("a release without one has none, and an empty run is no run", async () => {
  assert.equal((await call("POST", "/repos/rhea/basin/releases", { tag: "v1.1.0" })).json.run, null);
  assert.equal((await call("POST", "/repos/rhea/basin/releases", { tag: "v1.2.0", run: {} })).json.run, null);
  assert.equal(cleanRun(null), null);
});

test("anything unexpected is refused, with what to use instead", async () => {
  const bad = async (run: unknown) => (await call("POST", "/repos/rhea/basin/releases", { tag: "v9.0.0", run })).status;
  assert.equal(await bad("HEC-RAS"), 400, "not an object");
  assert.equal(await bad({ engine: "x" }), 400, "unknown field");
  assert.equal(await bad({ runtimeSeconds: -1 }), 400);
  assert.equal(await bad({ runtimeSeconds: "fast" }), 400);
  assert.equal(await bad({ completedAt: "yesterday-ish" }), 400);
  assert.equal(await bad({ software: "x".repeat(81) }), 400);
  assert.equal(await bad({ notes: "bell\u0007" }), 400);
  assert.equal(await bad({ inputs: [{ repo: "not a repo", commit: "abcdef1" }] }), 400);
  assert.equal(await bad({ inputs: [{ repo: "a/b", commit: "main" }] }), 400, "a commit id, not a branch name");
  assert.equal(await bad({ inputs: [{ repo: "a/b", commit: "abcdef1", extra: 1 }] }), 400);
  assert.equal(await bad({ inputs: Array.from({ length: 51 }, () => ({ repo: "a/b", commit: "abcdef1" })) }), 400);
  assert.equal((await call("GET", "/repos/rhea/basin/releases")).json.some((r: any) => r.tag === "v9.0.0"), false, "nothing was published");
});

test("the STAC collection carries the run", async () => {
  const c = (await call("GET", "/repos/rhea/basin/releases/v1.0.0/stac/collection.json")).json;
  assert.equal(c["craton:run"].plan, "p01 100-year flood");
  assert.equal((await call("GET", "/repos/rhea/basin/releases/v1.1.0/stac/collection.json")).json["craton:run"], undefined);
});
