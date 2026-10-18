// LAS point cloud headers and the "Point clouds" step of the validation gate.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { lasProblems, readLasHeader } from "../src/checks/las.ts";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

type Opts = { version?: [number, number]; points?: number; format?: number; recordLength?: number; epsg?: number; wkt?: string; truncateBy?: number; laz?: boolean };

/** A LAS file: public header, optional GeoKey or WKT VLR, then `points` zeroed point records. */
function las(o: Opts = {}): Buffer {
  const [major, minor] = o.version ?? [1, 2];
  const headerSize = major === 1 && minor >= 4 ? 375 : minor === 3 ? 235 : 227;
  const vlrs: Buffer[] = [];
  const vlr = (userId: string, recordId: number, body: Buffer) => {
    const h = Buffer.alloc(54);
    h.write(userId, 2, "latin1");
    h.writeUInt16LE(recordId, 18);
    h.writeUInt16LE(body.length, 20);
    vlrs.push(Buffer.concat([h, body]));
  };
  if (o.epsg !== undefined) {
    const body = Buffer.alloc(8 + 8);
    body.writeUInt16LE(1, 0);
    body.writeUInt16LE(1, 2);
    body.writeUInt16LE(0, 4);
    body.writeUInt16LE(1, 6);
    body.writeUInt16LE(3072, 8); // ProjectedCSTypeGeoKey
    body.writeUInt16LE(0, 10);
    body.writeUInt16LE(1, 12);
    body.writeUInt16LE(o.epsg, 14);
    vlr("LASF_Projection", 34735, body);
  }
  if (o.wkt) vlr("LASF_Projection", 2112, Buffer.from(o.wkt + "\0"));
  const vlrBytes = Buffer.concat(vlrs);
  const points = o.points ?? 10;
  const recordLength = o.recordLength ?? 20;
  const offsetToPoints = headerSize + vlrBytes.length;
  const h = Buffer.alloc(headerSize);
  h.write("LASF", 0, "latin1");
  h[24] = major;
  h[25] = minor;
  h.write("Craton test", 58, "latin1");
  h.writeUInt16LE(headerSize, 94);
  h.writeUInt32LE(offsetToPoints, 96);
  h.writeUInt32LE(vlrs.length, 100);
  h[104] = (o.format ?? 1) | (o.laz ? 0x80 : 0);
  h.writeUInt16LE(recordLength, 105);
  h.writeUInt32LE(headerSize === 375 ? 0 : points, 107);
  [0.01, 0.01, 0.001].forEach((v, i) => h.writeDoubleLE(v, 131 + i * 8));
  [500000, 4000000, 0].forEach((v, i) => h.writeDoubleLE(v, 155 + i * 8));
  // max then min per axis
  [[500100, 500000], [4000100, 4000000], [120.5, 100.25]].forEach(([mx, mn], i) => {
    h.writeDoubleLE(mx, 179 + i * 16);
    h.writeDoubleLE(mn, 187 + i * 16);
  });
  if (headerSize === 375) h.writeBigUInt64LE(BigInt(points), 247);
  const body = Buffer.alloc(points * recordLength - (o.truncateBy ?? 0));
  return Buffer.concat([h, vlrBytes, body]);
}
const reader = (b: Buffer) => async (offset: number, length: number) => b.subarray(offset, Math.min(b.length, offset + length));
const info = (b: Buffer) => readLasHeader(reader(b), b.length);

test("a LAS 1.2 header gives version, format, count, scale, bounds and the expected size", async () => {
  const b = las({ points: 1000, recordLength: 28, format: 1 });
  const i = await info(b);
  assert.equal(i.version, "1.2");
  assert.equal(i.pointFormat, 1);
  assert.equal(i.pointCount, 1000);
  assert.deepEqual(i.scale, [0.01, 0.01, 0.001]);
  assert.deepEqual(i.min, [500000, 4000000, 100.25]);
  assert.deepEqual(i.max, [500100, 4000100, 120.5]);
  assert.equal(i.expectedSize, b.length);
  assert.equal(i.generatingSoftware, "Craton test");
  assert.deepEqual(lasProblems(i, b.length), []);
});

test("a LAS 1.4 header uses the 64-bit point count", async () => {
  const i = await info(las({ version: [1, 4], points: 5000, format: 6, recordLength: 30 }));
  assert.equal(i.version, "1.4");
  assert.equal(i.pointCount, 5000);
  assert.equal(i.pointFormat, 6);
});

test("the CRS comes from a GeoKey record or from WKT", async () => {
  assert.equal((await info(las({ epsg: 32643 }))).epsg, 32643);
  const wkt = 'PROJCS["WGS 84 / UTM zone 43N",GEOGCS["WGS 84",AUTHORITY["EPSG","4326"]],AUTHORITY["EPSG","32643"]]';
  const w = await info(las({ wkt }));
  assert.equal(w.epsg, 32643);
  assert.match(w.wkt!, /UTM zone 43N/);
  assert.equal((await info(las())).epsg, null);
});

test("a cut-off file is reported with what the header promised; LAZ is not judged by size", async () => {
  const cut = las({ points: 100, recordLength: 20, truncateBy: 400 });
  const i = await info(cut);
  const problems = lasProblems(i, cut.length);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /truncated: the header declares 100 points/);
  const laz = await info(las({ points: 100, laz: true, truncateBy: 1500 }));
  assert.equal(laz.compressed, true);
  assert.equal(laz.expectedSize, null);
  assert.deepEqual(lasProblems(laz, 1000), []);
});

test("something that is not LAS is refused", async () => {
  await assert.rejects(info(Buffer.from("this is not a point cloud, just text. ".repeat(10))), /Not a LAS file/);
});

// ── the gate ────────────────────────────────────────────────────────────────

let app: ReturnType<typeof createApp>;
let token = "";
const api = (method: string, path: string, body?: unknown) =>
  app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
async function upload(repo: string, name: string, data: Buffer) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name.split("/").pop()!));
  form.append("paths", JSON.stringify([name]));
  form.append("branch", "main");
  return app.request(`/v1/repos/${repo}/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
}
const step = async (repo: string) => {
  const runs = (await (await api("GET", `/repos/${repo}/checks`)).json()) as { steps: { name: string; status: string; detail: string; files?: string[] }[] }[];
  return runs[0].steps.find((s) => s.name === "Point clouds")!;
};

before(async () => {
  const ctx: Ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await api("POST", "/repos", { name: "lidar", visibility: "private" })).status, 201);
});

test("the gate says what a point cloud lacks, fails a wrong CRS and a cut-off file, and passes a sound one", async () => {
  // Repositories default to EPSG:32643.
  assert.equal((await upload("rhea/lidar", "pts/a.las", las({ points: 50 }))).status, 201);
  let s = await step("rhea/lidar");
  assert.equal(s.status, "passed");
  assert.match(s.detail, /declares? no CRS/);

  assert.equal((await upload("rhea/lidar", "pts/b.las", las({ points: 50, epsg: 32644 }))).status, 201);
  s = await step("rhea/lidar");
  assert.equal(s.status, "failed");
  assert.match(s.files!.join("|"), /pts\/b\.las: declares EPSG:32644, not EPSG:32643/);

  assert.equal((await upload("rhea/lidar", "pts/b.las", las({ points: 50, epsg: 32643 }))).status, 201);
  assert.equal((await upload("rhea/lidar", "pts/c.las", las({ points: 100, truncateBy: 200 }))).status, 201);
  s = await step("rhea/lidar");
  assert.equal(s.status, "failed");
  assert.match(s.files!.join("|"), /pts\/c\.las: truncated/);

  assert.equal((await upload("rhea/lidar", "pts/c.las", las({ points: 100, epsg: 32643 }))).status, 201);
  s = await step("rhea/lidar");
  assert.equal(s.status, "passed");
});

test("the line diff between two versions of a point cloud describes what its header says changed", async () => {
  assert.equal((await upload("rhea/lidar", "pts/d.las", las({ points: 50 }))).status, 201);
  assert.equal((await upload("rhea/lidar", "pts/d.las", las({ points: 80, epsg: 32643 }))).status, 201);
  const commits = (await (await api("GET", "/repos/rhea/lidar/commits")).json()) as { sha?: string; id?: string }[];
  const head = commits[0].sha ?? commits[0].id;
  const base = commits[1].sha ?? commits[1].id;
  const res = await api("GET", `/repos/rhea/lidar/text-diff/${head}/pts/d.las?base=${base}`);
  assert.equal(res.status, 200);
  const d = (await res.json()) as { added: number; removed: number; hunks: { lines: { t: string; text: string }[] }[] };
  const lines = d.hunks.flatMap((h) => h.lines).filter((l) => l.t !== " ").map((l) => `${l.t}${l.text}`);
  assert.deepEqual(lines, ["-points: 50", "-crs: not declared", "+points: 80", "+crs: EPSG:32643"]);
});
