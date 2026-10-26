// A consistent copy of the database, taken while the server runs: every table as gzipped JSON lines (src/db/dump.ts), written in one
// transaction, then read back and counted table by table before it is kept. A copy that does not read back is deleted and reported, never kept
// as if it were good. Also copies local chunk files not already in the backup (a chunk's name is its hash, so what it stands for never changes).
// With R2 or S3 chunks live in the bucket: turn on bucket versioning there.
//
// `npm run backup` runs this once; a server started with CRATON_BACKUP_EVERY_HOURS (or without a database server address, where the data folder
// is the only copy there is) runs it by itself and keeps the newest CRATON_BACKUP_KEEP copies.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import readline from "node:readline";
import { config, objectStoreEnabled } from "../config.ts";
import { dumpDatabase, type DumpSummary } from "../db/dump.ts";
import type { Ctx } from "./context.ts";
import { getCache } from "../cache/cache.ts";

export type BackupResult = { file: string; summary: DumpSummary; copiedChunks: number; ms: number };

const COPY = /^craton-.*\.dump\.gz$/;

/** Read a copy back and count the rows of every table, a line at a time (a big database must not have to fit in memory). */
export async function countRows(file: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const lines = readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    const obj = JSON.parse(line) as { t?: string; rows?: unknown[] };
    if (obj.t) counts[obj.t] = (counts[obj.t] ?? 0) + (obj.rows?.length ?? 0);
  }
  return counts;
}

export async function runBackup(ctx: Ctx, opts: { target: string; keep: number }): Promise<BackupResult> {
  const started = Date.now();
  fs.mkdirSync(path.join(opts.target, "db"), { recursive: true });
  const out = path.join(opts.target, "db", `craton-${new Date().toISOString().replace(/[:.]/g, "-")}.dump.gz`);
  const gz = zlib.createGzip({ level: 6 });
  const sink = fs.createWriteStream(out);
  const finished = new Promise<void>((resolve, reject) => {
    sink.on("finish", resolve);
    sink.on("error", reject);
    gz.on("error", reject);
  });
  gz.pipe(sink);
  let summary: DumpSummary;
  try {
    summary = await dumpDatabase(ctx.db, (line) => new Promise<void>((resolve) => (gz.write(line) ? resolve() : gz.once("drain", resolve))));
    gz.end();
    await finished;
  } catch (err) {
    gz.destroy();
    sink.destroy();
    fs.rmSync(out, { force: true });
    throw err;
  }

  // Verify the copy: read it back and compare the row count of every table with what was dumped.
  const readBack = await countRows(out).catch((err) => {
    fs.rmSync(out, { force: true });
    throw new Error(`The backup could not be read back (${(err as Error).message}); it was deleted.`);
  });
  const bad = Object.entries(summary.perTable).filter(([table, n]) => (readBack[table] ?? 0) !== n);
  if (bad.length) {
    fs.rmSync(out, { force: true });
    throw new Error(`Backup verification failed for: ${bad.map(([t]) => t).join(", ")}; the copy was deleted.`);
  }

  let copiedChunks = 0;
  if (!objectStoreEnabled()) {
    const src = path.join(config.dataDir, "chunks");
    const dst = path.join(opts.target, "chunks");
    const walk = (dir: string): string[] => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)])) : []);
    for (const file of walk(src)) {
      const to = path.join(dst, path.relative(src, file));
      if (fs.existsSync(to)) continue;
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(file, to);
      copiedChunks++;
    }
  }

  const copies = fs.readdirSync(path.join(opts.target, "db")).filter((f) => COPY.test(f)).sort();
  for (const old of copies.slice(0, Math.max(0, copies.length - Math.max(1, opts.keep)))) fs.rmSync(path.join(opts.target, "db", old));
  return { file: out, summary, copiedChunks, ms: Date.now() - started };
}

/** When the newest copy in `target` was made (ms since the epoch), or 0. */
export function lastBackupAt(target: string): number {
  const dir = path.join(target, "db");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => COPY.test(f)).reduce((newest, f) => Math.max(newest, fs.statSync(path.join(dir, f)).mtimeMs), 0);
}

/** Back up on a schedule, if it is turned on. The first copy waits for the server to settle, and for the interval since the last copy on disk. */
export function startBackupLoop(ctx: Ctx, opts = config.backup) {
  if (opts.everyHours <= 0) return null;
  const every = opts.everyHours * 3_600_000;
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      // Servers that share a cache take turns: whoever gets the lock makes this interval's copy (it holds for just under the interval).
      if (!(await getCache().lock("backup", Math.max(60_000, every - 60_000)))) return;
      const r = await runBackup(ctx, { target: opts.dir, keep: opts.keep });
      console.log(`Backed up to ${r.file} (${r.summary.rows} rows in ${r.summary.tables} tables, ${r.copiedChunks} new chunk files, ${r.ms} ms)`);
    } catch (err) {
      console.error("scheduled backup failed:", err);
    } finally {
      running = false;
    }
  };
  const due = Math.max(120_000, lastBackupAt(opts.dir) + every - Date.now());
  let timer: NodeJS.Timeout;
  const schedule = (wait: number) => {
    timer = setTimeout(() => {
      void run().finally(() => schedule(every));
    }, wait);
    timer.unref();
  };
  schedule(due);
  return { stop: () => clearTimeout(timer), runNow: run };
}
