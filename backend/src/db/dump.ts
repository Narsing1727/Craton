// A logical copy of the whole database as lines of JSON, and the way back. It is engine-neutral: it works the same on a Postgres server
// (RDS, Aurora) and on PGlite, and a dump from one loads into the other. `pg_dump` is still the right tool for a big production
// server; this is what the backup script uses where it is not installed, and what moves a SQLite-era database into Postgres.
//
// Line 1:   {"craton_dump":1,"schema_version":N,"tables":[...]}      (tables in an order that respects foreign keys)
// Then:     {"t":"table","rows":[{...},{...}]}                        (a table may take several lines)
// bytea is written as {"$hex":"..."}; every other column is already JSON (timestamps are ISO text in this schema).

import type { DB } from "./db.ts";

const BATCH = 500;

export type DumpSummary = { tables: number; rows: number; perTable: Record<string, number> };

const encode = (row: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Uint8Array ? { $hex: Buffer.from(v).toString("hex") } : v;
  return out;
};
const decode = (v: unknown) => (v && typeof v === "object" && "$hex" in (v as object) ? Buffer.from((v as { $hex: string }).$hex, "hex") : v);

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** The user tables, parents before the tables that reference them. */
export async function tableOrder(db: DB): Promise<string[]> {
  const tables = (await db.all<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = current_schema() AND tablename <> 'schema_version' ORDER BY tablename")).map((t) => t.name);
  const edges = await db.all<{ child: string; parent: string }>(
    `SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
       FROM pg_constraint c WHERE c.contype = 'f' AND c.connamespace = current_schema()::regnamespace`,
  );
  const needs = new Map<string, Set<string>>(tables.map((t) => [t, new Set()]));
  for (const e of edges) {
    const child = e.child.replace(/^"|"$/g, "");
    const parent = e.parent.replace(/^"|"$/g, "");
    if (child !== parent && needs.has(child) && needs.has(parent)) needs.get(child)!.add(parent);
  }
  const order: string[] = [];
  const done = new Set<string>();
  while (order.length < tables.length) {
    const next = tables.filter((t) => !done.has(t) && [...needs.get(t)!].every((p) => done.has(p)));
    if (!next.length) throw new Error(`Foreign keys form a cycle between ${tables.filter((t) => !done.has(t)).join(", ")}; load them with pg_restore instead.`);
    for (const t of next) {
      done.add(t);
      order.push(t);
    }
  }
  return order;
}

/** Write every table to `write`, one JSON line at a time. Runs in one transaction so the copy is a single moment in time. */
export async function dumpDatabase(db: DB, write: (line: string) => Promise<void> | void): Promise<DumpSummary> {
  const summary: DumpSummary = { tables: 0, rows: 0, perTable: {} };
  await db.tx(async (t) => {
    // Repeatable read: later batches of a table see what the first one saw even while the server keeps writing.
    await t.exec("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const order = await tableOrder(t);
    const version = (await t.get<{ version: number }>("SELECT version FROM schema_version"))?.version ?? 0;
    await write(JSON.stringify({ craton_dump: 1, schema_version: version, tables: order }) + "\n");
    for (const table of order) {
      let count = 0;
      for (let offset = 0; ; offset += BATCH) {
        const rows = await t.all<Record<string, unknown>>(`SELECT * FROM ${quote(table)} ORDER BY 1 LIMIT ${BATCH} OFFSET ${offset}`);
        if (!rows.length) break;
        await write(JSON.stringify({ t: table, rows: rows.map(encode) }) + "\n");
        count += rows.length;
        if (rows.length < BATCH) break;
      }
      summary.perTable[table] = count;
      summary.rows += count;
      summary.tables++;
    }
  });
  return summary;
}

/**
 * Replace the contents of the database with a dump. Everything happens in one transaction: a dump that fails halfway leaves the
 * database as it was. The tables must be the ones this version of Craton has (the dump's schema version must not be newer).
 */
export async function loadDump(db: DB, lines: AsyncIterable<string> | Iterable<string>, opts: { currentVersion: number }): Promise<DumpSummary> {
  const summary: DumpSummary = { tables: 0, rows: 0, perTable: {} };
  await db.tx(async (t) => {
    let header: { schema_version: number; tables: string[] } | null = null;
    for await (const raw of lines as AsyncIterable<string>) {
      const line = raw.trim();
      if (!line) continue;
      const obj = JSON.parse(line);
      if (!header) {
        if (obj.craton_dump !== 1) throw new Error("That file is not a Craton dump.");
        if (obj.schema_version > opts.currentVersion) throw new Error(`The dump is from a newer Craton (schema ${obj.schema_version}; this one is ${opts.currentVersion}). Upgrade first.`);
        header = obj;
        const known = new Set(await tableOrder(t));
        const unknown = obj.tables.filter((n: string) => !known.has(n));
        if (unknown.length) throw new Error(`The dump has tables this database does not: ${unknown.join(", ")}.`);
        // Children first, so nothing is still referenced when its parent goes.
        for (const table of [...(await tableOrder(t))].reverse()) await t.exec(`DELETE FROM ${quote(table)}`);
        continue;
      }
      const rows: Record<string, unknown>[] = obj.rows;
      if (!rows.length) continue;
      const columns = Object.keys(rows[0]);
      const sql = `INSERT INTO ${quote(obj.t)} (${columns.map(quote).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;
      for (const row of rows) await t.run(sql, ...columns.map((c) => decode(row[c]) as never));
      summary.perTable[obj.t] = (summary.perTable[obj.t] ?? 0) + rows.length;
      summary.rows += rows.length;
    }
    if (!header) throw new Error("The dump is empty.");
    summary.tables = Object.keys(summary.perTable).length;
    await resetSequences(t);
  });
  return summary;
}

/** After rows were inserted with their own ids, point each identity counter past the largest one. */
export async function resetSequences(db: DB) {
  const seqs = await db.all<{ table: string; column: string }>(
    `SELECT c.relname AS "table", a.attname AS "column"
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      WHERE c.relnamespace = current_schema()::regnamespace AND c.relkind = 'r' AND a.attidentity <> ''`,
  );
  for (const s of seqs) {
    await db.exec(
      `SELECT setval(pg_get_serial_sequence('${quote(s.table)}', '${s.column}'), GREATEST(1, (SELECT COALESCE(MAX(${quote(s.column)}), 0) FROM ${quote(s.table)})), (SELECT COUNT(*) > 0 FROM ${quote(s.table)}))`,
    );
  }
}

export const schemaVersion = async (db: DB) => (await db.get<{ version: number }>("SELECT version FROM schema_version"))?.version ?? 0;
