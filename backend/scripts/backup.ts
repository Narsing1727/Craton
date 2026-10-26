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

import path from "node:path";
import { config, objectStoreEnabled } from "../src/config.ts";
import { createContext } from "../src/services/context.ts";
import { runBackup } from "../src/services/backup.ts";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const target = path.resolve(arg("to") ?? config.backup.dir);
const keep = Number(arg("keep") ?? config.backup.keep);

const ctx = await createContext();
let result;
try {
  result = await runBackup(ctx, { target, keep });
} catch (err) {
  console.error((err as Error).message);
  await ctx.db.close();
  process.exit(1);
}
const p = result.summary.perTable;
await ctx.db.close();
console.log(`Backed up to ${result.file}`);
console.log(`  ${p.repos ?? 0} repositories, ${p.commits ?? 0} commits, ${p.chunks ?? 0} chunks; ${result.summary.rows} rows in ${result.summary.tables} tables (read back and counted)`);
console.log(objectStoreEnabled() ? "  Chunks are in the object store (R2 or S3): keep bucket versioning on." : `  ${result.copiedChunks} new chunk files copied to ${path.join(target, "chunks")}`);
