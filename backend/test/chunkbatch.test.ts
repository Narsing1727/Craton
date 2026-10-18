// Many chunks in one request: stored like single uploads, verified like single uploads, and visible to the same checks.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { compressChunk, shuffle } from "../src/core/compress.ts";
import zlib from "node:zlib";
import type { Ctx } from "../src/services/context.ts";

let app: ReturnType<typeof createApp>;
let token = "";

const call = (method: string, path: string, body?: string | Uint8Array | null, headers: Record<string, string> = {}) =>
  app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...headers }, body });

const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
/** One frame: hash, payload length, encoding byte, payload. `stored` is a chunk as the CLI encodes it (first byte = encoding). */
function frameStored(hash: string, stored: Buffer) {
  const header = Buffer.alloc(69);
  header.write(hash, 0, 64, "latin1");
  header.writeUInt32BE(stored.length - 1, 64);
  header[68] = stored[0];
  return Buffer.concat([header, stored.subarray(1)]);
}
/** A raw (encoding 0) frame, as before. */
function frame(hash: string, data: Buffer) {
  return frameStored(hash, Buffer.concat([Buffer.from([0]), data]));
}
const sample = (n: number) => Array.from({ length: n }, (_, i) => Buffer.from(`station ${i} reading ${"x".repeat(i % 7)}`));

before(async () => {
  app = createApp({ db: await openDb(":memory:"), store: new MemoryStore() } as Ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  const made = await call("POST", "/repos", JSON.stringify({ name: "basin", visibility: "private" }), { "content-type": "application/json" });
  assert.equal(made.status, 201);
});

test("a batch stores every chunk, none is missing afterwards, and sending it again is harmless", async () => {
  const parts = sample(40);
  const body = Buffer.concat(parts.map((d) => frame(sha(d), d)));
  const res = await call("POST", "/repos/rhea/basin/chunks", body, { "content-type": "application/octet-stream" });
  assert.equal(res.status, 201);
  const out = (await res.json()) as { stored: number; chunks: { hash: string; size: number }[] };
  assert.equal(out.stored, 40);
  assert.deepEqual(out.chunks.map((c) => c.hash), parts.map(sha));
  const missing = await call("POST", "/repos/rhea/basin/chunks/missing", JSON.stringify({ hashes: parts.map(sha) }), { "content-type": "application/json" });
  assert.deepEqual(((await missing.json()) as { missing: string[] }).missing, []);
  // Sending the same batch again is harmless and says the bytes were already there.
  const again = await call("POST", "/repos/rhea/basin/chunks", body, { "content-type": "application/octet-stream" });
  assert.equal(again.status, 201);
  assert.ok(((await again.json()) as { chunks: { deduplicated: boolean }[] }).chunks.every((c) => c.deduplicated));
});

test("bytes that do not match their hash are refused, and so are truncated frames", async () => {
  const good = Buffer.from("fine");
  const bad = Buffer.from("not what was promised");
  const wrongHash = await call("POST", "/repos/rhea/basin/chunks", Buffer.concat([frame(sha(good), good), frame(sha(Buffer.from("something else")), bad)]), { "content-type": "application/octet-stream" });
  assert.equal(wrongHash.status, 400);
  const cut = frame(sha(good), good).subarray(0, 71);
  assert.equal((await call("POST", "/repos/rhea/basin/chunks", cut, { "content-type": "application/octet-stream" })).status, 400);
  assert.equal((await call("POST", "/repos/rhea/basin/chunks", Buffer.from("short"), { "content-type": "application/octet-stream" })).status, 400);
});

test("an empty batch is fine, and a stranger cannot upload into a repository", async () => {
  const empty = await call("POST", "/repos/rhea/basin/chunks", Buffer.alloc(0), { "content-type": "application/octet-stream" });
  assert.equal(empty.status, 201);
  assert.equal(((await empty.json()) as { stored: number }).stored, 0);
  const d = Buffer.from("anonymous");
  const anon = await app.request("/v1/repos/rhea/basin/chunks", { method: "POST", body: frame(sha(d), d), headers: { "content-type": "application/octet-stream" } });
  assert.ok([401, 403, 404].includes(anon.status), `anonymous upload -> ${anon.status}`);
});

test("more than the per-request count is refused", async () => {
  const parts = sample(1001).map((d, i) => Buffer.concat([d, Buffer.from(String(i))]));
  const body = Buffer.concat(parts.map((d) => frame(sha(d), d)));
  const res = await call("POST", "/repos/rhea/basin/chunks", body, { "content-type": "application/octet-stream" });
  assert.equal(res.status, 400);
});

test("a batched download refuses chunks the repository may not reference, and malformed requests", async () => {
  // Chunks only become readable once a committed blob references them, so build one through the real push path.
  const parts = sample(12).map((d, i) => Buffer.concat([d, Buffer.from(`-${i}`)]));
  const hashes = parts.map(sha);
  const up = await call("POST", "/repos/rhea/basin/chunks", Buffer.concat(parts.map((d) => frame(sha(d), d))), { "content-type": "application/octet-stream" });
  assert.equal(up.status, 201);
  // Not referenced yet: refused exactly like a single download.
  const early = await call("POST", "/repos/rhea/basin/chunks/fetch", JSON.stringify({ hashes: [hashes[0]] }), { "content-type": "application/json" });
  assert.equal(early.status, 404);
  // Bad requests.
  assert.equal((await call("POST", "/repos/rhea/basin/chunks/fetch", JSON.stringify({ hashes: [] }), { "content-type": "application/json" })).status, 400);
  assert.equal((await call("POST", "/repos/rhea/basin/chunks/fetch", JSON.stringify({ hashes: [1] }), { "content-type": "application/json" })).status, 400);
});

test("chunks sent already encoded (zstd, byte-shuffled) are verified and stored as they came", async () => {
  // Smooth float32 values: a raster-like chunk where the shuffle helps.
  const floats = Buffer.alloc(64 * 1024);
  for (let i = 0; i < floats.length / 4; i++) floats.writeFloatLE(100 + Math.sin(i / 300) * 5 + i * 0.001, i * 4);
  const text = Buffer.from("station,level" + String.fromCharCode(10) + Array.from({ length: 3000 }, (_, i) => `S${i % 40},${(i * 7) % 100}`).join(String.fromCharCode(10)));
  const items = [
    { data: floats, hint: { kind: "numeric", width: 4 } as const },
    { data: text, hint: { kind: "text" } as const },
    { data: Buffer.from("tiny"), hint: { kind: "auto" } as const },
  ];
  const stored = items.map((i) => compressChunk(i.data, sha(i.data), i.hint));
  assert.match(stored[0].codec, /shuffle4/);
  assert.equal(stored[1].codec, "zstd");
  assert.ok(stored[0].stored.length < floats.length / 2, "the float chunk shrank");
  const res = await call("POST", "/repos/rhea/basin/chunks", Buffer.concat(items.map((i, k) => frameStored(sha(i.data), stored[k].stored))), { "content-type": "application/octet-stream" });
  assert.equal(res.status, 201);
  const out = (await res.json()) as { chunks: { hash: string; size: number }[] };
  assert.deepEqual(out.chunks.map((c) => c.size), items.map((i) => i.data.length));
  const missing = await call("POST", "/repos/rhea/basin/chunks/missing", JSON.stringify({ hashes: items.map((i) => sha(i.data)) }), { "content-type": "application/json" });
  assert.deepEqual(((await missing.json()) as { missing: string[] }).missing, []);
});

test("an encoded chunk that decodes to something else, an unknown encoding and an oversized expansion are refused", async () => {
  const a = Buffer.from("what the hash names ".repeat(50));
  const b = Buffer.from("what was actually inside ".repeat(50));
  const wrong = compressChunk(b, sha(b)).stored; // valid zstd, but of other bytes than the hash names
  assert.equal((await call("POST", "/repos/rhea/basin/chunks", frameStored(sha(a), wrong), { "content-type": "application/octet-stream" })).status, 400);
  const unknown = Buffer.concat([Buffer.from([9]), a]);
  assert.equal((await call("POST", "/repos/rhea/basin/chunks", frameStored(sha(a), unknown), { "content-type": "application/octet-stream" })).status, 400);
  // A small zstd stream that expands far past the chunk limit.
  const bomb = Buffer.concat([Buffer.from([1]), zlib.zstdCompressSync(Buffer.alloc(8 * 1024 * 1024))]);
  assert.ok(bomb.length < 4096);
  assert.equal((await call("POST", "/repos/rhea/basin/chunks", frameStored(sha(a), bomb), { "content-type": "application/octet-stream" })).status, 400);
});

test("shuffle and unshuffle are exact inverses, including a trailing partial element", async () => {
  const { unshuffle } = await import("../src/core/compress.ts");
  for (const width of [2, 4, 8]) {
    for (const len of [0, 1, width - 1, width, width + 1, 1000, 1003]) {
      const buf = Buffer.from(Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255));
      assert.deepEqual(unshuffle(shuffle(buf, width), width), buf, `width ${width} length ${len}`);
    }
  }
});

test("a batch is stored a few chunks at a time: against a slow object store it takes a fraction of one-by-one", async () => {
  class SlowStore extends MemoryStore {
    puts = 0;
    async put(hash: string, stored: Buffer) {
      this.puts++;
      await new Promise((r) => setTimeout(r, 30));
      return super.put(hash, stored);
    }
  }
  const store = new SlowStore();
  const slowApp = await createApp({ db: await openDb(":memory:"), store } as Ctx);
  const signup = await slowApp.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "kai", email: "kai@example.org", password: "a-very-long-password" }) });
  const t = ((await signup.json()) as { token: string }).token;
  const auth = { authorization: `Bearer ${t}` };
  assert.equal((await slowApp.request("/v1/repos", { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ name: "slow", visibility: "private" }) })).status, 201);
  const parts = Array.from({ length: 80 }, (_, i) => Buffer.from(`slow store chunk number ${i} ${"y".repeat(i)}`));
  const body = Buffer.concat(parts.map((d) => frame(sha(d), d)));
  const started = Date.now();
  const res = await slowApp.request("/v1/repos/kai/slow/chunks", { method: "POST", headers: { ...auth, "content-type": "application/octet-stream" }, body });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 201);
  const out = (await res.json()) as { chunks: { hash: string }[] };
  assert.deepEqual(out.chunks.map((c) => c.hash), parts.map(sha), "results keep the order of the frames");
  assert.equal(store.puts, 80);
  assert.ok(elapsed < 80 * 30 * 0.75, `took ${elapsed} ms; one by one would be about ${80 * 30} ms`);
});
