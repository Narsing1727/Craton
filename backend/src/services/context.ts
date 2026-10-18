import path from "node:path";
import type { DB } from "../db/db.ts";
import { openDb } from "../db/db.ts";
import type { ChunkStore } from "../storage/chunk-store.ts";
import { FsStore } from "../storage/fs-store.ts";
import { R2Store } from "../storage/r2-store.ts";
import { S3Store } from "../storage/s3-store.ts";
import { config, r2Enabled, s3Enabled } from "../config.ts";

/** Everything a service needs: the database and the chunk byte store. */
export type Ctx = { db: DB; store: ChunkStore };

export async function createContext(opts?: { database?: string; store?: ChunkStore }): Promise<Ctx> {
  const db = await openDb(opts?.database ?? (config.database.url || `pglite:${path.join(config.dataDir, "pgdata")}`), { poolMax: config.database.poolMax, caFile: config.database.caFile || undefined, statementTimeoutMs: config.database.statementTimeoutMs });
  const store =
    opts?.store ??
    (r2Enabled()
      ? new R2Store({ ...config.r2 })
      : s3Enabled()
        ? new S3Store({ ...config.s3, endpoint: config.s3.endpoint || undefined, sessionToken: config.s3.sessionToken || undefined })
        : new FsStore(path.join(config.dataDir, "chunks")));
  return { db, store };
}

/** Do `fn` with a context whose database is one transaction: everything it writes commits together or not at all. */
export const inTransaction = <T>(ctx: Ctx, fn: (ctx: Ctx) => Promise<T>): Promise<T> => ctx.db.tx((db) => fn({ ...ctx, db }));

/** Serialise the people who number things in one repository (issues and pull requests share a counter): held until the transaction ends. */
export const lockNumbering = (db: DB, repoId: number) => db.get("SELECT pg_advisory_xact_lock(7266, ?::int)", repoId);

/** Whether a database error is a violated unique constraint (Postgres code 23505), a missing referenced row (23503) or a failed check (23514). */
export const isUnique = (err: unknown) => (err as { code?: string })?.code === "23505";
export const isForeignKey = (err: unknown) => (err as { code?: string })?.code === "23503";

/** Errors that map to HTTP status codes and a stable `code` for clients. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (what: string) => new ApiError(404, "not_found", `${what} not found`);
export const forbidden = (message = "You don’t have access to this") => new ApiError(403, "forbidden", message);
export const badRequest = (message: string, details?: unknown) => new ApiError(400, "bad_request", message, details);
export const conflict = (code: string, message: string, details?: unknown) => new ApiError(409, code, message, details);
