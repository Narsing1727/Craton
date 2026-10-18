// The Cloud-optimized GeoTIFF step of the validation gate: advisory by default, blocking when the repository asks.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";

const api = (method: string, path: string, body?: unknown) =>
  app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });

/** A little-endian TIFF with one strip of float samples (no tiles, no overviews: an ordinary striped GeoTIFF). */
function stripedTiff(width: number, rows: number): Buffer {
  const tags: [number, number, number][] = [[256, 4, width], [257, 4, rows], [258, 3, 32], [259, 3, 1], [262, 3, 1], [277, 3, 1], [278, 4, rows], [339, 3, 3]];
  const dirSize = 2 + (tags.length + 2) * 12 + 4;
  const dataOffset = 8 + dirSize;
  const data = Buffer.alloc(width * rows * 4);
  for (let i = 0; i < width * rows; i++) data.writeFloatLE(100 + (i % 977) * 0.01, i * 4);
  const all = [...tags, [273, 4, dataOffset] as [number, number, number], [279, 4, data.length] as [number, number, number]].sort((a, b) => a[0] - b[0]);
  const head = Buffer.alloc(dataOffset);
  head.write("II", 0, "latin1");
  head.writeUInt16LE(42, 2);
  head.writeUInt32LE(8, 4);
  head.writeUInt16LE(all.length, 8);
  all.forEach(([tag, type, value], i) => {
    const o = 10 + i * 12;
    head.writeUInt16LE(tag, o);
    head.writeUInt16LE(type, o + 2);
    head.writeUInt32LE(1, o + 4);
    if (type === 3) head.writeUInt16LE(value, o + 8);
    else head.writeUInt32LE(value, o + 8);
  });
  return Buffer.concat([head, data]);
}

async function upload(repo: string, name: string, data: Buffer, branch: string, extra: Record<string, string> = {}) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name.split("/").pop()!));
  form.append("paths", JSON.stringify([name]));
  form.append("branch", branch);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
  return app.request(`/v1/repos/${repo}/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
}

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await api("POST", "/repos", { name: "dems", visibility: "private" })).status, 201);
});

const cogStep = async (n = 0) => {
  const runs = (await (await api("GET", "/repos/rhea/dems/checks")).json()) as { steps: { name: string; status: string; detail: string; files?: string[] }[] }[];
  return runs[n].steps.find((s) => s.name === "Cloud-optimized GeoTIFF");
};

test("a striped raster is reported as advisory by default, with what to do about it", async () => {
  const res = await upload("rhea/dems", "terrain/dem.tif", stripedTiff(256, 600), "main");
  assert.equal(res.status, 201);
  const step = await cogStep();
  assert.ok(step, "the step is in the run");
  assert.equal(step!.status, "passed");
  assert.match(step!.detail, /^Advisory: 0 of 1 rasters are Cloud Optimized GeoTIFFs/);
  assert.match(step!.detail, /gdal_translate -of COG/);
  assert.match(step!.files![0], /terrain\/dem\.tif: stored in strips, not tiles; 256×600 pixels with no overviews/);
});

test("when the repository requires COGs, the same raster fails the gate", async () => {
  const patch = await api("PATCH", "/repos/rhea/dems", { requireCog: true });
  assert.equal(patch.status, 200);
  assert.equal(((await patch.json()) as { requireCog: boolean }).requireCog, true);
  const res = await upload("rhea/dems", "terrain/dem2.tif", stripedTiff(256, 600), "main");
  assert.equal(res.status, 201);
  const step = await cogStep();
  assert.equal(step!.status, "failed");
  assert.match(step!.detail, /requires them/);
  const runs = (await (await api("GET", "/repos/rhea/dems/checks")).json()) as { status: string }[];
  assert.equal(runs[0].status, "failed", "a failing step fails the run, which is what blocks a merge");
});

test("a repository without rasters skips the step", async () => {
  assert.equal((await api("POST", "/repos", { name: "tables", visibility: "private" })).status, 201);
  const res = await upload("rhea/tables", "gauges.csv", Buffer.from("a,b\n1,2\n"), "main");
  assert.equal(res.status, 201);
  const runs = (await (await api("GET", "/repos/rhea/tables/checks")).json()) as { steps: { name: string; status: string }[] }[];
  assert.equal(runs[0].steps.find((s) => s.name === "Cloud-optimized GeoTIFF")?.status, "skipped");
});

test("a SWMM model with a conduit to a node that is not defined fails the gate, and a sound one passes", async () => {
  assert.equal((await api("POST", "/repos", { name: "storm", visibility: "private" })).status, 201);
  const nl = String.fromCharCode(10);
  const model = (to: string) =>
    ["[JUNCTIONS]", "J1 100 5 0 0 0", "[OUTFALLS]", "O1 96 FREE NO", "[CONDUITS]", `C1 J1 ${to} 300 0.013 0 0 0 0`, ""].join(nl);
  const bad = await upload("rhea/storm", "model/net.inp", Buffer.from(model("Nowhere")), "main");
  assert.equal(bad.status, 201);
  const failing = ((await (await api("GET", "/repos/rhea/storm/checks")).json()) as { steps: { name: string; status: string; files?: string[] }[] }[])[0].steps.find((s) => s.name === "SWMM model");
  assert.equal(failing?.status, "failed");
  assert.match(failing!.files![0], /model\/net\.inp: Conduit C1 uses node Nowhere, which is not defined/);
  const good = await upload("rhea/storm", "model/net.inp", Buffer.from(model("O1")), "main");
  assert.equal(good.status, 201);
  const passing = ((await (await api("GET", "/repos/rhea/storm/checks")).json()) as { steps: { name: string; status: string }[] }[])[0].steps.find((s) => s.name === "SWMM model");
  assert.equal(passing?.status, "passed");
});

test("an EPANET .inp is not mistaken for a SWMM model", async () => {
  const nl = String.fromCharCode(10);
  const epanet = ["[JUNCTIONS]", "N1 10 5", "[RESERVOIRS]", "R1 50", "[PIPES]", "P1 R1 N1 1000 300 100 0 Open", ""].join(nl);
  // The same path the SWMM model was at: the tree now holds an EPANET network there instead.
  assert.equal((await upload("rhea/storm", "model/net.inp", Buffer.from(epanet), "main")).status, 201);
  const step = ((await (await api("GET", "/repos/rhea/storm/checks")).json()) as { steps: { name: string; status: string }[] }[])[0].steps.find((s) => s.name === "SWMM model");
  assert.equal(step?.status, "skipped");
});
