// Back up Craton: a consistent copy of the database (SQLite VACUUM INTO, safe while the server
// runs) plus any local chunks not already in the backup (a chunk's name is its hash, so what it stands for never
// changes; repacking may keep it in a smaller form, and the copy already in the backup is then an older, equally valid form). With R2, turn on bucket versioning instead of
// copying chunks.
//
//   npm run backup                 # into data/backups/
//   npm run backup -- --to D:/bk   # somewhere else (another disk, a synced folder)
//   npm run backup -- --keep 14    # keep the newest 14 database copies (default 14)

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config, r2Enabled } from "../src/config.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const target = path.resolve(arg("to") ?? path.join(config.dataDir, "backups"));
const keep = Number(arg("keep") ?? 14);
const dbFile = path.join(config.dataDir, "craton.db");
if (!fs.existsSync(dbFile)) {
  console.error(`No database at ${dbFile}. Nothing to back up.`);
  process.exit(1);
}

fs.mkdirSync(path.join(target, "db"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(target, "db", `craton-${stamp}.db`);
const db = new DatabaseSync(dbFile);
db.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
db.close();

// Verify the copy opens and has the same row counts as the source.
const check = (file: string) => {
  const d = new DatabaseSync(file, { readOnly: true });
  const counts = d.prepare("SELECT (SELECT COUNT(*) FROM repos) AS repos, (SELECT COUNT(*) FROM commits) AS commits, (SELECT COUNT(*) FROM chunks) AS chunks").get() as Record<string, number>;
  d.close();
  return counts;
};
const a = check(dbFile), b = check(out);
if (JSON.stringify(a) !== JSON.stringify(b)) {
  console.error(`Backup verification failed: source ${JSON.stringify(a)} vs copy ${JSON.stringify(b)}`);
  process.exit(1);
}

let copied = 0;
if (!r2Enabled()) {
  const src = path.join(config.dataDir, "chunks");
  const dst = path.join(target, "chunks");
  const walk = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
  for (const file of walk(src)) {
    const rel = path.relative(src, file);
    const to = path.join(dst, rel);
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(file, to);
    copied++;
  }
}

const copies = fs.readdirSync(path.join(target, "db")).filter((f) => /^craton-.*\.db$/.test(f)).sort();
for (const old of copies.slice(0, Math.max(0, copies.length - keep))) fs.rmSync(path.join(target, "db", old));

console.log(`Backed up to ${out}`);
console.log(`  ${b.repos} repositories, ${b.commits} commits, ${b.chunks} chunks (verified against the live database)`);
console.log(r2Enabled() ? "  Chunks are in R2: keep bucket versioning on." : `  ${copied} new chunk files copied to ${path.join(target, "chunks")}`);
