// Idempotency keys (Stripe's model: https://docs.stripe.com/api/idempotent_requests). A client
// sends `Idempotency-Key: <uuid>` on a mutating request; a retry with the same key from the same
// actor gets back the exact first response — status and body, even an error — instead of the
// request being applied twice. Protects against double stars, double comments, double commits:
// anywhere a connection can drop right as the server finishes but before the client sees it.
//
// Opt-in: a request without the header behaves exactly as before. Scoped per actor (token or IP)
// + method + path, so a key can't collide across unrelated endpoints by accident.
//
// Kept in the shared cache (cache/cache.ts): with Redis, a retry that lands on a different server still sees the first result.

import { createHash } from "node:crypto";
import { getCache, setCache } from "../cache/cache.ts";

type Stored = { status: number; headers: [string, string][]; body: string };

const TTL_SECONDS = 24 * 60 * 60; // Stripe keeps keys 24h; we match that.

export function keyFor(actor: string, method: string, path: string, idemKey: string): string {
  return `idem:${createHash("sha256").update(`${actor}|${method}|${path}|${idemKey}`).digest("hex")}`;
}

export async function get(key: string): Promise<Stored | undefined> {
  const hit = await getCache().get(key);
  if (!hit) return undefined;
  try {
    return JSON.parse(hit.toString("utf8")) as Stored;
  } catch {
    return undefined;
  }
}

export async function set(key: string, status: number, headers: [string, string][], body: string): Promise<void> {
  await getCache().set(key, JSON.stringify({ status, headers, body } satisfies Stored), TTL_SECONDS);
}

/** Test-only: forget everything, so test suites don't leak idempotency state between cases. (Keys are per process and per test run.) */
export function reset(): void {
  void setCache(null);
}
