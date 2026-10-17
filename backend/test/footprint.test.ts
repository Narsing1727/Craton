// Where a repository's data is: file boxes from headers, the footprint around them, and asking
// "what covers this place?".

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { catchments, geotiff, shapefile } from "../src/dev/fixtures.ts";
import { backfillFootprints, rasterExtent, refreshFootprint, vectorExtent } from "../src/services/extent.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

const repoOf = (owner: string, name: string) => getRepoFor(ctx, owner, name, (ctx.db.prepare("SELECT id FROM owners WHERE handle = ?").get(owner) as { id: number }).id);
const names = async (query: string, who: string | null = "rhea") => ((await call("GET", `/repos${query}`, who)).json as { name: string }[]).map((r) => r.name).sort();
const extentRows = () => (ctx.db.prepare("SELECT COUNT(*) AS n FROM blob_extents").get() as { n: number }).n;

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "ines"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    await app.request("/v1/user", { method: "PATCH", headers: { authorization: `Bearer ${tokens[u]}`, "content-type": "application/json" }, body: JSON.stringify({ onboarded: true }) });
  }
  // Kerala (zone 43N), a raster and a shapefile; an Alpine tile in geographic degrees; a repository with no map data.
  for (const [who, name, vis] of [["rhea", "kerala", "private"], ["rhea", "alps", "private"], ["rhea", "tables", "private"], ["ines", "hidden", "private"]] as const) assert.equal((await call("POST", "/repos", who, { name, visibility: vis })).status, 201, name);
  await commitFiles(ctx, repoOf("rhea", "kerala"), {
    branch: "main",
    author: "rhea",
    message: "Basin",
    timestamp: new Date(),
    changes: { "terrain/dem.tif": geotiff({ width: 512, height: 512, epsg: 32643, nodata: -9999, seed: 3 }), ...Object.fromEntries(Object.entries(shapefile(catchments(6))).map(([ext, b]) => [`vectors/catch.${ext}`, b])) },
  });
  await commitFiles(ctx, repoOf("rhea", "alps"), {
    branch: "main",
    author: "rhea",
    message: "Tile",
    timestamp: new Date(),
    changes: { "tile.tif": geotiff({ width: 100, height: 100, epsg: 4326, nodata: null, seed: 4, origin: [7.0, 46.5], pixelSize: 0.001 }) },
  });
  await commitFiles(ctx, repoOf("rhea", "tables"), { branch: "main", author: "rhea", message: "CSV", timestamp: new Date(), changes: { "a.csv": Buffer.from("x,y\n1,2\n") } });
  await commitFiles(ctx, repoOf("ines", "hidden"), { branch: "main", author: "ines", message: "Secret tile", timestamp: new Date(), changes: { "t.tif": geotiff({ width: 64, height: 64, epsg: 32643, nodata: null, seed: 5 }) } });
  await backfillFootprints(ctx);
});

test("a raster's box comes from its header and lands where the coordinates say", () => {
  const box = rasterExtent({ width: 512, height: 512, origin: [632000, 1130000], pixelScale: [2, 2], epsg: 32643 }, null)!;
  assert.ok(box[1] > 10.1 && box[3] < 10.3 && box[0] > 76.1 && box[2] < 76.3, JSON.stringify(box));
  assert.equal(rasterExtent({ width: 512, height: 512, origin: [632000, 1130000], pixelScale: [2, 2], epsg: null }, 32643)?.[0], box[0], "a file that doesn't name its CRS uses the repository's");
  assert.equal(rasterExtent({ width: 512, height: 512, origin: [632000, 1130000], pixelScale: [2, 2], epsg: null }, null), null, "and with neither, no position is invented");
  assert.equal(rasterExtent({ width: 512, height: 512, origin: [530000, 180000], pixelScale: [1, 1], epsg: 27700 }, null), null, "an unsupported system gives nothing rather than something wrong");
  assert.equal(rasterExtent({ width: 0, height: 5, origin: [0, 0], pixelScale: [1, 1], epsg: 4326 }, null), null);
  assert.equal(vectorExtent([632000, 1128976, 633024, 1130000], 32643, null)?.length, 4);
  assert.equal(vectorExtent([1, 2, Number.NaN, 4], 4326, null), null);
});

test("a repository's footprint is exactly the box around its located files, stored with it", async () => {
  const kerala = (await call("GET", "/repos/rhea/kerala", "rhea")).json;
  // The DEM is about 1 km across near 10.2 N 76.2 E; the sample catchments reach further north-east.
  const dem = (await call("GET", "/repos/rhea/kerala/file/main/terrain/dem.tif", "rhea")).json.extent as number[];
  const shp = (await call("GET", "/repos/rhea/kerala/file/main/vectors/catch.shp", "rhea")).json.extent as number[];
  assert.ok(dem[0] > 76.2 && dem[2] < 76.22 && dem[1] > 10.21 && dem[3] < 10.23, JSON.stringify(dem));
  assert.deepEqual(kerala.footprint, [Math.min(dem[0], shp[0]), Math.min(dem[1], shp[1]), Math.max(dem[2], shp[2]), Math.max(dem[3], shp[3])], "the union of the file boxes, nothing more");
  const alps = (await call("GET", "/repos/rhea/alps", "rhea")).json.footprint as number[];
  assert.deepEqual(alps, [7, 46.4, 7.1, 46.5], "degrees pass straight through, 100 cells of 0.001 degrees");
  assert.equal((await call("GET", "/repos/rhea/tables", "rhea")).json.footprint, null, "a repository of tables has no footprint");
});

test("asking what covers a place finds the repositories that include it", async () => {
  assert.deepEqual(await names("?covers=10.215,76.21"), ["kerala"], "inside the DEM");
  assert.deepEqual(await names("?covers=10.3,76.3"), ["kerala"], "inside the catchments' box");
  assert.deepEqual(await names("?covers=10.2,76.2"), [], "a point 1.5 km outside the data is not covered");
  assert.deepEqual(await names("?covers=46.45,7.05"), ["alps"]);
  assert.deepEqual(await names("?covers=48.85,2.35"), [], "Paris is in neither");
  assert.deepEqual(await names("?covers=10.215N+76.21E"), ["kerala"], "typed the way people write it");
  assert.deepEqual(await names("?covers=10.215%2C76.21"), ["kerala"]);
  assert.equal((await call("GET", "/repos?covers=nowhere", "rhea")).status, 400);
  assert.equal((await call("GET", "/repos?covers=95,10", "rhea")).status, 400);
});

test("a box finds everything that overlaps it, and a bad box is refused", async () => {
  assert.deepEqual(await names("?bbox=0,40,20,50"), ["alps"], "Europe");
  assert.deepEqual(await names("?bbox=70,5,80,15"), ["kerala"], "south India");
  assert.deepEqual(await names("?bbox=-180,-90,180,90"), ["alps", "kerala"], "the world: only repositories that have a place");
  assert.equal((await call("GET", "/repos?bbox=1,2,3", "rhea")).status, 400);
  assert.equal((await call("GET", "/repos?bbox=10,0,5,1", "rhea")).status, 400, "west must be less than east");
  assert.equal((await call("GET", "/repos?bbox=a,b,c,d", "rhea")).status, 400);
});

test("private repositories are never revealed by a place search", async () => {
  // 10.2195 N 76.2056 E is inside both rhea's DEM and ines's small tile.
  const spot = "?covers=10.2195,76.2056";
  assert.deepEqual(await names(spot, "rhea"), ["kerala"], "rhea sees her own, not ines's");
  const hers = (await call("GET", `/repos${spot}`, "ines")).json as { owner: string; name: string }[];
  assert.deepEqual(hers.map((r) => `${r.owner}/${r.name}`), ["ines/hidden"], "ines sees only hers, though rhea's covers the same place");
  assert.deepEqual(await names(spot, null), [], "a visitor sees neither");
});

test("a file's own page reports where it is", async () => {
  const dem = (await call("GET", "/repos/rhea/kerala/file/main/terrain/dem.tif", "rhea")).json;
  assert.equal(dem.extent.length, 4);
  assert.ok(dem.extent[0] > 76.1 && dem.extent[2] < 76.3);
  const shp = (await call("GET", "/repos/rhea/kerala/file/main/vectors/catch.shp", "rhea")).json;
  assert.equal(shp.extent.length, 4, "a shapefile with a .prj is placed from it");
  assert.equal((await call("GET", "/repos/rhea/tables/file/main/a.csv", "rhea")).json.extent, null);
});

test("each file version is worked out once, and a changed file is worked out again", async () => {
  const kerala = repoOf("rhea", "kerala");
  const before = extentRows();
  await refreshFootprint(ctx, kerala);
  assert.equal(extentRows(), before, "nothing new to compute for unchanged files");
  await commitFiles(ctx, kerala, { branch: "main", author: "rhea", message: "Bigger DEM", timestamp: new Date(), changes: { "terrain/dem.tif": geotiff({ width: 1024, height: 1024, epsg: 32643, nodata: -9999, seed: 3 }) } });
  await refreshFootprint(ctx, kerala);
  assert.equal(extentRows(), before + 1, "the new version of the DEM is one new row");
  const dem = (await call("GET", "/repos/rhea/kerala/file/main/terrain/dem.tif", "rhea")).json.extent as number[];
  assert.ok(dem[3] - dem[1] > 0.0185, "the bigger raster covers about 2 km, twice as much");
});

test("a push to the default branch updates the footprint by itself", async () => {
  const alps = repoOf("rhea", "alps");
  const form = new FormData();
  form.append("file", new File([new Uint8Array(geotiff({ width: 100, height: 100, epsg: 4326, nodata: null, seed: 4, origin: [8.0, 47.5], pixelSize: 0.001 }))], "tile2.tif"));
  form.append("paths", JSON.stringify(["tile2.tif"]));
  const up = await app.request("/v1/repos/rhea/alps/upload", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}` }, body: form });
  assert.equal(up.status, 201, await up.text());
  let box: number[] | null = null;
  for (let i = 0; i < 40 && !(box && box[2] > 8); i++) {
    await new Promise((r) => setTimeout(r, 50));
    box = (await call("GET", "/repos/rhea/alps", "rhea")).json.footprint;
  }
  assert.ok(box && box[2] > 8 && box[0] === 7, `the footprint now spans both tiles: ${JSON.stringify(box)}`);
  void alps;
});

test("a repository with no commits has no footprint and no error", async () => {
  assert.equal((await call("POST", "/repos", "ines", { name: "empty", visibility: "private" })).status, 201);
  assert.equal((await call("GET", "/repos/ines/empty", "ines")).json.footprint, null);
});
