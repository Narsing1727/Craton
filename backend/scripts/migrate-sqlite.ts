// Move an existing SQLite Craton database (data/craton.db, from before Craton ran on PostgreSQL) into the Postgres database Craton is
// configured for (CRATON_DATABASE_URL, or the in-process development one). Row ids are kept, so every reference, commit, chunk and token
// stays valid; identity counters are moved past the largest id. Nothing in the SQLite file is changed.
//
//   npm run migrate-sqlite                       # data/craton.db
//   npm run migrate-sqlite -- path/to/craton.db
//   npm run migrate-sqlite -- --force            # the target already has rows: replace them
//
// Chunk bytes are not in the database (they are files, or objects in R2/S3), so they need no copying.

import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../src/config.ts";
import { resetSequences, tableOrder } from "../src/db/dump.ts";
import { createContext } from "../src/services/context.ts";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const force = process.argv.includes("--force");
const file = path.resolve(args[0] ?? path.join(config.dataDir, "craton.db"));
if (!fs.existsSync(file)) {
  console.error(`No SQLite database at ${file}.`);
  process.exit(1);
}

const source = new DatabaseSync(file, { readOnly: true });
const ctx = await createContext();
const order = await tableOrder(ctx.db);
const sqliteTables = new Set((source.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name));

const existing = await ctx.db.get<{ n: number }>("SELECT (SELECT COUNT(*) FROM owners) + (SELECT COUNT(*) FROM repos) AS n");
if (existing?.n && !force) {
  console.error(`The target database already has ${existing.n} owners and repositories. Run with --force to replace its contents.`);
  process.exit(1);
}

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;
const value = (v: unknown) => (v instanceof Uint8Array ? Buffer.from(v) : v);

const perTable: Record<string, number> = {};
await ctx.db.tx(async (t) => {
  for (const table of [...order].reverse()) await t.exec(`DELETE FROM ${quote(table)}`);
  for (const table of order) {
    if (!sqliteTables.has(table)) continue;
    const target = new Set((await t.all<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?", table)).map((c) => c.column_name));
    const columns = (source.prepare(`PRAGMA table_info(${quote(table)})`).all() as { name: string }[]).map((c) => c.name).filter((c) => target.has(c));
    if (!columns.length) continue;
    const insert = `INSERT INTO ${quote(table)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
    let n = 0;
    // A page at a time, so a big table is never all in memory (and the statement is never left open across an await).
    const pageSize = 1000;
    const select = source.prepare(`SELECT ${columns.map(quote).join(", ")} FROM ${quote(table)} ORDER BY rowid LIMIT ${pageSize} OFFSET ?`);
    for (let offset = 0; ; offset += pageSize) {
      const page = select.all(offset) as Record<string, unknown>[];
      for (const row of page) {
        await t.run(insert, ...columns.map((c) => value(row[c]) as never));
        n++;
      }
      if (page.length < pageSize) break;
    }
    perTable[table] = n;
  }
  await resetSequences(t);
});

// Count what arrived against what was there.
const bad: string[] = [];
for (const [table, n] of Object.entries(perTable)) {
  const got = (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${quote(table)}`))!.n;
  if (got !== n) bad.push(`${table}: ${n} in SQLite, ${got} in Postgres`);
}
await ctx.db.close();
source.close();
if (bad.length) {
  console.error(`Row counts differ:\n  ${bad.join("\n  ")}`);
  process.exit(1);
}
const rows = Object.values(perTable).reduce((a, b) => a + b, 0);
console.log(`Moved ${rows} rows in ${Object.keys(perTable).length} tables from ${file}; every table's count matches.`);
for (const key of ["owners", "repos", "commits", "chunks"]) if (perTable[key] !== undefined) console.log(`  ${key}: ${perTable[key]}`);
