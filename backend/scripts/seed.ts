// Seed a local Craton with the same people, organizations and repositories the frontend shows,
// built from real (generated) GIS files so storage, dedup and checks numbers are genuine.
//
//   npm run seed            create data/ if it doesn't exist
//   npm run seed -- --reset  wipe data/ and start again

import fs from "node:fs";
import path from "node:path";
import { config } from "../src/config.ts";
import { resetSequences, tableOrder } from "../src/db/dump.ts";
import { createContext } from "../src/services/context.ts";
import { addMember, createOrg, createUser, issueToken } from "../src/services/accounts.ts";
import { star } from "../src/services/social.ts";
import type { RepoRow } from "../src/services/repos.ts";
import { createRepo, findRepo, updateRepo } from "../src/services/repos.ts";
import { createBranch, resolveRef } from "../src/services/history.ts";
import { mergePull, reviewPull } from "../src/services/collab.ts";
import { createRelease } from "../src/services/releases.ts";
import { commitFiles } from "../src/dev/push.ts";
import { WKT_UTM43N, catchments, gaugesCsv, geotiff, hecRas, levees, noiseBytes, shapefile } from "../src/dev/fixtures.ts";

const reset = process.argv.includes("--reset");
const ctx = await createContext();
const seeded = (await ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM owners"))!.n;
if (seeded) {
  if (!reset) {
    console.log("Already seeded (the database has accounts). Run with --reset to start over.");
    await ctx.db.close();
    process.exit(0);
  }
  // Start over: empty every table (children first), restart the counters, and forget the chunk files.
  await ctx.db.tx(async (t) => {
    for (const table of [...(await tableOrder(t))].reverse()) await t.exec(`DELETE FROM "${table}"`);
    await resetSequences(t);
  });
  fs.rmSync(path.join(config.dataDir, "chunks"), { recursive: true, force: true });
}

const now = Date.now();
const ago = (hours: number) => new Date(now - hours * 3_600_000);
const PASSWORD = "craton-demo-2026";

// ── People and organizations ────────────────────────────────────────────────
const people = {
  priyam: await createUser(ctx, { handle: "priyam", email: "priya@hydrolab.org", password: PASSWORD, name: "Priya Menon", bio: "Hydraulic modeler & geospatial engineer. Open reproducible river basin models." }),
  arunn: await createUser(ctx, { handle: "arunn", email: "arun@hydrolab.org", password: PASSWORD, name: "Arun Nair", bio: "Hydrodynamic modeler & GIS specialist." }),
  sarat: await createUser(ctx, { handle: "sarat", email: "sara@hydrolab.org", password: PASSWORD, name: "Sara Thomas", bio: "Terrain harmonization pipelines." }),
  vikramr: await createUser(ctx, { handle: "vikramr", email: "vikram@example.org", password: PASSWORD, name: "Vikram Rao", bio: "Urban flood resilience engineer." }),
};
const hydrolab = await createOrg(ctx, { handle: "hydrolab", name: "Hydrolab", bio: "Open river-basin models for South Asia" }, people.priyam.id);
await addMember(ctx, hydrolab.id, people.arunn.id, "Maintainer");
await addMember(ctx, hydrolab.id, people.sarat.id, "Member");
await addMember(ctx, hydrolab.id, people.vikramr.id, "Member");
const openterrain = await createOrg(ctx, { handle: "openterrain", name: "OpenTerrain", bio: "Deduplicated global elevation data" }, people.vikramr.id);
const deltares = await createOrg(ctx, { handle: "deltares", name: "Deltares", bio: "Water and subsurface research" }, people.arunn.id);
const usgs = await createOrg(ctx, { handle: "usgs-water", name: "USGS Water", bio: "Public LiDAR and hydrography" }, people.sarat.id);
void openterrain, deltares, usgs;

// Star counts are real: the demo people star each other's work at the end of the seed.
function repo(owner: string, creator: number, name: string, meta: Omit<Parameters<typeof createRepo>[2], "name" | "owner">) {
  return createRepo(ctx, creator, { ...meta, owner, name });
}
const reload = (r: RepoRow) => findRepo(ctx, r.owner, r.name);

async function setIssue(r: RepoRow, n: number, fields: { title: string; author: number; label: string; state?: string; assignee?: number; file?: string; milestone?: string; body?: string; at: Date }) {
  await ctx.db.run("INSERT INTO issues (repo_id, number, title, body, author_id, state, label, assignee_id, milestone, file_ref, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", r.id, n, fields.title, fields.body ?? "", fields.author, fields.state ?? "open", fields.label, fields.assignee ?? null, fields.milestone ?? null, fields.file ?? null, fields.at.toISOString(), fields.at.toISOString());
}
async function comment(r: RepoRow, target: "issue" | "pull", n: number, author: number, body: string, at: Date) {
  await ctx.db.run("INSERT INTO comments (repo_id, target, number, author_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", r.id, target, n, author, body, at.toISOString());
}
async function openPull(r: RepoRow, n: number, fields: { title: string; body: string; author: number; source: string; target?: string; at: Date }) {
  await ctx.db.run("INSERT INTO pulls (repo_id, number, title, body, author_id, source, target, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", r.id, n, fields.title, fields.body, fields.author, fields.source, fields.target ?? "main", fields.at.toISOString(), fields.at.toISOString());
}

// Shared public data: one SRTM tile, referenced by two repositories (real cross-repo dedup).
const srtmTile = geotiff({ width: 600, height: 600, epsg: 32643, verticalEpsg: 3855, nodata: -9999, seed: 99, origin: [600_000, 1_150_000], pixelSize: 30 });

// ── openterrain/srtm-30m-global ─────────────────────────────────────────────
{
  const r = await repo("openterrain", people.vikramr.id, "srtm-30m-global", {
    description: "Deduplicated SRTM 30 m elevation tiles, published per UTM zone as GeoTIFFs.",
    region: "Global",
    crs: "EPSG:32643",
    nodata: -9999,
    verticalDatum: 3855,
  });
  await commitFiles(ctx, r, {
    branch: "main",
    author: "vikramr",
    message: "Publish UTM 43N tiles for peninsular India",
    timestamp: ago(60),
    changes: {
      "utm43n/N10E076.tif": srtmTile,
      "utm43n/N09E076.tif": geotiff({ width: 600, height: 600, epsg: 32643, verticalEpsg: 3855, nodata: -9999, seed: 98, origin: [600_000, 1_132_000], pixelSize: 30 }),
      "README.md": Buffer.from("# SRTM 30 m, UTM zone 43N\n\nVoid-filled SRTM tiles reprojected to EPSG:32643, heights above EGM2008.\n"),
    },
  });
}

// ── hydrolab/chalakudy-basin ────────────────────────────────────────────────
const readme = `# Chalakudy Basin Model

Calibrated 2D HEC-RAS model of the Chalakudy river basin covering the reach from
Peringalkuthu to the estuary. Terrain is a 2 m bare-earth DEM from the 2024 LiDAR survey.

## Contents
- \`terrain/basin_dem.tif\`: 2 m bare-earth DEM (EPSG:32643, heights above EGM2008)
- \`vectors/catchment.shp\`: sub-catchment boundaries
- \`model/chalakudy.p01\`: HEC-RAS plan, 100-yr event

## Calibration
Manning's n values were calibrated against the 2018 flood high-water marks.
`;
const dem = (resurvey?: { from: number; to: number; offset: number }) => geotiff({ width: 724, height: 724, epsg: 32643, verticalEpsg: 3855, nodata: -9999, seed: 5, resurvey });
const shp = (set: ReturnType<typeof shapefile>, base: string) => Object.fromEntries(Object.entries(set).map(([ext, buf]) => [`${base}.${ext}`, buf]));

let chalakudy = await repo("hydrolab", people.priyam.id, "chalakudy-basin", {
  description: "Calibrated HEC-RAS model and terrain data for the Chalakudy river basin, Kerala.",
  region: "Kerala, India",
  crs: "EPSG:32643",
  nodata: -9999,
  verticalDatum: 3855,
});
const c1 = await commitFiles(ctx, chalakudy, {
  branch: "main",
  author: "priyam",
  message: "Initial import: terrain, catchments and HEC-RAS model",
  timestamp: ago(24 * 9),
  changes: {
    "README.md": Buffer.from(readme),
    "terrain/basin_dem.tif": dem(),
    "terrain/srtm/N10E076.tif": srtmTile,
    "terrain/dem_metadata.json": Buffer.from(JSON.stringify({ crs: "EPSG:32643", vertical: "EGM2008 (EPSG:3855)", resolution_m: 2, source: "2024 aerial LiDAR" }, null, 2)),
    ...shp(shapefile(catchments(8)), "vectors/catchment"),
    ...hecRas(0.032),
    "gauges.csv": gaugesCsv(30),
  },
});
await commitFiles(ctx, chalakudy, { branch: "main", author: "arunn", message: "Add levee centerlines from 2024 survey", timestamp: ago(24 * 7), changes: shp(shapefile(levees(4.0)), "vectors/levees") });
await commitFiles(ctx, chalakudy, { branch: "main", author: "sarat", message: "Add 2024 gauge readings", timestamp: ago(24 * 4), changes: { "gauges.csv": gaugesCsv(60) } });
const c4 = await commitFiles(ctx, chalakudy, { branch: "main", author: "priyam", message: "Fix sub-catchment topology near confluence", timestamp: ago(24 * 2), changes: shp(shapefile(catchments(9, 640_000, 1_140_000, 4)), "vectors/catchment") });

await createBranch(ctx, chalakudy, "develop", "main", "arunn");
await commitFiles(ctx, chalakudy, { branch: "develop", author: "arunn", message: "Recalibrate Manning's n for main channel", timestamp: ago(26), changes: hecRas(0.028) });
await openPull(chalakudy, 131, { title: "Recalibrate Manning's n for main channel", body: "Calibrated against 2018 high-water marks. Nash–Sutcliffe improved from 0.71 to 0.86.", author: people.arunn.id, source: "develop", at: ago(26) });
await reviewPull(ctx, chalakudy, 131, people.priyam.id, { state: "approved", body: "Numbers check out against the HWM table." });
await mergePull(ctx, chalakudy, 131, "priyam");

const c6 = await commitFiles(ctx, chalakudy, { branch: "main", author: "priyam", message: "Re-survey DEM rows 600 to 680 after bank erosion", timestamp: ago(3), changes: { "terrain/basin_dem.tif": dem({ from: 600, to: 680, offset: -0.42 }) } });

await createBranch(ctx, chalakudy, "levee-scenario", "main", "arunn");
await commitFiles(ctx, chalakudy, { branch: "levee-scenario", author: "arunn", message: "Raise right-bank embankment crest by 0.5 m", timestamp: ago(2), changes: shp(shapefile(levees(4.5)), "vectors/levees") });

await createBranch(ctx, chalakudy, "lidar-2024-update", c4.id, "sarat");
const lidar = await commitFiles(ctx, chalakudy, {
  branch: "lidar-2024-update",
  author: "sarat",
  message: "Ingest 2024 LiDAR and rebuild 2 m DEM",
  timestamp: ago(24),
  changes: { "terrain/lidar_2024_dem.tif": geotiff({ width: 512, height: 512, epsg: 4326, verticalEpsg: 4979, nodata: -9999, seed: 12, origin: [76.3, 10.3], pixelSize: 0.00002 }) },
});
console.log(`lidar-2024-update checks: ${lidar.checks.status} (${lidar.checks.steps.filter((s) => s.status === "failed").map((s) => s.name).join(", ")})`);

chalakudy = await reload(chalakudy);
await openPull(chalakudy, 139, { title: "Ingest 2024 LiDAR and rebuild 2 m DEM", body: "Replaces the 2023 terrain with the 2024 survey. Awaiting resolution of the datum offset.", author: people.sarat.id, source: "lidar-2024-update", at: ago(24) });
await reviewPull(ctx, chalakudy, 139, people.priyam.id, { state: "changes_requested", body: "The new tile is in EPSG:4326 with ellipsoidal heights. Reproject to 32643 / EGM2008 first." });
await comment(chalakudy, "pull", 139, people.sarat.id, "Reprojecting with the geoid grid now; will push an update.", ago(20));
await openPull(chalakudy, 142, { title: "Levee scenario: raise embankment crest by 0.5 m", body: "Raised the embankment crest by 0.5 m along the right bank and re-ran the 100-yr event. Inundation extent drops noticeably near the confluence.", author: people.arunn.id, source: "levee-scenario", at: ago(2) });
await comment(chalakudy, "pull", 142, people.priyam.id, "Nice. Can you confirm the datum matches the 2024 DEM before we merge?", ago(1));
await reviewPull(ctx, chalakudy, 142, people.sarat.id, { state: "approved", body: "Crest heights match the survey." });

await setIssue(chalakudy, 88, { title: "Datum mismatch between 2023 and 2024 DEM", author: people.sarat.id, label: "data-quality", assignee: people.priyam.id, file: "terrain/basin_dem.tif", milestone: "v1.3 Calibration", body: "The 2024 survey tiles sit about 0.3 m above the 2023 baseline.", at: ago(5) });
await comment(chalakudy, "issue", 88, people.sarat.id, "When inspecting the dataset in QGIS against the 2024 survey points, we noticed a vertical datum offset. Could this be WGS84 ellipsoidal vs EGM2008?", ago(48));
await comment(chalakudy, "issue", 88, people.priyam.id, "Good catch. The raw LiDAR was delivered with ellipsoidal heights; we are re-running the conversion with the geoid grid.", ago(24));
await setIssue(chalakudy, 84, { title: "Should gauges.csv include provisional readings?", author: people.priyam.id, label: "question", file: "gauges.csv", at: ago(48) });
await setIssue(chalakudy, 80, { title: "Add a downstream boundary condition option", author: people.arunn.id, label: "enhancement", at: ago(96) });
await setIssue(chalakudy, 76, { title: "Sub-catchment 12 has a topology gap", author: people.priyam.id, label: "bug", state: "closed", file: "vectors/catchment.shp", at: ago(24 * 7) });

await createRelease(ctx, chalakudy, people.priyam.id, { tag: "v1.0.0", target: c1.id, title: "Chalakudy basin model v1.0", notes: "First calibrated release against the 2018 flood event." });
await createRelease(ctx, chalakudy, people.arunn.id, { tag: "v1.1.0", target: c4.id, title: "Chalakudy basin model v1.1", notes: "Fixed sub-catchment topology and added 2024 gauge readings." });
await createRelease(ctx, chalakudy, people.priyam.id, { tag: "v1.2.0", target: c6.id, title: "Chalakudy basin model v1.2: 2024 terrain", notes: "Recalibrated Manning's n and re-surveyed the eroded bank section." });

// Releases, reviews and the merge are written "now" by the services; give them times that fit the story.
const at = async (sql: string, hours: number, ...args: (string | number)[]) => await ctx.db.run(sql, ago(hours).toISOString(), chalakudy.id, ...args);
await at("UPDATE releases SET created_at = ? WHERE repo_id = ? AND tag = ?", 24 * 8, "v1.0.0");
await at("UPDATE releases SET created_at = ? WHERE repo_id = ? AND tag = ?", 46, "v1.1.0");
await at("UPDATE releases SET created_at = ? WHERE repo_id = ? AND tag = ?", 2.5, "v1.2.0");
await at("UPDATE reviews SET created_at = ? WHERE repo_id = ? AND number = ?", 25.5, 131);
await at("UPDATE pulls SET updated_at = ? WHERE repo_id = ? AND number = ?", 25, 131);
await at("UPDATE reviews SET created_at = ? WHERE repo_id = ? AND number = ?", 22, 139);
await at("UPDATE reviews SET created_at = ? WHERE repo_id = ? AND number = ?", 1.5, 142);

// ── hydrolab/monsoon-rainfall-grids ─────────────────────────────────────────
{
  const r = await repo("hydrolab", people.priyam.id, "monsoon-rainfall-grids", { description: "NetCDF rainfall reanalysis grids (1990–2024) stored as Zarr.", region: "South Asia", crs: "EPSG:4326" });
  const changes: Record<string, Buffer> = { "README.md": Buffer.from("# Monsoon rainfall grids\n\nDaily rainfall reanalysis, 0.1° grid, 1990–2024.\n") };
  for (const year of [2016, 2017, 2018, 2019]) changes[`netcdf/rainfall_${year}.nc`] = noiseBytes(900_000, year, "CDF\x01");
  changes["zarr/rainfall.zarr/.zattrs"] = Buffer.from(JSON.stringify({ units: "mm/day", source: "IMD gridded rainfall" }));
  await commitFiles(ctx, r, { branch: "main", author: "priyam", message: "Import 2016–2019 monsoon grids", timestamp: ago(30), changes });
}

// ── hydrolab/internal-flood-forecast (private) ──────────────────────────────
{
  const r = await repo("hydrolab", people.priyam.id, "internal-flood-forecast", { description: "Operational flood-forecast pipeline configs and calibration runs.", region: "Kerala, India", visibility: "private" });
  await commitFiles(ctx, r, {
    branch: "develop",
    author: "arunn",
    message: "Forecast pipeline configs",
    timestamp: ago(6),
    changes: {
      "pipeline/forecast.json": Buffer.from(JSON.stringify({ leadTimeHours: 72, ensemble: 20, models: ["hec-hms", "hec-ras"] }, null, 2)),
      "network/urban_drainage.inp": Buffer.from("[TITLE]\nKochi urban drainage\n[JUNCTIONS]\nJ1 2.1 1.0\nJ2 1.8 1.0\n[CONDUITS]\nC1 J1 J2 120 0.013\n"),
    },
  });
  await ctx.db.run("UPDATE repos SET default_branch = 'develop' WHERE id = ?", r.id);
}

// ── deltares/rhine-meuse-swmm ───────────────────────────────────────────────
{
  const r = await repo("deltares", people.arunn.id, "rhine-meuse-swmm", { description: "Urban drainage SWMM models for the Rhine–Meuse delta cities.", region: "Netherlands", crs: "EPSG:28992" });
  const rd = 'PROJCS["Amersfoort / RD New",GEOGCS["Amersfoort"],PROJECTION["Oblique_Stereographic"],AUTHORITY["EPSG","28992"]]';
  await commitFiles(ctx, r, {
    branch: "main",
    author: "arunn",
    message: "Rotterdam and Dordrecht drainage networks",
    timestamp: ago(24 * 5),
    changes: {
      "networks/rotterdam.inp": Buffer.from("[TITLE]\nRotterdam\n" + Array.from({ length: 400 }, (_, i) => `J${i} ${(Math.sin(i) + 2).toFixed(2)} 1.0`).join("\n")),
      "networks/dordrecht.inp": Buffer.from("[TITLE]\nDordrecht\n" + Array.from({ length: 300 }, (_, i) => `J${i} ${(Math.cos(i) + 2).toFixed(2)} 1.0`).join("\n")),
      ...shp(shapefile(catchments(6, 92_000, 437_000, 8), rd), "catchments/polders"),
    },
  });
}

// ── usgs-water/colorado-lidar-2024 ──────────────────────────────────────────
{
  const r = await repo("usgs-water", people.sarat.id, "colorado-lidar-2024", { description: "Classified LiDAR point clouds (COPC) for the Colorado front range.", region: "Colorado, USA", crs: "EPSG:26913" });
  const changes: Record<string, Buffer> = {};
  for (let i = 1; i <= 3; i++) changes[`tiles/tile_${String(i).padStart(3, "0")}.laz`] = noiseBytes(1_100_000, 500 + i, "LASF");
  await commitFiles(ctx, r, { branch: "main", author: "sarat", message: "Front range tiles, class 2 ground", timestamp: ago(24 * 7), changes });
}

void WKT_UTM43N, updateRepo, resolveRef;

// ── The demo people have been using Craton for a while ──────────────────────
// They skip onboarding; a new signup gets it. A CLI token shows up as "Connect the CLI" done.
await ctx.db.run("UPDATE users SET onboarded_at = ?, email_verified_at = ?, role = 'modeler'", ago(24 * 30).toISOString(), ago(24 * 30).toISOString());

// Real stars from the demo people (a new account can add its own).
const starRepo = async (handle: string, owner: string, name: string) => star(ctx, await findRepo(ctx, owner, name), people[handle as keyof typeof people].id);
for (const h of ["priyam", "arunn", "sarat", "vikramr"]) await starRepo(h, "openterrain", "srtm-30m-global");
for (const h of ["arunn", "sarat", "vikramr"]) await starRepo(h, "hydrolab", "chalakudy-basin");
for (const h of ["priyam", "sarat"]) await starRepo(h, "usgs-water", "colorado-lidar-2024");
await starRepo("priyam", "deltares", "rhine-meuse-swmm");
await starRepo("vikramr", "hydrolab", "monsoon-rainfall-grids");
await issueToken(ctx, people.priyam.id, { kind: "pat", note: "craton-cli (laptop)", scopes: ["repo", "read:org"], expiresInDays: 365 });

// ── Where the frontend finds the API ────────────────────────────────────────
// The web app signs people in with a session cookie, so no token goes in this file.
const envFile = path.resolve(import.meta.dirname, "../../frontend/.env.local");
fs.writeFileSync(envFile, `# Written by backend/scripts/seed.ts for local development. Git-ignored.\nCRATON_API_URL=http://localhost:${config.port}\n`);

// Pushes are logged "now"; date each one to the commit it pushed so the activity feed reads in order.
await ctx.db.run("UPDATE ref_log SET at = (SELECT c.timestamp FROM commits c WHERE c.id = ref_log.new_commit AND c.repo_id = ref_log.repo_id) WHERE new_commit IS NOT NULL");

const counts = await ctx.db.get("SELECT (SELECT COUNT(*) FROM repos) AS repos, (SELECT COUNT(*) FROM commits) AS commits, (SELECT COUNT(*) FROM chunks) AS chunks, (SELECT COALESCE(SUM(stored_size),0) FROM chunks) AS stored") as Record<string, number>;
console.log(`Seeded ${counts.repos} repositories, ${counts.commits} commits, ${counts.chunks} unique chunks (${(counts.stored / 1024 / 1024).toFixed(1)} MB stored).`);
console.log(`Users: priyam, arunn, sarat, vikramr (password: ${PASSWORD}). API URL written to ${envFile}.`);
