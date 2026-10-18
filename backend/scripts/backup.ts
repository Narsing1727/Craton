// Back up Craton: a consistent logical copy of the database (every table, as gzipped JSON lines, taken in one transaction so it is safe
// while the server runs) plus any local chunks not already in the backup (a chunk's name is its hash, so what it stands for never
// changes; repacking may keep it in a smaller form, and the copy already in the backup is then an older, equally valid form). With R2 or S3,
// turn on bucket versioning instead of copying chunks.
//
// Works on whatever database Craton is using: a Postgres server (CRATON_DATABASE_URL, AWS RDS and Aurora included) or the in-process
// development database. On a big production server take RDS snapshots or `pg_dump` as well; this copy is the one that also loads into a
// different engine and that `npm run restore` understands.
//
//   npm run backup                 # into data/backups/
//   npm run backup -- --to D:/bk   # somewhere else (another disk, a synced folder)
//   npm run backup -- --keep 14    # keep the newest 14 database copies (default 14)

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { config, r2Enabled } from "../src/config.ts";
import { createContext } from "../src/services/context.ts";
import { dumpDatabase } from "../src/db/dump.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const target = path.resolve(arg("to") ?? path.join(config.dataDir, "backups"));
const keep = Number(arg("keep") ?? 14);

fs.mkdirSync(path.join(target, "db"), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(target, "db", `craton-${stamp}.dump.gz`);

const ctx = await createContext();
const gz = zlib.createGzip({ level: 6 });
const sink = fs.createWriteStream(out);
const finished = new Promise<void>((resolve, reject) => {
  sink.on("finish", resolve);
  sink.on("error", reject);
  gz.on("error", reject);
});
gz.pipe(sink);
const summary = await dumpDatabase(ctx.db, (line) => new Promise<void>((resolve) => (gz.write(line) ? resolve() : gz.once("drain", resolve))));
gz.end();
await finished;

// Verify the copy: read it back and compare the row count of every table with what was dumped.
const readBack: Record<string, number> = {};
{
  const text = zlib.gunzipSync(fs.readFileSync(out)).toString("utf8");
  for (const line of text.split("\n")) {
    if (!line) continue;
    const obj = JSON.parse(line);
    if (obj.t) readBack[obj.t] = (readBack[obj.t] ?? 0) + obj.rows.length;
  }
}
const bad = Object.entries(summary.perTable).filter(([table, n]) => (readBack[table] ?? 0) !== n);
if (bad.length) {
  console.error(`Backup verification failed for: ${bad.map(([t]) => t).join(", ")}`);
  fs.rmSync(out);
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

const copies = fs.readdirSync(path.join(target, "db")).filter((f) => /^craton-.*\.dump\.gz$/.test(f)).sort();
for (const old of copies.slice(0, Math.max(0, copies.length - keep))) fs.rmSync(path.join(target, "db", old));

const p = summary.perTable;
await ctx.db.close();
console.log(`Backed up to ${out}`);
console.log(`  ${p.repos ?? 0} repositories, ${p.commits ?? 0} commits, ${p.chunks ?? 0} chunks; ${summary.rows} rows in ${summary.tables} tables (read back and counted)`);
console.log(r2Enabled() ? "  Chunks are in R2: keep bucket versioning on." : `  ${copied} new chunk files copied to ${path.join(target, "chunks")}`);
