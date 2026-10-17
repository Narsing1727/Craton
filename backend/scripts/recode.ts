// Keep the old versions of DEFLATE GeoTIFFs as their pixels (the cold tier). Dry run by default: it only reports.
//
//   npm run recode                       # how much stored history would shrink
//   npm run recode -- --apply            # do it
//   npm run recode -- --repo owner/name  # one repository
//   npm run recode -- --verify           # make every stored tile's original stream again and check it
//   npm run recode -- --apply --include-tips   # also the newest version of each file (reading it then costs CPU)

import { createContext } from "../src/services/context.ts";
import { findRepo, type RepoRow } from "../src/services/repos.ts";
import { recodeRepository } from "../src/services/recode.ts";
import { verifyTiles } from "../src/services/tiles.ts";

const has = (flag: string) => process.argv.includes(flag);
const at = process.argv.indexOf("--repo");
const only = at === -1 ? null : process.argv[at + 1];
const ctx = createContext();
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

if (has("--verify")) {
  const v = await verifyTiles(ctx);
  console.log(`Rebuilt ${v.checked} stored tiles: ${v.bad.length ? `${v.bad.length} do not make their original stream again` : "every one makes its original stream again, byte for byte"}.`);
  process.exitCode = v.bad.length ? 1 : 0;
} else {
  const apply = has("--apply");
  let repos: RepoRow[];
  if (only) {
    const [owner, name] = only.split("/");
    repos = [findRepo(ctx, owner, name)];
  } else {
    const rows = ctx.db.prepare("SELECT o.handle AS owner, r.name FROM repos r JOIN owners o ON o.id = r.owner_id ORDER BY r.id").all() as { owner: string; name: string }[];
    repos = rows.map((r) => findRepo(ctx, r.owner, r.name));
  }
  let tiles = 0;
  let chunks = 0;
  let saved = 0;
  for (const repo of repos) {
    const r = await recodeRepository(ctx, repo, { apply, includeHot: has("--include-tips"), force: has("--force") });
    if (r.chunks) console.log(`${repo.owner}/${repo.name}: ${r.tiles} tiles kept as pixels, ${r.chunks} chunks in ${r.files} file versions, ${mb(r.savedBytes)} ${apply ? "saved" : "would be saved"}`);
    tiles += r.tiles;
    chunks += r.chunks;
    saved += r.savedBytes;
  }
  console.log(apply ? `Kept ${tiles} tiles as pixels and rewrote ${chunks} chunks, saving ${mb(saved)}.` : `${chunks} chunks (${tiles} tiles) could be kept as pixels, saving ${mb(saved)}. Run with --apply to do it.`);
  if (apply) {
    const v = await verifyTiles(ctx);
    console.log(`Rebuilt ${v.checked} stored tiles: ${v.bad.length ? `${v.bad.length} do not make their original stream again` : "all make their original stream again"}.`);
    process.exitCode = v.bad.length ? 1 : 0;
  }
}
