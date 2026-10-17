// How many chunk puts run at once follows the store: a few against local disk, more against an object store,
// and CRATON_STORE_CONCURRENCY overrides both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import type { ChunkStore } from "../src/storage/chunk-store.ts";
import { config } from "../src/config.ts";
import { storeConcurrency } from "../src/services/chunks.ts";
import type { Ctx } from "../src/services/context.ts";

/** A store that answers each put after a short wait and remembers the most puts it ever had in flight. */
class SlowStore implements ChunkStore {
  inFlight = 0;
  peak = 0;
  private readonly map = new Map<string, Buffer>();
  readonly kind: string;
  constructor(kind: string) {
    this.kind = kind;
  }
  async put(hash: string, stored: Buffer) {
    this.inFlight++;
    this.peak = Math.max(this.peak, this.inFlight);
    await new Promise((r) => setTimeout(r, 15));
    this.map.set(hash, Buffer.from(stored));
    this.inFlight--;
  }
  async get(hash: string) {
    return this.map.get(hash) ?? null;
  }
  async has(hash: string) {
    return this.map.has(hash);
  }
  async delete(hash: string) {
    this.map.delete(hash);
  }
}

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
function frame(data: Buffer) {
  const stored = Buffer.concat([Buffer.from([0]), data]);
  const header = Buffer.alloc(69);
  header.write(sha(data), 0, 64, "latin1");
  header.writeUInt32BE(stored.length - 1, 64);
  header[68] = stored[0];
  return Buffer.concat([header, stored.subarray(1)]);
}

async function peakFor(kind: string, chunks: number) {
  const store = new SlowStore(kind);
  const app = createApp({ db: openDb(":memory:"), store } as Ctx);
  const headers = { "content-type": "application/json" };
  const signup = await app.request("/v1/auth/signup", { method: "POST", headers, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  const token = ((await signup.json()) as { token: string }).token;
  const made = await app.request("/v1/repos", { method: "POST", headers: { ...headers, authorization: `Bearer ${token}` }, body: JSON.stringify({ name: "basin", visibility: "private" }) });
  assert.equal(made.status, 201);
  const parts = Array.from({ length: chunks }, (_, i) => Buffer.from(`station ${i} ${"x".repeat(i % 5)}`));
  const res = await app.request("/v1/repos/rhea/basin/chunks", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: Buffer.concat(parts.map(frame)) });
  assert.equal(res.status, 201);
  assert.equal(((await res.json()) as { stored: number }).stored, chunks);
  return store.peak;
}

test("the automatic count is 8 for local disk and 24 for an object store", () => {
  assert.equal(config.storeConcurrency.override, 0, "unset by default");
  assert.equal(storeConcurrency({ store: { kind: "local-disk" } } as Ctx), 8);
  assert.equal(storeConcurrency({ store: { kind: "memory" } } as Ctx), 8);
  assert.equal(storeConcurrency({ store: { kind: "cloudflare-r2" } } as Ctx), 24);
});

test("the setting wins over the store kind", () => {
  const was = config.storeConcurrency.override;
  try {
    config.storeConcurrency.override = 3;
    assert.equal(storeConcurrency({ store: { kind: "cloudflare-r2" } } as Ctx), 3);
    assert.equal(storeConcurrency({ store: { kind: "local-disk" } } as Ctx), 3);
  } finally {
    config.storeConcurrency.override = was;
  }
});

test("a batch against an object store keeps up to 24 puts in flight, local disk 8", async () => {
  const remote = await peakFor("cloudflare-r2", 80);
  const local = await peakFor("local-disk", 80);
  assert.ok(remote > 8 && remote <= 24, `object store peak ${remote}`);
  assert.ok(local > 1 && local <= 8, `local peak ${local}`);
});
