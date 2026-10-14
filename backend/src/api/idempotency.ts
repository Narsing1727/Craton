// Idempotency keys (Stripe's model: https://docs.stripe.com/api/idempotent_requests). A client
// sends `Idempotency-Key: <uuid>` on a mutating request; a retry with the same key from the same
// actor gets back the exact first response — status and body, even an error — instead of the
// request being applied twice. Protects against double stars, double comments, double commits:
// anywhere a connection can drop right as the server finishes but before the client sees it.
//
// Opt-in: a request without the header behaves exactly as before. Scoped per actor (token or IP)
// + method + path, so a key can't collide across unrelated endpoints by accident.
//
// In memory, like the rate limiter (limits.ts); a multi-instance deployment should move this to
// Redis or a table, so a retry that lands on a different instance still sees the first result.

type Stored = { status: number; headers: [string, string][]; body: string; at: number };

const store = new Map<string, Stored>();
const TTL_MS = 24 * 60 * 60_000; // Stripe keeps keys 24h; we match that.

export function keyFor(actor: string, method: string, path: string, idemKey: string): string {
  return `${actor}|${method}|${path}|${idemKey}`;
}

export function get(key: string): Stored | undefined {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return undefined;
  }
  return hit;
}

export function set(key: string, status: number, headers: [string, string][], body: string): void {
  store.set(key, { status, headers, body, at: Date.now() });
}

/** Test-only: forget everything, so test suites don't leak idempotency state between cases. */
export function reset(): void {
  store.clear();
}

setInterval(() => {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of store) if (v.at < cutoff) store.delete(k);
}, 15 * 60_000).unref();
