// Restore Craton from a backup made by scripts/backup.ts. Stop the API first.
//
//   npm run restore -- data/backups/db/craton-2026-10-01T02-00-00-000Z.dump.gz
//   npm run restore -- <file> --chunks data/backups/chunks   # also copy missing chunk files back
//
// The database named by CRATON_DATABASE_URL (or the development one) is emptied and filled from the file, in one transaction: a file that
// fails halfway leaves the database as it was. Before that, a copy of what is there now is written next to the file as
// before-restore-<time>.dump.gz so a mistaken restore can itself be undone.

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import zlib from "node:zlib";
import { config } from "../src/config.ts";
import { SCHEMA_VERSION } from "../src/db/db.ts";
import { dumpDatabase, loadDump } from "../src/db/dump.ts";
import { createContext } from "../src/services/context.ts";

const file = process.argv[2];
const chunksIdx = process.argv.indexOf("--chunks");
const chunkSrc = chunksIdx === -1 ? null : process.argv[chunksIdx + 1];
if (!file || !fs.existsSync(file)) {
  console.error("Usage: npm run restore -- <backup .dump.gz file> [--chunks <backup chunks folder>]");
  process.exit(1);
}

// The reader starts when the first line is asked for, not when it is made: readline drops lines that arrive before someone is listening
// (and never ends), and the restore opens its transaction first.
async function* lines() {
  yield* readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}

// Refuse a file that is not a Craton dump, before touching anything.
const first = await (async () => {
  for await (const line of lines()) return line;
  return "";
})();
let head: { craton_dump?: number; schema_version?: number } = {};
try {
  head = JSON.parse(first);
} catch {}
if (head.craton_dump !== 1) {
  console.error(`${file} is not a Craton dump.`);
  process.exit(1);
}

const ctx = await createContext();
fs.mkdirSync(config.dataDir, { recursive: true });
const aside = path.join(path.dirname(path.resolve(file)), `before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}.dump.gz`);
{
  const gz = zlib.createGzip();
  const sink = fs.createWriteStream(aside);
  gz.pipe(sink);
  const done = new Promise<void>((resolve) => sink.on("finish", resolve));
  await dumpDatabase(ctx.db, (line) => new Promise<void>((resolve) => (gz.write(line) ? resolve() : gz.once("drain", resolve))));
  gz.end();
  await done;
  console.log(`Current database copied to ${aside}`);
}

const summary = await loadDump(ctx.db, lines(), { currentVersion: SCHEMA_VERSION });
await ctx.db.close();

let copied = 0;
if (chunkSrc) {
  const dst = path.join(config.dataDir, "chunks");
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const f of walk(chunkSrc)) {
    const to = path.join(dst, path.relative(chunkSrc, f));
    if (fs.existsSync(to)) continue;
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(f, to);
    copied++;
  }
}
console.log(`Restored ${file} (schema version ${head.schema_version}): ${summary.rows} rows in ${summary.tables} tables.${chunkSrc ? ` ${copied} chunk files copied back.` : ""} Start the API with npm start.`);
