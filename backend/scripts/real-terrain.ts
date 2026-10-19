// One-off for the sample repository hydrolab/chalakudy-basin: replace its made-up terrain with real terrain, as a new commit on main (history is
// append-only, so the old version stays and `craton revert` can bring it back). Run with the API stopped, since the in-process database has
// one owner at a time:  node scripts/real-terrain.ts <path to the DEM GeoTIFF>
// The DEM is built by D:/beacon-scratch/realdem/make_dem.py from Copernicus GLO-30 (ESA).

import fs from "node:fs";
import { createContext } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { warmCommit } from "../src/render/previews.ts";

const file = process.argv[2];
if (!file) throw new Error("Give the DEM file: node scripts/real-terrain.ts <dem.tif>");
const ctx = await createContext();
const owner = (await ctx.db.get("SELECT id FROM owners WHERE handle = 'hydrolab'")) as { id: number } | undefined;
if (!owner) throw new Error("No hydrolab owner here.");
const repo = await getRepoFor(ctx, "hydrolab", "chalakudy-basin", null, "read");

const readme = `# Chalakudy Basin Model

Calibrated 2D HEC-RAS model of the Chalakudy river basin covering the reach from
Peringalkuthu to the estuary. Terrain is the Copernicus GLO-30 DEM (30 m) for the basin, from the coast up into the Western Ghats.

## Contents
- \`terrain/basin_dem.tif\`: 30 m DEM (EPSG:32643, heights above EGM2008), a Cloud Optimized GeoTIFF
- \`vectors/catchment.shp\`: sub-catchment boundaries
- \`model/chalakudy.p01\`: HEC-RAS plan, 100-yr event

## Calibration
Manning's n values were calibrated against the 2018 flood high-water marks.

## Terrain source
Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the
European Union and ESA. Read from the public Copernicus DEM on AWS (tile N10 E076), reprojected to UTM 43N at 30 m.
`;
const metadata = `${JSON.stringify({ crs: "EPSG:32643", vertical: "EGM2008 (EPSG:3855)", resolution_m: 30, source: "Copernicus DEM GLO-30 (ESA), tile N10 E076" }, null, 2)}\n`;

const done = await commitFiles(ctx, repo, {
  branch: repo.default_branch,
  author: "hydrolab",
  message: process.argv[3] ?? "Use real terrain: the Copernicus GLO-30 DEM (30 m) for the basin",
  timestamp: new Date(),
  changes: { "terrain/basin_dem.tif": fs.readFileSync(file), "README.md": Buffer.from(readme), "terrain/dem_metadata.json": Buffer.from(metadata) },
});
console.log("commit", done.id, "checks", done.checks.status, done.checks.steps.map((s) => `${s.name}: ${s.status}`).join("; "));
await warmCommit(ctx, repo, done.id);
await ctx.db.close?.();
process.exit(0);
