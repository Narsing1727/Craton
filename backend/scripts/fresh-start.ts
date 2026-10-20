// A clean start for a development server: a new, empty database with one account and one repository of real data, instead of the demo
// people, organisations and projects `npm run seed` makes. Run with CRATON_DATA_DIR pointing at a NEW, empty folder (the server must not be
// using it), then swap that folder in for the old data folder:
//
//   CRATON_DATA_DIR=D:/somewhere/new-data node scripts/fresh-start.ts <dem.tif> <waterways.geojson> <handle> <email> "<name>"
//
// It prints a one-time password for the account; change it after signing in.

import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { createContext } from "../src/services/context.ts";
import { createUser } from "../src/services/accounts.ts";
import { createRepo, updateRepo } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { warmCommit } from "../src/render/previews.ts";
import { config } from "../src/config.ts";

const [dem, waterways, handle, email, name] = process.argv.slice(2);
if (!dem || !waterways || !handle || !email || !name) throw new Error("Give: <dem.tif> <waterways.geojson> <handle> <email> \"<name>\"");
if (fs.existsSync(`${config.dataDir}/pgdata`)) throw new Error(`${config.dataDir} already has a database; point CRATON_DATA_DIR at a new, empty folder.`);

const ctx = await createContext();
const password = randomBytes(12).toString("base64url");
const user = await createUser(ctx, { handle, email, password, name });
await ctx.db.run("UPDATE users SET email_verified_at = now_iso(), onboarded_at = now_iso() WHERE owner_id = ?", user.id);

const repo = await createRepo(ctx, user.id, {
  name: "the-first-repo",
  description: "Terrain and waterways of the Chalakudy river basin, Kerala: the Copernicus 30 m DEM and the OpenStreetMap river network.",
  visibility: "public",
  crs: "EPSG:32643",
  region: "Kerala, India",
  nodata: -32768,
  verticalDatum: 3855,
});
await updateRepo(ctx, repo, { topics: ["dem", "hydrology", "kerala", "rivers"] });

const readme = `# The first repo

Terrain and waterways of the Chalakudy river basin in Kerala, India: the coastal plain at the Arabian Sea up into the Western Ghats.

## Contents

- \`terrain/chalakudy_dem_30m.tif\`: elevation, 30 m cells, 1611 × 966, from -2.6 m to 1,158 m. UTM zone 43N (EPSG:32643), heights above EGM2008 (EPSG:3855), nodata -32768. A Cloud Optimized GeoTIFF.
- \`vectors/waterways.geojson\`: 1,900 rivers, streams and canals, with their names, as lines in longitude and latitude (EPSG:4326).

## Sources

- Elevation: Copernicus DEM GLO-30, tile N10 E076, read from the public Copernicus DEM on AWS and reprojected to UTM 43N at 30 m. Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA; all rights reserved.
- Waterways: © OpenStreetMap contributors, available under the Open Database Licence (ODbL 1.0, https://www.openstreetmap.org/copyright), extracted with the Overpass API.
`;

const done = await commitFiles(ctx, repo, {
  branch: repo.default_branch,
  author: handle,
  message: "Add the Chalakudy basin: Copernicus 30 m terrain and OpenStreetMap waterways",
  timestamp: new Date(),
  changes: {
    "README.md": Buffer.from(readme),
    "terrain/chalakudy_dem_30m.tif": fs.readFileSync(dem),
    "vectors/waterways.geojson": fs.readFileSync(waterways),
  },
});
console.log("commit", done.id, "checks", done.checks.status, done.checks.steps.map((s) => `${s.name}: ${s.status}`).join("; "));
await warmCommit(ctx, repo, done.id);
console.log(`account ${handle} <${email}> one-time password: ${password}`);
await ctx.db.close?.();
process.exit(0);
