// GeoPackage metadata: layers, feature counts and the CRS each layer declares, read safely from an untrusted file.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { NotGpkgError, readGeoPackage } from "../src/checks/gpkg.ts";

function build(setup: (db: DatabaseSync) => void): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-gpkg-test-"));
  const file = path.join(dir, "t.gpkg");
  const db = new DatabaseSync(file);
  try {
    setup(db);
  } finally {
    db.close();
  }
  const data = fs.readFileSync(file);
  fs.rmSync(dir, { recursive: true, force: true });
  return data;
}

const SCHEMA = `
  CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER, definition TEXT, description TEXT);
  CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT, description TEXT, last_change TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, srs_id INTEGER);
`;

function standard(db: DatabaseSync) {
  db.exec("PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;");
  db.exec(SCHEMA);
  db.exec(`INSERT INTO gpkg_spatial_ref_sys VALUES ('WGS 84', 4326, 'EPSG', 4326, 'x', ''), ('WGS 84 / UTM 43N', 32643, 'EPSG', 32643, 'x', ''), ('Undefined cartesian', -1, 'NONE', -1, 'undefined', ''), ('Local', 100000, 'MYORG', 7, 'x', '')`);
  db.exec(`CREATE TABLE rivers (fid INTEGER PRIMARY KEY, geom BLOB, name TEXT); INSERT INTO rivers (name) VALUES ('a'), ('b'), ('c');`);
  db.exec(`CREATE TABLE gauges (fid INTEGER PRIMARY KEY, geom BLOB); INSERT INTO gauges (geom) VALUES (NULL);`);
  db.exec(`CREATE TABLE local (fid INTEGER PRIMARY KEY, geom BLOB);`);
  db.exec(`INSERT INTO gpkg_contents VALUES
    ('rivers', 'features', 'rivers', '', '', 75.0, 10.0, 76.0, 11.0, 32643),
    ('gauges', 'features', 'gauges', '', '', NULL, NULL, NULL, NULL, 4326),
    ('local',  'features', 'local',  '', '', 0, 0, 1, 1, 100000)`);
}

test("layers, counts, extents and each layer's EPSG code are read", async () => {
  const info = await readGeoPackage(build(standard));
  assert.equal(info.applicationId, "GPKG");
  assert.equal(info.userVersion, 10300);
  assert.equal(info.layers.length, 3);
  const by = Object.fromEntries(info.layers.map((l) => [l.table, l]));
  assert.deepEqual(by.rivers, { table: "rivers", type: "features", srsId: 32643, epsg: 32643, features: 3, extent: [75, 10, 76, 11] });
  assert.equal(by.gauges.epsg, 4326);
  assert.equal(by.gauges.extent, null);
  assert.equal(by.gauges.features, 1);
  assert.equal(by.local.epsg, null, "an authority other than EPSG is not an EPSG code");
});

test("a SQLite file that is not a GeoPackage, and bytes that are not SQLite, are refused", async () => {
  const plain = build((db) => db.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1);"));
  await assert.rejects(readGeoPackage(plain), NotGpkgError);
  await assert.rejects(readGeoPackage(Buffer.from("this is not a database at all, just a sentence of text")), /Not a SQLite file/);
});

test("a file whose metadata view never finishes is stopped at the time limit, and the temp file is removed", async () => {
  const hostile = build((db) => {
    db.exec("PRAGMA application_id = 1196444487;");
    db.exec(`CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER, organization TEXT, organization_coordsys_id INTEGER, definition TEXT);`);
    // A "table" that is really a view over an endless recursive query.
    db.exec(`CREATE VIEW gpkg_contents AS WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT 'a' AS table_name, 'features' AS data_type, x AS srs_id, 0 AS min_x, 0 AS min_y, 0 AS max_x, 0 AS max_y FROM c;`);
  });
  const before = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("craton-gpkg-")).length;
  const started = Date.now();
  await assert.rejects(readGeoPackage(hostile, 1500), /took longer than/);
  assert.ok(Date.now() - started < 6000, "returned promptly");
  const after = fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("craton-gpkg-") && !n.includes("test")).length;
  assert.ok(after <= before, "no temporary directory left behind");
});

// ── the gate ────────────────────────────────────────────────────────────────

import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { before } from "node:test";

let app: ReturnType<typeof createApp>;
let token = "";
const call = (method: string, p: string, body?: unknown) =>
  app.request(`/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
async function put(repo: string, name: string, data: Buffer) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name.split("/").pop()!));
  form.append("paths", JSON.stringify([name]));
  form.append("branch", "main");
  return app.request(`/v1/repos/${repo}/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
}

before(async () => {
  app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "vectors", visibility: "private" })).status, 201);
});

test("a GeoPackage layer in another CRS fails the coordinate system step, naming the layer", async () => {
  // Repositories default to EPSG:32643; the "gauges" layer is in EPSG:4326.
  assert.equal((await put("rhea/vectors", "layers/site.gpkg", build(standard))).status, 201);
  const runs = (await (await call("GET", "/repos/rhea/vectors/checks")).json()) as { steps: { name: string; status: string; detail: string; files?: string[] }[] }[];
  const crs = runs[0].steps.find((s) => s.name === "Coordinate reference system")!;
  assert.equal(crs.status, "failed");
  assert.match(crs.files!.join("|"), /layers\/site\.gpkg, layer gauges \(EPSG:4326\)/);
  assert.match(crs.files!.join("|"), /layer local \(no EPSG coordinate system\)/);
  assert.ok(!crs.files!.join("|").includes("layer rivers"), "the layer in the right CRS is fine");
});
