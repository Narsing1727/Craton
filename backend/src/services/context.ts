import path from "node:path";
import type { DB } from "../db/db.ts";
import { openDb } from "../db/db.ts";
import type { ChunkStore } from "../storage/chunk-store.ts";
import { FsStore } from "../storage/fs-store.ts";
import { R2Store } from "../storage/r2-store.ts";
import { config, r2Enabled } from "../config.ts";

/** Everything a service needs: the database and the chunk byte store. */
export type Ctx = { db: DB; store: ChunkStore };

export function createContext(opts?: { dbFile?: string; store?: ChunkStore }): Ctx {
  const db = openDb(opts?.dbFile ?? path.join(config.dataDir, "craton.db"));
  const store =
    opts?.store ??
    (r2Enabled()
      ? new R2Store({ ...config.r2 })
      : new FsStore(path.join(config.dataDir, "chunks")));
  return { db, store };
}

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
