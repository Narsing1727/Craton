// Restore Craton from a backup made by scripts/backup.ts. Stop the API first.
//
//   npm run restore -- data/backups/db/craton-2026-10-01T02-00-00-000Z.db
//   npm run restore -- <file> --chunks data/backups/chunks   # also copy missing chunk files back
//
// The current database is kept next to it as craton.db.before-restore-<time> so a mistaken
// restore can itself be undone.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../src/config.ts";

const file = process.argv[2];
const chunksIdx = process.argv.indexOf("--chunks");
const chunkSrc = chunksIdx === -1 ? null : process.argv[chunksIdx + 1];
if (!file || !fs.existsSync(file)) {
  console.error("Usage: npm run restore -- <backup .db file> [--chunks <backup chunks folder>]");
  process.exit(1);
}

// Refuse a file that isn't a Craton database.
const probe = new DatabaseSync(file, { readOnly: true });
const version = probe.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
probe.close();
if (!version) {
  console.error(`${file} isn't a Craton database.`);
  process.exit(1);
}

const dbFile = path.join(config.dataDir, "craton.db");
fs.mkdirSync(config.dataDir, { recursive: true });
if (fs.existsSync(dbFile)) {
  const aside = `${dbFile}.before-restore-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  fs.renameSync(dbFile, aside);
  for (const ext of ["-wal", "-shm"]) if (fs.existsSync(dbFile + ext)) fs.rmSync(dbFile + ext);
  console.log(`Current database moved to ${aside}`);
}
fs.copyFileSync(file, dbFile);

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
console.log(`Restored ${file} (schema version ${version.version}).${chunkSrc ? ` ${copied} chunk files copied back.` : ""} Start the API with npm start.`);
