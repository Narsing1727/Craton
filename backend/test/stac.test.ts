// STAC export of a release: a Collection and one Item per file, with located files given real boxes and
// every asset carrying the release's own checksum.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let app: ReturnType<typeof createApp>;
let token = "";

async function call(method: string, path: string, body?: unknown, auth = true) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: { ...(auth ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, type: res.headers.get("content-type") ?? "" };
}

before(async () => {
  const ctx: Ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  const made = await call("POST", "/repos", { name: "basin", visibility: "private", sample: true });
  assert.equal(made.status, 201);
  assert.equal((await call("PATCH", "/repos/rhea/basin", { license: "CC-BY-4.0", description: "Sample basin for tests" })).status, 200);
  const rel = await call("POST", "/repos/rhea/basin/releases", { tag: "v1.0.0", title: "First release", notes: "Terrain, catchments and gauges." });
  assert.equal(rel.status, 201, JSON.stringify(rel.json));
});

test("the collection describes the release, with the data's real extent and the repository's licence", async () => {
  const r = await call("GET", "/repos/rhea/basin/releases/v1.0.0/stac/collection.json");
  assert.equal(r.status, 200);
  assert.match(r.type, /application\/json/);
  const c = r.json;
  assert.deepEqual([c.type, c.stac_version, c.license, c.title], ["Collection", "1.0.0", "CC-BY-4.0", "First release"]);
  assert.equal(c.id, "rhea-basin-v1.0.0");
  const [w, s, e, n] = c.extent.spatial.bbox[0];
  // The sample basin sits near Kochi (about 76.2 E, 10.3 N), not the world-box placeholder.
  assert.ok(w > 75 && e < 78 && s > 9 && n < 12, `bbox ${c.extent.spatial.bbox[0]}`);
  assert.ok(c.links.some((l: { rel: string }) => l.rel === "items"));
  assert.match(c["craton:merkle_root"], /^[0-9a-f]{64}$/);
});

test("each file is an Item with a geometry when it is located, and every asset carries its sha-256 as multihash", async () => {
  const r = await call("GET", "/repos/rhea/basin/releases/v1.0.0/stac/items.json");
  assert.equal(r.status, 200);
  assert.equal(r.json.type, "FeatureCollection");
  const byPath = new Map<string, any>(r.json.features.map((f: any) => [f.properties["craton:path"], f]));
  const dem = byPath.get("terrain/basin_dem.tif");
  assert.ok(dem, "the DEM is an item");
  assert.equal(dem.geometry.type, "Polygon");
  assert.equal(dem.assets.data.type, "image/tiff; application=geotiff");
  assert.match(dem.assets.data["file:checksum"], /^1220[0-9a-f]{64}$/);
  assert.ok(dem.assets.data["file:size"] > 0);
  assert.match(dem.assets.data.href, /\/v1\/repos\/rhea\/basin\/raw\/[0-9a-f]{64}\/terrain\/basin_dem\.tif$/);
  const csv = byPath.get("gauges.csv");
  assert.equal(csv.geometry, null, "a table has no footprint of its own");
  assert.equal(csv.assets.data.type, "text/csv");
  // The checksum in the item is the same one the release lists.
  const rel = (await call("GET", "/repos/rhea/basin/releases")).json[0];
  const listed = rel.checksums.find((x: { path: string }) => x.path === "terrain/basin_dem.tif").sha256;
  assert.equal(dem.assets.data["file:checksum"], `1220${listed}`);
});

test("an unknown release is not found, and a private repository stays private", async () => {
  assert.equal((await call("GET", "/repos/rhea/basin/releases/v9/stac/collection.json")).status, 404);
  assert.equal((await call("GET", "/repos/rhea/basin/releases/v1.0.0/stac/collection.json", undefined, false)).status, 404);
});
