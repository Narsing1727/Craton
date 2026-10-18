// Reading part of a file: HTTP byte ranges on the raw route, and streaming for whole files of any size.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { parseRange } from "../src/core/range.ts";

test("Range headers: the three single-range forms, clipping, and what is ignored or refused", () => {
  assert.deepEqual(parseRange("bytes=0-99", 1000), { start: 0, end: 99 });
  assert.deepEqual(parseRange("bytes=900-", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-100", 1000), { start: 900, end: 999 });
  assert.deepEqual(parseRange("bytes=-5000", 1000), { start: 0, end: 999 }, "a suffix longer than the file is the whole file");
  assert.deepEqual(parseRange("bytes=990-5000", 1000), { start: 990, end: 999 }, "the end is clipped");
  assert.deepEqual(parseRange(" Bytes = 5 - 9 ", 1000), { start: 5, end: 9 });
  assert.equal(parseRange("bytes=1000-", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=2000-3000", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=-0", 1000), "unsatisfiable");
  assert.equal(parseRange("bytes=0-0", 0), "unsatisfiable", "nothing to read in an empty file");
  for (const ignored of [null, undefined, "", "bytes=", "bytes=-", "items=0-5", "bytes=0-5,10-20", "bytes=9-3", "garbage", "bytes=a-b"]) {
    assert.equal(parseRange(ignored as string, 1000), null, String(ignored));
  }
});

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";
const data = crypto.randomBytes(3 * 1024 * 1024 + 12_345); // several chunks (128 KB on average)
const sha = crypto.createHash("sha256").update(data).digest("hex");

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET email_verified_at = ?").run(new Date().toISOString());
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "public" }) })).status, 201);
  const repo = getRepoFor(ctx, "rhea", "basin", null);
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "big file", timestamp: new Date(), changes: { "terrain/big.bin": data, "small.txt": Buffer.from("hello") } });
});

const raw = (path: string, headers: Record<string, string> = {}, method = "GET") => app.request(`/v1/repos/rhea/basin/raw/main/${path}`, { method, headers });

test("a whole file is streamed with its length, checksum and range support advertised", async () => {
  const res = await raw("terrain/big.bin");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-length"), String(data.length));
  assert.equal(res.headers.get("x-craton-sha256"), sha);
  assert.ok(Buffer.from(await res.arrayBuffer()).equals(data), "every byte, in order");
});

test("a range returns exactly those bytes, across chunk boundaries, with the right headers", async () => {
  for (const [start, end] of [[0, 0], [0, 99], [131_000, 262_500], [1_000_000, 1_000_001], [data.length - 10, data.length - 1], [3 * 1024 * 1024, data.length - 1]]) {
    const res = await raw("terrain/big.bin", { range: `bytes=${start}-${end}` });
    assert.equal(res.status, 206, `${start}-${end}`);
    assert.equal(res.headers.get("content-range"), `bytes ${start}-${end}/${data.length}`);
    assert.equal(res.headers.get("content-length"), String(end - start + 1));
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(data.subarray(start, end + 1)), `${start}-${end}`);
  }
  const open = await raw("terrain/big.bin", { range: "bytes=2000000-" });
  assert.equal(open.status, 206);
  assert.ok(Buffer.from(await open.arrayBuffer()).equals(data.subarray(2_000_000)));
  const tail = await raw("terrain/big.bin", { range: "bytes=-1234" });
  assert.equal(tail.headers.get("content-range"), `bytes ${data.length - 1234}-${data.length - 1}/${data.length}`);
  assert.ok(Buffer.from(await tail.arrayBuffer()).equals(data.subarray(data.length - 1234)));
});

test("a range past the end is refused with the size, and a header the server does not support gets the whole file", async () => {
  const past = await raw("terrain/big.bin", { range: `bytes=${data.length}-` });
  assert.equal(past.status, 416);
  assert.equal(past.headers.get("content-range"), `bytes */${data.length}`);
  const multi = await raw("small.txt", { range: "bytes=0-1,3-4" });
  assert.equal(multi.status, 200);
  assert.equal(await multi.text(), "hello");
});

test("HEAD answers the size without the bytes, and a private repository still needs access", async () => {
  const head = await raw("terrain/big.bin", {}, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(data.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  await app.request("/v1/repos/rhea/basin", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ visibility: "private" }) });
  assert.equal((await raw("small.txt", { range: "bytes=0-1" })).status, 404, "a stranger learns nothing, ranges included");
  assert.equal((await app.request("/v1/repos/rhea/basin/raw/main/small.txt", { headers: { authorization: `Bearer ${token}`, range: "bytes=1-3" } })).status, 206);
});
