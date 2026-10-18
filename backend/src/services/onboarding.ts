// First-run experience: the getting-started checklist, and a sample project a new user can
// explore before they have data of their own (real files, checks, a branch and a pull request).

import type { Ctx } from "./context.ts";
import type { User } from "./accounts.ts";
import type { RepoRow } from "./repos.ts";
import { listRepos } from "./repos.ts";
import { writableOwners } from "./stats.ts";
import { createPull } from "./collab.ts";
import { commitFiles } from "../dev/push.ts";
import { catchments, gaugesCsv, geotiff, hecRas, shapefile } from "../dev/fixtures.ts";


export type ChecklistItem = { id: string; done: boolean };

/**
 * Activation steps, each tied to something the user does in the product. Account creation is
 * always done, so the list never starts at zero.
 */
export async function checklist(ctx: Ctx, user: User): Promise<ChecklistItem[]> {
  const owners = await writableOwners(ctx, user.id);
  const repos = (await listRepos(ctx, user.id)).filter((r) => owners.includes(r.owner));
  const ids = repos.map((r) => r.id);
  const inRepos = async (sql: string, ...args: (string | number)[]) =>
    ids.length ? Boolean(await ctx.db.get(sql.replace("{ids}", ids.join(",")), ...args)) : false;

  return [
    { id: "account", done: true },
    { id: "repository", done: repos.length > 0 },
    { id: "merge", done: await inRepos("SELECT 1 FROM pulls WHERE repo_id IN ({ids}) AND state = 'merged' LIMIT 1") },
    { id: "cli", done: Boolean(await ctx.db.get("SELECT 1 FROM tokens WHERE user_id = ? AND kind = 'pat' AND last_used_at IS NOT NULL LIMIT 1", user.id)) },
    // A push of their own (the push endpoint the CLI uses), not a merge or branch made in the app.
    { id: "push", done: await inRepos("SELECT 1 FROM ref_log WHERE repo_id IN ({ids}) AND actor = ? AND via = 'push' LIMIT 1", user.handle) },
  ];
}

const shp = (set: ReturnType<typeof shapefile>, base: string) => Object.fromEntries(Object.entries(set).map(([ext, buf]) => [`${base}.${ext}`, buf]));

const README = `# Sample basin

A small, complete flood model to explore Craton with. Everything here is real data in real
formats, and every push was checked.

## What's inside
- \`terrain/basin_dem.tif\`: 2 m elevation model (GeoTIFF, EPSG:32643, EGM2008 heights)
- \`vectors/catchment.shp\`: sub-catchment boundaries (shapefile set)
- \`model/\`: a HEC-RAS project with a 100-year plan
- \`gauges.csv\`: stage and discharge readings

## Try this
- Open the pull request: a re-survey that changed a few rows of the DEM. See which chunks are new.
- Merge it once you've looked at the checks.
- Clone it with the CLI and push a change of your own.
`;

/**
 * Fill a new repository with the sample project: an initial import on main, then a branch that
 * re-surveys part of the DEM, with an open pull request from it.
 */
export async function importSample(ctx: Ctx, repo: RepoRow, user: User) {
  const now = Date.now();
  const at = (hoursAgo: number) => new Date(now - hoursAgo * 3_600_000);
  const dem = (resurvey?: { from: number; to: number; offset: number }) =>
    geotiff({ width: 512, height: 512, epsg: 32643, verticalEpsg: 3855, nodata: -9999, seed: 21, resurvey, origin: [632000, 1130000], pixelSize: 2 });

  await commitFiles(ctx, repo, {
    branch: "main",
    author: user.handle,
    via: "import",
    message: "Import sample basin: terrain, catchments, HEC-RAS model and gauges",
    timestamp: at(2),
    changes: {
      "README.md": Buffer.from(README),
      "terrain/basin_dem.tif": dem(),
      ...shp(shapefile(catchments(6)), "vectors/catchment"),
      ...hecRas(),
      "gauges.csv": Buffer.from(gaugesCsv(30)),
    },
  });
  await commitFiles(ctx, repo, {
    branch: "sample-resurvey",
    from: "main",
    author: user.handle,
    via: "import",
    message: "Re-survey the right bank (DEM rows 420 to 480)",
    timestamp: at(1),
    changes: { "terrain/basin_dem.tif": dem({ from: 420, to: 480, offset: -0.35 }) },
  });
  await createPull(ctx, repo, user.id, {
    title: "Re-survey the right bank after bank erosion",
    body: "The 2024 survey found the right bank 0.35 m lower between rows 420 and 480. Only those rows changed, so only a few chunks are new. Checks passed; review the change and merge it.",
    source: "sample-resurvey",
    target: "main",
  });
}
