// PostgreSQL, through one small asynchronous interface with two engines behind it:
//
//   - `pg` (node-postgres) against a real server: a local container, or AWS RDS / Aurora (set CRATON_DATABASE_URL);
//   - PGlite, which is the real Postgres compiled to WebAssembly and run inside this process: no server to install. It is what a
//     development checkout uses when no URL is set (kept in data/pgdata) and what the tests use (in memory).
//
// Both speak the same Postgres SQL, so nothing above this file knows which one it is talking to. SQL is written with `?` placeholders
// (turned into $1, $2 ... here) and returns plain objects. Numbers that Postgres calls bigint or numeric come back as JavaScript numbers,
// and bytea as Buffers.

import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { BASELINE } from "./schema.ts";
import { MIGRATIONS } from "./migrations.ts";

export type Param = string | number | bigint | boolean | null | undefined | Uint8Array;

export interface Queryable {
  /** The first row, or undefined. */
  get<T = any>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T = any>(sql: string, ...params: Param[]): Promise<T[]>;
  /** Run a statement; `changes` is how many rows it inserted, updated or deleted. */
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  /** Run an INSERT and return the new row's `id` (RETURNING id is added). */
  insert(sql: string, ...params: Param[]): Promise<number>;
  /** Run SQL with no parameters (possibly several statements). */
  exec(sql: string): Promise<void>;
}

/** A statement kept for repeated use: `const find = statement(db, "SELECT ... WHERE id = ?"); await find.get(1);` */
export function statement(db: Queryable, sql: string) {
  return {
    get: <T = any>(...params: Param[]) => db.get<T>(sql, ...params),
    all: <T = any>(...params: Param[]) => db.all<T>(sql, ...params),
    run: (...params: Param[]) => db.run(sql, ...params),
  };
}

/**
 * Insert many rows with as few statements as possible (one round trip per few thousand rows instead of one per row, which is what a
 * database across a network needs). `suffix` is what follows the VALUES, by default skipping rows that already exist.
 */
export async function insertMany(db: Queryable, table: string, columns: string[], rows: Param[][], suffix = "ON CONFLICT DO NOTHING") {
  const per = Math.max(1, Math.floor(20_000 / columns.length));
  const one = `(${columns.map(() => "?").join(", ")})`;
  for (let i = 0; i < rows.length; i += per) {
    const slice = rows.slice(i, i + per);
    await db.run(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${slice.map(() => one).join(", ")} ${suffix}`, ...slice.flat());
  }
}

/** Run `fn` over `items` in groups, for `IN (?, ?, ...)` lists that must not grow without limit. */
export async function inGroups<T, R>(items: T[], size: number, fn: (group: T[]) => Promise<R[]>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await fn(items.slice(i, i + size))));
  return out;
}

export interface DB extends Queryable {
  readonly kind: "postgres" | "pglite";
  /**
   * Run `fn` in a transaction: everything it does through the `db` it is given commits together, or none of it does. Inside a
   * transaction, `tx` again just runs `fn` in the same one.
   */
  tx<T>(fn: (db: DB) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/** `?` placeholders to $1, $2 ... (a `?` inside a quoted string is left alone). */
export function numbered(sql: string): string {
  let n = 0;
  let out = "";
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (sql[i + 1] === quote) out += sql[++i]; // doubled quote inside the string
        else quote = null;
      }
    } else if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
    } else if (ch === "?") out += `$${++n}`;
    else out += ch;
  }
  return out;
}

const SLOW_MS = Number(process.env.CRATON_DB_SLOW_MS ?? 0) || 0;

/** A database error that says which statement it came from (the driver's message alone rarely does). */
async function run<T>(sql: string, go: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const out = await go();
    // CRATON_DB_SLOW_MS=200 writes every statement slower than that to the log, with its text, to find what a large database dislikes.
    if (SLOW_MS > 0 && performance.now() - started >= SLOW_MS) console.warn(`slow query (${Math.round(performance.now() - started)} ms): ${sql.replace(/\s+/g, " ").slice(0, 400)}`);
    return out;
  } catch (err) {
    if (err instanceof Error && !err.message.includes("\n  in: ")) err.message += `\n  in: ${sql.replace(/\s+/g, " ").slice(0, 300)}`;
    throw err;
  }
}

// NaN and Infinity are not Postgres integers; as a lookup key they can match nothing, which is what NULL does.
const clean = (params: Param[]): unknown[] => params.map((p) => (p === undefined || (typeof p === "number" && !Number.isFinite(p)) ? null : typeof p === "boolean" ? (p ? 1 : 0) : p));

/** Bytes come back as Uint8Array from PGlite; the rest of the code expects Buffers. */
function normalise<T>(row: T): T {
  if (row && typeof row === "object") for (const [k, v] of Object.entries(row as Record<string, unknown>)) if (v instanceof Uint8Array && !Buffer.isBuffer(v)) (row as Record<string, unknown>)[k] = Buffer.from(v);
  return row;
}

// ---- node-postgres ------------------------------------------------------------------------------------------------------------

pg.types.setTypeParser(20, (v) => Number(v)); // bigint
pg.types.setTypeParser(1700, (v) => Number(v)); // numeric (SUM and AVG of integers)

class PgQueries implements Queryable {
  protected readonly q: { query: (text: string, values?: unknown[]) => Promise<pg.QueryResult> };
  constructor(q: { query: (text: string, values?: unknown[]) => Promise<pg.QueryResult> }) {
    this.q = q;
  }
  async get<T = any>(sql: string, ...params: Param[]) {
    return normalise((await run(sql, () => this.q.query(numbered(sql), clean(params)))).rows[0]) as T | undefined;
  }
  async all<T = any>(sql: string, ...params: Param[]) {
    return (await run(sql, () => this.q.query(numbered(sql), clean(params)))).rows.map(normalise) as T[];
  }
  async run(sql: string, ...params: Param[]) {
    return { changes: (await run(sql, () => this.q.query(numbered(sql), clean(params)))).rowCount ?? 0 };
  }
  async insert(sql: string, ...params: Param[]) {
    return Number((await run(sql, () => this.q.query(`${numbered(sql)} RETURNING id`, clean(params)))).rows[0].id);
  }
  async exec(sql: string) {
    await this.q.query(sql);
  }
}

class PgDb extends PgQueries implements DB {
  readonly kind = "postgres" as const;
  private readonly pool: pg.Pool;
  private readonly onClose?: () => Promise<void>;
  constructor(pool: pg.Pool, onClose?: () => Promise<void>) {
    super(pool);
    this.pool = pool;
    this.onClose = onClose;
  }
  async tx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const inside = new PgTx(client);
    try {
      await client.query("BEGIN");
      const out = await fn(inside);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  async close() {
    await this.pool.end();
    await this.onClose?.();
  }
}

/** The handle given to a transaction on one connection: its own `tx` just continues in the same transaction. */
class PgTx extends PgQueries implements DB {
  readonly kind = "postgres" as const;
  async tx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async close() {}
}

// ---- PGlite -------------------------------------------------------------------------------------------------------------------

type LiteConn = Pick<PGlite, "query" | "exec">;

class LiteQueries implements Queryable {
  protected readonly conn: LiteConn;
  constructor(conn: LiteConn) {
    this.conn = conn;
  }
  async get<T = any>(sql: string, ...params: Param[]) {
    return normalise((await run(sql, () => this.conn.query(numbered(sql), clean(params)))).rows[0]) as T | undefined;
  }
  async all<T = any>(sql: string, ...params: Param[]) {
    return (await run(sql, () => this.conn.query(numbered(sql), clean(params)))).rows.map(normalise) as T[];
  }
  async run(sql: string, ...params: Param[]) {
    return { changes: (await run(sql, () => this.conn.query(numbered(sql), clean(params)))).affectedRows ?? 0 };
  }
  async insert(sql: string, ...params: Param[]) {
    return Number(((await run(sql, () => this.conn.query(`${numbered(sql)} RETURNING id`, clean(params)))).rows[0] as { id: number }).id);
  }
  async exec(sql: string) {
    await this.conn.exec(sql);
  }
}

class LiteDb extends LiteQueries implements DB {
  readonly kind = "pglite" as const;
  private readonly lite: PGlite;
  constructor(lite: PGlite) {
    super(lite);
    this.lite = lite;
  }
  async tx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    // PGlite has one connection; its transaction() holds it exclusively until `fn` is done, so statements of other requests wait.
    return this.lite.transaction(async (t) => fn(new LiteTx(t as unknown as LiteConn)));
  }
  async close() {
    await this.lite.close();
  }
}

class LiteTx extends LiteQueries implements DB {
  readonly kind = "pglite" as const;
  async tx<T>(fn: (db: DB) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async close() {}
}

// ---- opening ------------------------------------------------------------------------------------------------------------------

/** Migrations after the baseline, each run once, in order (the baseline is version 1). */
const migrations = MIGRATIONS;

/** The schema version this build expects. */
export const SCHEMA_VERSION = 1 + migrations.length;

async function migrate(db: DB) {
  const all = [BASELINE, ...migrations];
  // One transaction, under a lock: servers starting together do not run the same migration twice, and a failed one leaves nothing half done.
  await db.tx(async (t) => {
    await t.exec("SELECT pg_advisory_xact_lock(726601)");
    await t.exec("CREATE TABLE IF NOT EXISTS schema_version (version BIGINT NOT NULL)");
    const row = await t.get<{ version: number }>("SELECT version FROM schema_version");
    let version = row?.version ?? 0;
    if (!row) await t.run("INSERT INTO schema_version (version) VALUES (0)");
    for (; version < all.length; version++) {
      await t.exec(all[version]);
      await t.run("UPDATE schema_version SET version = ?", version + 1);
    }
  });
}

export type OpenOptions = { poolMax?: number; caFile?: string; statementTimeoutMs?: number };

/**
 * Settings every server connection gets. A connection that the database drops while idle (an RDS failover, a restart, a network
 * cut) reports on the pool, not on a query: without a listener Node would stop the whole process, so it is logged and the pool
 * simply opens another connection when one is next needed.
 */
function poolFor(target: string, opts: OpenOptions, extra: Partial<pg.PoolConfig> = {}) {
  const ca = opts.caFile ? fs.readFileSync(opts.caFile, "utf8") : undefined;
  const pool = new pg.Pool({
    connectionString: target,
    max: opts.poolMax ?? 10,
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    ...(opts.statementTimeoutMs ? { statement_timeout: opts.statementTimeoutMs } : {}),
    ...(ca ? { ssl: { ca, rejectUnauthorized: true } } : {}),
    ...extra,
  });
  pool.on("error", (err) => console.error(`database connection lost (a new one will be opened when needed): ${err.message}`));
  return pool;
}

/**
 * Open a database and bring its schema up to date.
 *   postgres://user:pass@host:5432/name?sslmode=require   a Postgres server (AWS RDS and Aurora included)
 *   pglite:<folder>                                       Postgres in this process, kept in a folder
 *   :memory: (or pglite:memory)                           Postgres in this process, forgotten when closed (tests)
 */
export async function openDb(target: string, opts: OpenOptions = {}): Promise<DB> {
  // Test runs can ask for a real server instead of the in-process one: CRATON_TEST_PG=postgres://... gives every ":memory:" database its
  // own schema on that server (dropped when closed), so the whole suite runs against the same driver and server as production.
  const testServer = process.env.CRATON_TEST_PG;
  if (testServer && (target === ":memory:" || target === "pglite:memory")) {
    const schema = `t_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    const admin = new pg.Pool({ connectionString: testServer, max: 1 });
    await admin.query("SELECT pg_advisory_lock(726602)");
    await admin.query("CREATE EXTENSION IF NOT EXISTS citext");
    await admin.query("SELECT pg_advisory_unlock(726602)");
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    const pool = poolFor(testServer, opts, { options: `-c search_path=${schema},public` });
    const db = new PgDb(pool, async () => {
      const drop = new pg.Pool({ connectionString: testServer, max: 1 });
      await drop.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => undefined);
      await drop.end();
    });
    await migrate(db);
    return db;
  }
  if (/^postgres(ql)?:\/\//i.test(target)) {
    const db = new PgDb(poolFor(target, opts));
    await migrate(db);
    return db;
  }
  const memory = target === ":memory:" || target === "pglite:memory" || target === "pglite:";
  const folder = target.replace(/^pglite:/, "");
  if (!memory) fs.mkdirSync(path.resolve(folder), { recursive: true });
  const lite = new PGlite({
    ...(memory ? {} : { dataDir: path.resolve(folder) }),
    extensions: { citext },
    parsers: { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) },
  });
  await lite.waitReady;
  const db = new LiteDb(lite);
  await migrate(db);
  return db;
}
