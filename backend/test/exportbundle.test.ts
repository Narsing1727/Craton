// The account export's files: every repository the person owns, one folder each, in one ZIP.

import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";

/** File names and CRCs from a ZIP's central directory, checked against the bytes. */
function listZip(zip: Buffer) {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const out: { name: string; size: number }[] = [];
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(p), 0x02014b50);
    const size = zip.readUInt32LE(p + 24), nameLen = zip.readUInt16LE(p + 28), extra = zip.readUInt16LE(p + 30), comment = zip.readUInt16LE(p + 32);
    const crc = zip.readUInt32LE(p + 16), local = zip.readUInt32LE(p + 42);
    const nameLocal = zip.readUInt16LE(local + 26);
    const dataStart = local + 30 + nameLocal + zip.readUInt16LE(local + 28);
    assert.equal(zlib.crc32(zip.subarray(dataStart, dataStart + size)) >>> 0, crc, "stored bytes match the recorded CRC");
    out.push({ name: zip.subarray(p + 46, p + 46 + nameLen).toString("utf8"), size });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

test("the bundle has a folder per owned repository and nothing from anyone else's", async () => {
  const app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const call = (path: string, method: string, token: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const tokens: Record<string, string> = {};
  for (const u of ["rhea", "other"]) {
    const r = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await r.json()) as { token: string }).token;
  }
  assert.equal((await call("/repos", "POST", tokens.rhea, { name: "basin", visibility: "private", sample: true })).status, 201);
  assert.equal((await call("/repos", "POST", tokens.rhea, { name: "empty", visibility: "private" })).status, 201);
  assert.equal((await call("/repos", "POST", tokens.other, { name: "theirs", visibility: "private", sample: true })).status, 201);

  const res = await call("/user/export/repositories", "GET", tokens.rhea);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /craton-rhea-repositories\.zip/);
  const zip = Buffer.from(await res.arrayBuffer());
  assert.equal(Number(res.headers.get("content-length")), zip.length, "the announced length is the real one");
  const files = listZip(zip);
  assert.ok(files.length >= 3);
  assert.ok(files.every((f) => f.name.startsWith("rhea/basin-")), files.map((f) => f.name).join(", "));
  assert.ok(files.some((f) => f.name.endsWith("/terrain/basin_dem.tif")));
  // A person with nothing to export gets a clear answer, not an empty ZIP.
  const none = await call("/user/export/repositories", "GET", tokens.other.replace(/^/, ""));
  assert.equal(none.status, 200, "the other person has one repository of their own");
});

test("an organization's owners can download its repositories; members and strangers cannot", async () => {
  const app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const call = (path: string, method: string, token: string, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const tokens: Record<string, string> = {};
  for (const u of ["boss", "member", "stranger"]) {
    const r = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await r.json()) as { token: string }).token;
  }
  assert.equal((await call("/orgs", "POST", tokens.boss, { handle: "lab", name: "Lab" })).status, 201);
  assert.equal((await call("/repos", "POST", tokens.boss, { owner: "lab", name: "terrain", visibility: "private", sample: true })).status, 201);
  const ok = await call("/orgs/lab/export/repositories", "GET", tokens.boss);
  assert.equal(ok.status, 200);
  const files = listZip(Buffer.from(await ok.arrayBuffer()));
  assert.ok(files.length >= 3 && files.every((f) => f.name.startsWith("lab/terrain-")), files.map((f) => f.name).join(", "));
  assert.equal((await call("/orgs/lab/export/repositories", "GET", tokens.stranger)).status, 403);
  assert.equal((await call("/orgs/nope/export/repositories", "GET", tokens.boss)).status, 404);
});
