// GeoParquet CRS from the footer's "geo" metadata, and its place in the coordinate system step of the gate.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { NotParquetError, parseGeoMetadata, readGeoParquet } from "../src/checks/geoparquet.ts";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";

/** A Parquet-shaped file: some page bytes, a footer holding the thrift-ish text with the geo JSON in it, length, PAR1. */
function parquet(geo: object | null): Buffer {
  const json = geo ? JSON.stringify(geo) : "";
  const footer = Buffer.concat([Buffer.from([0x15, 0x04, 0x19, 0x2c]), Buffer.from("schema"), geo ? Buffer.concat([Buffer.from([0x03, 0x67, 0x65, 0x6f]), Buffer.from(json, "utf8")]) : Buffer.alloc(0), Buffer.from([0x00, 0x16])]);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(footer.length, 0);
  return Buffer.concat([Buffer.from("PAR1"), Buffer.alloc(200, 7), footer, len, Buffer.from("PAR1")]);
}
const reader = (b: Buffer) => async (offset: number, length: number) => b.subarray(offset, Math.min(b.length, offset + length));
const read = (b: Buffer) => readGeoParquet(reader(b), b.length);

const utm = { id: { authority: "EPSG", code: 32643 } };

test("a declared EPSG code, the OGC:CRS84 default, an unknown CRS and an OGC:CRS84 id are told apart", async () => {
  const a = await read(parquet({ version: "1.1.0", primary_column: "geometry", columns: { geometry: { encoding: "WKB", geometry_types: ["Polygon"], crs: utm, bbox: [75, 10, 76, 11] } } }));
  assert.deepEqual(a?.columns[0], { name: "geometry", encoding: "WKB", geometryTypes: ["Polygon"], epsg: 32643, crsState: "declared", bbox: [75, 10, 76, 11] });
  const none = await read(parquet({ version: "1.0.0", primary_column: "geom", columns: { geom: { encoding: "WKB", geometry_types: [] } } }));
  assert.equal(none?.columns[0].epsg, 4326);
  assert.equal(none?.columns[0].crsState, "default");
  const unknown = await read(parquet({ version: "1.0.0", primary_column: "geom", columns: { geom: { encoding: "WKB", geometry_types: [], crs: null } } }));
  assert.equal(unknown?.columns[0].epsg, null);
  assert.equal(unknown?.columns[0].crsState, "unknown");
  const ogc = await read(parquet({ version: "1.0.0", primary_column: "g", columns: { g: { encoding: "WKB", geometry_types: [], crs: { id: { authority: "OGC", code: "CRS84" } } } } }));
  assert.equal(ogc?.columns[0].epsg, 4326);
});

test("keys in any order, braces and quotes inside strings, and several geometry columns", async () => {
  const geo = { columns: { a: { geometry_types: ["Point"], crs: utm, encoding: "WKB", note: "has } and { and \" inside" }, b: { encoding: "point", geometry_types: [], crs: null } }, primary_column: "a", version: "1.1.0" };
  const info = await read(parquet(geo));
  assert.equal(info?.primary, "a");
  assert.deepEqual(info?.columns.map((c) => [c.name, c.epsg]), [["a", 32643], ["b", null]]);
});

test("a plain Parquet table is not GeoParquet, and a file that is not Parquet is refused", async () => {
  assert.equal(await read(parquet(null)), null);
  await assert.rejects(read(Buffer.from("definitely not a parquet file, only text")), NotParquetError);
  assert.equal(parseGeoMetadata("no geo metadata here"), null);
});

let app: ReturnType<typeof createApp>;
let token = "";
const call = (method: string, p: string, body?: unknown) =>
  app.request(`/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
before(async () => {
  app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "tables", visibility: "private" })).status, 201);
});

test("a GeoParquet column in another CRS fails the coordinate system step; a plain table is ignored", async () => {
  const put = async (name: string, data: Buffer) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(data)], name.split("/").pop()!));
    form.append("paths", JSON.stringify([name]));
    form.append("branch", "main");
    return app.request("/v1/repos/rhea/tables/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  };
  assert.equal((await put("data/plain.parquet", parquet(null))).status, 201);
  assert.equal((await put("data/wells.parquet", parquet({ version: "1.1.0", primary_column: "geometry", columns: { geometry: { encoding: "WKB", geometry_types: ["Point"], crs: { id: { authority: "EPSG", code: 4269 } } } } }))).status, 201);
  const runs = (await (await call("GET", "/repos/rhea/tables/checks")).json()) as { steps: { name: string; status: string; files?: string[] }[] }[];
  const crs = runs[0].steps.find((s) => s.name === "Coordinate reference system")!;
  assert.equal(crs.status, "failed");
  assert.deepEqual(crs.files, ["data/wells.parquet, column geometry (EPSG:4269)"]);
});
