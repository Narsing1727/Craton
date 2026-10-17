// Store what changed between versions of numeric rasters as differences. Dry run by default: it only reports.
//
//   npm run repack                       # how much stored history would shrink
//   npm run repack -- --apply            # do it
//   npm run repack -- --repo owner/name  # one repository

import { createContext } from "../src/services/context.ts";
import { findRepo, type RepoRow } from "../src/services/repos.ts";
import { repackRepository, verifyDifferences } from "../src/services/repack.ts";

const apply = process.argv.includes("--apply");
const at = process.argv.indexOf("--repo");
const only = at === -1 ? null : process.argv[at + 1];
const ctx = createContext();
let repos: RepoRow[];
if (only) {
  const [owner, name] = only.split("/");
  repos = [findRepo(ctx, owner, name)];
} else {
  const rows = ctx.db.prepare("SELECT o.handle AS owner, r.name FROM repos r JOIN owners o ON o.id = r.owner_id ORDER BY r.id").all() as { owner: string; name: string }[];
  repos = rows.map((r) => findRepo(ctx, r.owner, r.name));
}
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
let chunks = 0;
let saved = 0;
for (const repo of repos) {
  const r = await repackRepository(ctx, repo, { apply });
  if (r.chunks) console.log(`${repo.owner}/${repo.name}: ${r.chunks} chunks in ${r.files} file versions, ${mb(r.savedBytes)} ${apply ? "saved" : "would be saved"}`);
  chunks += r.chunks;
  saved += r.savedBytes;
}
console.log(apply ? `Stored ${chunks} chunks as differences, saving ${mb(saved)}.` : `${chunks} chunks could be stored as differences, saving ${mb(saved)}. Run with --apply to do it.`);
if (apply) {
  const v = await verifyDifferences(ctx);
  console.log(`Checked ${v.checked} stored differences: ${v.bad.length ? `${v.bad.length} do not decode` : "all decode to their own hash"}.`);
  if (v.bad.length) process.exitCode = 1;
}
