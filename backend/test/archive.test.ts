// ZIP download: the archive must be a valid ZIP that reproduces every file byte for byte, with the
// exact Content-Length announced up front. Read back here with a small independent ZIP reader.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const files: Record<string, Buffer> = {};

/** Read a ZIP through its central directory (the local headers carry no sizes: they follow the data). */
function readZip(zip: Buffer) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "has an end-of-central-directory record");
  const count = zip.readUInt16LE(end + 10);
  let o = zip.readUInt32LE(end + 16);
  const out: Record<string, { data: Buffer; crcOk: boolean; unixMode: number }> = {};
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(o), 0x02014b50, "central directory entry signature");
    const method = zip.readUInt16LE(o + 10);
    const crc = zip.readUInt32LE(o + 16);
    const size = zip.readUInt32LE(o + 24);
    const nameLen = zip.readUInt16LE(o + 28), extraLen = zip.readUInt16LE(o + 30), commentLen = zip.readUInt16LE(o + 32);
    const attrs = zip.readUInt32LE(o + 38);
    const local = zip.readUInt32LE(o + 42);
    const name = zip.toString("utf8", o + 46, o + 46 + nameLen);
    assert.equal(method, 0, "stored");
    assert.equal(zip.readUInt32LE(local), 0x04034b50, "local header signature");
    const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(dataStart, dataStart + size);
    assert.equal(zip.readUInt32LE(dataStart + size), 0x08074b50, "data descriptor follows the data");
    assert.equal(zip.readUInt32LE(dataStart + size + 4), crc, "descriptor repeats the CRC");
    out[name] = { data, crcOk: zlib.crc32(data) >>> 0 === crc, unixMode: attrs >>> 16 };
    o += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function download(path: string, who: string | null) {
  const res = await app.request(`/v1${path}`, { headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });
  return { res, body: Buffer.from(await res.arrayBuffer()) };
}

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "ines"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  const made = await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private" }) });
  assert.equal(made.status, 201);
  // Several chunks (the chunker caps one at 512 KB), a tiny file, an empty one and a non-ASCII name.
  files["terrain/basin_dem.tif"] = crypto.randomBytes(1_700_000);
  files["terrain/overview.tif"] = crypto.randomBytes(3000);
  files["model/plan.p01"] = Buffer.from("Plan Title=Calibration run 4\n".repeat(40));
  files["notes/empty.txt"] = Buffer.alloc(0);
  files["notes/réseau.csv"] = Buffer.from("gauge,level\nG3,4.2\n");
  const owner = await ctx.db.get("SELECT id FROM owners WHERE handle = 'rhea'") as { id: number };
  await commitFiles(ctx, await getRepoFor(ctx, "rhea", "basin", owner.id), { branch: "main", author: "rhea", message: "Initial", timestamp: new Date("2026-09-30T10:20:30Z"), changes: files });
});

test("the whole repository downloads as a valid ZIP that reproduces every file exactly", async () => {
  const { res, body } = await download("/repos/rhea/basin/archive/main", "rhea");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.equal(Number(res.headers.get("content-length")), body.length, "the announced length is the real length");
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="basin-[0-9a-f]{7}\.zip"/);

  const zip = readZip(body);
  const root = Object.keys(zip)[0].split("/")[0];
  assert.match(root, /^basin-[0-9a-f]{7}$/);
  assert.deepEqual(Object.keys(zip).map((n) => n.slice(root.length + 1)).sort(), Object.keys(files).sort());
  for (const [path, original] of Object.entries(files)) {
    const entry = zip[`${root}/${path}`];
    assert.ok(entry.data.equals(original), `${path} is byte for byte the same`);
    assert.ok(entry.crcOk, `${path} has a correct CRC`);
    assert.equal(entry.unixMode, 0o100644, "extracts as a normal readable file");
  }
});

test("a folder downloads on its own, rooted at that folder", async () => {
  const { res, body } = await download("/repos/rhea/basin/archive/main?path=terrain", "rhea");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /filename="terrain\.zip"/);
  assert.equal(Number(res.headers.get("content-length")), body.length);
  assert.deepEqual(Object.keys(readZip(body)).sort(), ["terrain/basin_dem.tif", "terrain/overview.tif"]);
});

test("a missing folder, a path trying to leave the repository, and a stranger are all refused", async () => {
  assert.equal((await download("/repos/rhea/basin/archive/main?path=nope", "rhea")).res.status, 404);
  assert.equal((await download("/repos/rhea/basin/archive/main?path=../../etc", "rhea")).res.status, 400);
  assert.equal((await download("/repos/rhea/basin/archive/no-such-branch", "rhea")).res.status, 404);
  assert.equal((await download("/repos/rhea/basin/archive/main", "ines")).res.status, 404, "private: its existence is not revealed");
  assert.equal((await download("/repos/rhea/basin/archive/main", null)).res.status, 404);
});

test("the file list gives every path with its size, for Go to file", async () => {
  const res = await app.request("/v1/repos/rhea/basin/paths/main", { headers: { authorization: `Bearer ${tokens.rhea}` } });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { commit: string; files: { path: string; size: number }[] };
  assert.match(body.commit, /^[0-9a-f]{64}$/);
  assert.deepEqual(body.files.map((f) => [f.path, f.size]).sort(), Object.entries(files).map(([p, b]) => [p, b.length]).sort());
  assert.equal((await app.request("/v1/repos/rhea/basin/paths/main", { headers: { authorization: `Bearer ${tokens.ines}` } })).status, 404);
});
