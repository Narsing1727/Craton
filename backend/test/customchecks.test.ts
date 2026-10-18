// Checks a repository declares for itself in .craton-checks.json: the strict reader, every expectation, severities.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { geotiff, shapefile, catchments } from "../src/dev/fixtures.ts";
import { parseConfig } from "../src/checks/custom.ts";
import { HDF5_SAMPLES } from "./fixtures/hdf5-samples.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
const R = "/repos/alice/model";

const api = (method: string, path: string, body?: unknown) =>
  app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });

async function put(path: string, data: Buffer | string) {
  const form = new FormData();
  const bytes = typeof data === "string" ? Buffer.from(data) : data;
  form.append("file", new File([new Uint8Array(bytes)], path.split("/").pop()!));
  form.append("paths", JSON.stringify([path]));
  form.append("branch", "main");
  const res = await app.request("/v1/repos/alice/model/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  assert.ok([201, 409].includes(res.status), `${path}: ${res.status}`);
}
const setConfig = (config: unknown) => put(".craton-checks.json", typeof config === "string" ? config : JSON.stringify(config, null, 2));

type StepOut = { name: string; status: string; detail: string; files?: string[] };
async function step(): Promise<StepOut> {
  const runs = (await (await api("GET", `${R}/checks?limit=1`)).json()) as { steps: StepOut[] }[];
  return runs[0].steps.find((s) => s.name === "Repository checks")!;
}
/** Set the configuration, then read that commit's verdict. */
async function judge(config: unknown) {
  await setConfig(config);
  return step();
}

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await api("POST", "/repos", { name: "model", visibility: "private" })).status, 201);
  await put("README.md", "# Model\n");
  await put("terrain/dem.tif", geotiff({ width: 40, height: 40, epsg: 32643, nodata: -9999, pixelSize: 10 }));
  await put("terrain/no-nodata.tif", geotiff({ width: 40, height: 40, epsg: 32643, pixelSize: 25 }));
  await put("terrain/latlon.tif", geotiff({ width: 40, height: 40, epsg: 4326, nodata: -9999, pixelSize: 0.001, origin: [76.2, 10.4] }));
  const sf = shapefile(catchments(3));
  await put("vectors/catch.shp", sf.shp);
  await put("vectors/catch.shx", sf.shx);
  await put("vectors/catch.dbf", sf.dbf);
  await put("vectors/catch.prj", sf.prj);
  await put("gauges/good.csv", "station,datetime,discharge\nG1,2024-06-01T00:00Z,10\nG2,2024-06-01T00:00Z,7\nG1,2024-06-02T00:00Z,12\n");
  await put("gauges/bad.csv", "station,datetime,discharge\nG1,2024-06-02T00:00Z,-3\nG1,2024-06-01T00:00Z,\nG1,2024-06-01T00:00Z,abc\n");
  await put("model/Finished.p01.hdf", HDF5_SAMPLES.finished.bytes);
  await put("model/Unstable.p02.hdf", HDF5_SAMPLES.unstable.bytes);
});

test("no configuration file means the step is skipped, not failed", async () => {
  const s = await step();
  assert.equal(s.status, "skipped");
  assert.match(s.detail, /declares no checks/);
});

test("the reader is strict: a misspelt key, a wrong type or a check that does nothing is a failure with its path", () => {
  const bad = parseConfig(
    JSON.stringify({
      version: 2,
      chekcs: [],
      checks: [
        { files: "a/*.tif", expect: { crss: 32643 } },
        { files: "a/*.tif", expect: { crs: "utm" } },
        { expect: { crs: 32643 } },
        { name: "empty" },
        { files: "x", severity: "loud", expect: { cellSize: { mni: 1 } } },
        { files: "x", expect: { run: { stable: false } } },
        "not an object",
      ],
    }),
  );
  const text = bad.problems.join("\n");
  assert.match(text, /unknown key "chekcs"/);
  assert.match(text, /"version" must be 1/);
  assert.match(text, /checks\[0\].expect: unknown expectation "crss"/);
  assert.match(text, /checks\[1\].expect.crs must be an EPSG code/);
  assert.match(text, /checks\[2\]: "expect" needs "files"/);
  assert.match(text, /checks\[3\]: does nothing/);
  assert.match(text, /checks\[4\].severity must be "error" or "warn"/);
  assert.match(text, /checks\[4\].expect.cellSize must be/);
  assert.match(text, /checks\[5\].expect.run must be/);
  assert.match(text, /checks\[6\] must be an object/);
  assert.equal(parseConfig("{nope").problems.length, 1);
  assert.match(parseConfig("[]").problems[0], /must be a JSON object/);
});

test("a malformed file fails the step and names each problem", async () => {
  const s = await judge({ checks: [{ files: "terrain/*.tif", expect: { crss: 32643 } }] });
  assert.equal(s.status, "failed");
  assert.match(s.files!.join("|"), /\.craton-checks\.json: checks\[0\]\.expect: unknown expectation "crss"/);
});

test("a configuration that everything satisfies passes and says how much it judged", async () => {
  const dem = ((await (await api("GET", `${R}/file/main/terrain/dem.tif`)).json()) as { extent: number[] }).extent;
  const box = [dem[0] - 1, dem[1] - 1, dem[2] + 1, dem[3] + 1];
  const s = await judge({
    version: 1,
    checks: [
      { name: "DEM", files: "terrain/dem.tif", expect: { crs: 32643, nodata: -9999, cellSize: { min: 5, max: 30 }, width: { min: 10 }, dataType: "float32", within: box } },
      { name: "Catchments", files: "vectors/*.shp", expect: { crs: [32643, 4326], geometry: "Polygon", fields: ["name"], features: { min: 1, max: 10 } } },
      { name: "Good gauges", files: "gauges/good.csv", expect: { columns: ["station", "datetime", "discharge"], rows: { min: 1 }, notEmpty: ["discharge"], numeric: { discharge: { min: 0 } }, unique: ["station", "datetime"], sorted: "datetime" } },
      { name: "Plans", files: "model/Finished.p01.hdf", expect: { run: { stable: true, solutionContains: "Finished", maxWselError: { max: 0.05 } }, groups: ["Geometry", "Results"] } },
      { name: "Files present", require: ["README.md", "terrain/*.tif"] },
      { name: "Nothing huge", files: "**", expect: { maxBytes: "50MB", minBytes: 4 } },
    ],
  });
  assert.equal(s.status, "passed", JSON.stringify(s));
  assert.match(s.detail, /6 checks passed \(\d+ file expectations judged\)/);
});

test("each expectation fails with a plain sentence naming the file and what was found", async () => {
  const s = await judge({
    checks: [
      { name: "crs", files: "terrain/dem.tif", expect: { crs: 4326 } },
      { name: "nodata", files: "terrain/no-nodata.tif", expect: { nodata: "defined" } },
      { name: "nodata value", files: "terrain/dem.tif", expect: { nodata: -1 } },
      { name: "cell", files: "terrain/no-nodata.tif", expect: { cellSize: { min: 1, max: 10 } } },
      { name: "within", files: "terrain/dem.tif", expect: { within: [0, 0, 1, 1] } },
      { name: "type", files: "terrain/dem.tif", expect: { dataType: "int16" } },
      { name: "cog", files: "terrain/dem.tif", expect: { cog: true } },
      { name: "fields", files: "vectors/catch.shp", expect: { fields: ["landuse"], geometry: "Point", features: { min: 50 } } },
      { name: "columns", files: "gauges/good.csv", expect: { columns: ["station", "stage"] } },
      { name: "values", files: "gauges/bad.csv", expect: { notEmpty: ["discharge"], numeric: { discharge: { min: 0 } }, unique: ["station", "datetime"], sorted: "datetime" } },
      { name: "plan", files: "model/Unstable.p02.hdf", expect: { run: { stable: true, maxWselError: { max: 0.05 } } } },
      { name: "needed", require: ["docs/REPORT.pdf"] },
      { name: "banned", forbid: ["terrain/no-*"] },
      { name: "size", files: "terrain/dem.tif", expect: { maxBytes: 100 } },
    ],
  });
  assert.equal(s.status, "failed");
  const text = s.files!.join("\n");
  const has = (re: RegExp) => assert.match(text, re);
  has(/terrain\/dem\.tif: \[crs\] crs: coordinate system is EPSG:32643, expected EPSG:4326/);
  has(/terrain\/no-nodata\.tif: \[nodata\] nodata: no nodata value is declared/);
  has(/terrain\/dem\.tif: \[nodata value\] nodata: nodata is -9999, expected -1/);
  has(/terrain\/no-nodata\.tif: \[cell\] cellSize: cell size is 25 x 25, expected between 1 and 10/);
  has(/terrain\/dem\.tif: \[within\] within: extent .* is not inside 0, 0, 1, 1/);
  has(/terrain\/dem\.tif: \[type\] dataType: data type is float32, expected int16/);
  has(/\[cog\] cog: not Cloud-Optimised/);
  has(/vectors\/catch\.shp: \[fields\] fields: missing field: landuse/);
  has(/\[fields\] geometry: geometry is Polygon, expected point/);
  has(/\[fields\] features: 3 features, expected at least 50/);
  has(/gauges\/good\.csv: \[columns\] columns: missing column: stage/);
  has(/gauges\/bad\.csv: \[values\] notEmpty: 1 empty cell in discharge/);
  has(/gauges\/bad\.csv: \[values\] numeric: 1 value in discharge is not a number/);
  has(/gauges\/bad\.csv: \[values\] numeric: 1 value in discharge outside at least 0 \(first at line 2\)/);
  has(/gauges\/bad\.csv: \[values\] unique: 1 duplicate row by station \+ datetime/);
  has(/gauges\/bad\.csv: \[values\] sorted: datetime goes backwards at line 3/);
  has(/model\/Unstable\.p02\.hdf: \[plan\] run: the run reports "Unsteady Went Unstable"/);
  has(/model\/Unstable\.p02\.hdf: \[plan\] run: no maximum WSEL error is recorded/);
  has(/\.craton-checks\.json: \[needed\] no file matches the required pattern docs\/REPORT\.pdf/);
  has(/terrain\/no-nodata\.tif: \[banned\] matches the forbidden pattern terrain\/no-\*/);
  has(/terrain\/dem\.tif: \[size\] maxBytes: .* is larger than 100/);
});

test("a warning does not fail the step, and an expectation no file could answer is said out loud", async () => {
  const s = await judge({
    checks: [
      { name: "soft", files: "terrain/no-nodata.tif", severity: "warn", expect: { nodata: "defined" } },
      { name: "pointless", files: "gauges/good.csv", expect: { crs: 32643 } },
      { name: "nothing there", files: "reports/*.pdf", expect: { maxBytes: "1MB" } },
    ],
  });
  assert.equal(s.status, "failed", "the last two are errors: they would otherwise pass while checking nothing");
  const text = s.files!.join("\n");
  assert.match(text, /\[soft\] nodata: no nodata value is declared \(warning\)/);
  assert.match(text, /\[pointless\] "crs" applies to none of the 1 matched file, so it checked nothing/);
  assert.match(text, /\[nothing there\] no file matches reports\/\*\.pdf/);

  const only = await judge({ checks: [{ name: "soft", files: "terrain/no-nodata.tif", severity: "warn", expect: { nodata: "defined" } }] });
  assert.equal(only.status, "passed");
  assert.match(only.detail, /1 warning/);
  assert.match(only.files!.join("|"), /\(warning\)/);
});

test("a CRS expectation is judged on every kind that has one, and geographic rasters work too", async () => {
  const s = await judge({ checks: [{ files: "terrain/latlon.tif", expect: { crs: 4326, cellSize: { max: 0.01 } } }] });
  assert.equal(s.status, "passed", JSON.stringify(s));
});
