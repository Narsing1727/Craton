// Guess limits that must hold however many servers there are: the failed-password lockout, the two-step code budget and the
// share-link guessing budget. They live in the database (the general request limits in limits.ts are per process, which is fine for
// "slow down" but would let an attacker multiply their guesses by the number of servers).

import type { Queryable } from "../db/db.ts";

type Window = { max: number; windowMs: number };

/** How many hits `key` has within the window. */
export async function count(db: Queryable, key: string, w: Window, now = Date.now()): Promise<number> {
  return (await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM rate_hits WHERE key = ? AND hit_at > ?", key, now - w.windowMs))!.n;
}

/** Record a hit. */
export async function take(db: Queryable, key: string, w: Window, now = Date.now()) {
  await db.run("INSERT INTO rate_hits (key, hit_at) VALUES (?, ?)", key, now);
  // Old rows are dropped now and then, so the table stays small without a job of its own.
  if (Math.random() < 0.02) await db.run("DELETE FROM rate_hits WHERE hit_at < ?", now - Math.max(w.windowMs, 24 * 3_600_000));
}

export async function clear(db: Queryable, key: string) {
  await db.run("DELETE FROM rate_hits WHERE key = ?", key);
}
