// schema.org Dataset markup for a public repository, following Google's Dataset structured data guidelines.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
const call = (method: string, p: string, body?: unknown, auth = true) =>
  app.request(`/v1${p}`, { method, headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
async function put(repo: string, name: string, text: string) {
  const form = new FormData();
  form.append("file", new File([text], name.split("/").pop()!));
  form.append("paths", JSON.stringify([name]));
  form.append("branch", "main");
  return app.request(`/v1/repos/${repo}/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
});

test("a public repository is described with the fields Google asks for, built from what it has", async () => {
  assert.equal((await call("POST", "/repos", { name: "basin", visibility: "public", description: "Terrain." })).status, 201);
  assert.equal((await call("PATCH", "/repos/rhea/basin", { license: "CC-BY-4.0", topics: ["hydrology", "dem"] })).status, 200);
  assert.equal((await put("rhea/basin", "gauges.csv", "a,b\n1,2\n")).status, 201);
  assert.equal((await call("POST", "/repos/rhea/basin/releases", { tag: "v1.0.0", name: "First", target: "main", notes: "" })).status, 201);
  const res = await call("GET", "/repos/rhea/basin/dataset.jsonld", undefined, false);
  assert.equal(res.status, 200);
  const d = (await res.json()) as Record<string, any>;
  assert.equal(d["@context"], "https://schema.org");
  assert.equal(d["@type"], "Dataset");
  assert.equal(d.name, "rhea/basin");
  assert.ok(d.description.length >= 50 && d.description.length <= 5000, `description length ${d.description.length}`);
  assert.match(d.description, /^Terrain\. basin is a geospatial dataset/);
  assert.match(d.description, /1 file, /);
  assert.equal(d.license, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(d.version, "v1.0.0");
  assert.equal(d.isAccessibleForFree, true);
  assert.deepEqual(d.creator, { "@type": "Person", name: "rhea", url: "http://localhost:3100/rhea" });
  assert.deepEqual(d.keywords, ["hydrology", "dem"]);
  assert.equal(d.distribution[0].contentUrl, "http://localhost:3100/rhea/basin/archive?ref=v1.0.0");
  assert.equal(d.url, "http://localhost:3100/rhea/basin");
  assert.equal(d.spatialCoverage, undefined, "nothing spatial in a table, so no coverage is claimed");
});

test("a long description is cut at 5,000 characters, nothing is invented without facts, and a private repository is not described", async () => {
  assert.equal((await call("POST", "/repos", { name: "bare", visibility: "public" })).status, 201);
  const bare = (await (await call("GET", "/repos/rhea/bare/dataset.jsonld", undefined, false)).json()) as Record<string, any>;
  assert.ok(bare.description.length >= 50);
  assert.equal(bare.license, undefined);
  assert.equal(bare.version, undefined);
  assert.equal(bare.keywords, undefined);
  assert.equal((await call("PATCH", "/repos/rhea/bare", { description: "x".repeat(6000) })).status, 200);
  const long = (await (await call("GET", "/repos/rhea/bare/dataset.jsonld", undefined, false)).json()) as Record<string, any>;
  assert.equal(long.description.length, 5000);

  assert.equal((await call("POST", "/repos", { name: "hidden", visibility: "private" })).status, 201);
  assert.equal((await call("GET", "/repos/rhea/hidden/dataset.jsonld")).status, 404, "even its owner gets no public markup for it");
});
