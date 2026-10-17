// NetCDF classic headers (CDF-1 / CDF-2) and the "NetCDF" step of the validation gate.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { NotNetcdfError, netcdfProblems, readNetcdf } from "../src/checks/netcdf.ts";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";

const NC_DIMENSION = 0x0a;
const NC_VARIABLE = 0x0b;
const NC_ATTRIBUTE = 0x0c;

class W {
  parts: Buffer[] = [];
  u32(v: number) {
    const b = Buffer.alloc(4);
    b.writeUInt32BE(v, 0);
    this.parts.push(b);
  }
  u64(v: number) {
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(v), 0);
    this.parts.push(b);
  }
  name(s: string) {
    const raw = Buffer.from(s, "utf8");
    this.u32(raw.length);
    this.parts.push(raw, Buffer.alloc((4 - (raw.length % 4)) % 4));
  }
  text(s: string) {
    this.u32(2); // NC_CHAR
    const raw = Buffer.from(s, "utf8");
    this.u32(raw.length);
    this.parts.push(raw, Buffer.alloc((4 - (raw.length % 4)) % 4));
  }
  get size() {
    return this.parts.reduce((n, p) => n + p.length, 0);
  }
  bytes() {
    return Buffer.concat(this.parts);
  }
}

type Var = { name: string; dims: number[]; type: number; vsize: number; units?: string };

/** A CDF-1 or CDF-2 file: a header from the grammar, then `dataBytes` of zeroed data (less when `cut`). */
function netcdf(opts: { version?: 1 | 2; dims: [string, number][]; conventions?: string; vars: Var[]; records?: number; cut?: number }): Buffer {
  const version = opts.version ?? 1;
  // Two passes: sizes of the header must be known to place the data.
  const header = (begins: number[]) => {
    const w = new W();
    w.parts.push(Buffer.from([0x43, 0x44, 0x46, version]));
    w.u32(opts.records ?? 0);
    w.u32(NC_DIMENSION);
    w.u32(opts.dims.length);
    for (const [n, l] of opts.dims) {
      w.name(n);
      w.u32(l);
    }
    if (opts.conventions) {
      w.u32(NC_ATTRIBUTE);
      w.u32(1);
      w.name("Conventions");
      w.text(opts.conventions);
    } else {
      w.u32(0);
      w.u32(0);
    }
    w.u32(NC_VARIABLE);
    w.u32(opts.vars.length);
    opts.vars.forEach((v, i) => {
      w.name(v.name);
      w.u32(v.dims.length);
      v.dims.forEach((d) => w.u32(d));
      if (v.units) {
        w.u32(NC_ATTRIBUTE);
        w.u32(1);
        w.name("units");
        w.text(v.units);
      } else {
        w.u32(0);
        w.u32(0);
      }
      w.u32(v.type);
      w.u32(v.vsize);
      if (version === 2) w.u64(begins[i]);
      else w.u32(begins[i]);
    });
    return w;
  };
  const probe = header(opts.vars.map(() => 0));
  let at = probe.size;
  const begins = opts.vars.map((v) => {
    const b = at;
    at += v.vsize;
    return b;
  });
  const h = header(begins).bytes();
  const data = Buffer.alloc(at - h.length - (opts.cut ?? 0));
  return Buffer.concat([h, data]);
}

const reader = (b: Buffer) => async (offset: number, length: number) => b.subarray(offset, Math.min(b.length, offset + length));
const read = (b: Buffer) => readNetcdf(reader(b), b.length);

test("dimensions, variables, units and the Conventions attribute are read from a classic header", async () => {
  const b = netcdf({
    dims: [["time", 0], ["lat", 4], ["lon", 6]],
    conventions: "CF-1.6",
    records: 1,
    vars: [
      { name: "lat", dims: [1], type: 5, vsize: 16, units: "degrees_north" },
      { name: "precip", dims: [0, 1, 2], type: 5, vsize: 96, units: "mm" },
    ],
  });
  const i = await read(b);
  assert.equal(i.format, "CDF-1");
  assert.equal(i.records, 1);
  assert.deepEqual(i.dimensions, [{ name: "time", length: null }, { name: "lat", length: 4 }, { name: "lon", length: 6 }]);
  assert.equal(i.conventions, "CF-1.6");
  assert.deepEqual(i.variables.map((v) => [v.name, v.type, v.dimensions.join(",")]), [["lat", "float", "lat"], ["precip", "float", "time,lat,lon"]]);
  assert.equal(i.variables[1].attributes[0].value, "mm");
  assert.deepEqual(netcdfProblems(i, b.length), []);
});

test("the 64-bit offset variant is read, and a file cut short is named with where the data should end", async () => {
  const full = netcdf({ version: 2, dims: [["x", 100]], vars: [{ name: "v", dims: [0], type: 6, vsize: 800 }] });
  assert.equal((await read(full)).format, "CDF-2");
  const cut = netcdf({ version: 2, dims: [["x", 100]], vars: [{ name: "v", dims: [0], type: 6, vsize: 800 }], cut: 300 });
  const problems = netcdfProblems(await read(cut), cut.length);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^truncated: the header puts the end of the data at byte \d/);
});

test("NetCDF-4 (HDF5), CDF-5 and non-NetCDF bytes are recognised or refused, never mis-read", async () => {
  await assert.rejects(read(Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])), /HDF5/);
  await assert.rejects(read(Buffer.from([0x43, 0x44, 0x46, 5, 0, 0, 0, 0, 0, 0, 0, 0])), /CDF-5/);
  await assert.rejects(read(Buffer.from("just some text, not a data file at all")), NotNetcdfError);
  // A header that claims more than there is must not read past the end.
  const bad = netcdf({ dims: [["x", 3]], vars: [{ name: "v", dims: [0], type: 5, vsize: 12 }] }).subarray(0, 40);
  await assert.rejects(read(bad), /longer than the part read|Expected/);
});

// ── the gate ────────────────────────────────────────────────────────────────

let app: ReturnType<typeof createApp>;
let token = "";
const call = (method: string, p: string, body?: unknown) =>
  app.request(`/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
const put = async (name: string, data: Buffer) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name.split("/").pop()!));
  form.append("paths", JSON.stringify([name]));
  form.append("branch", "main");
  return app.request("/v1/repos/rhea/grids/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
};
const step = async () => {
  const runs = (await (await call("GET", "/repos/rhea/grids/checks")).json()) as { steps: { name: string; status: string; detail: string; files?: string[] }[] }[];
  return runs[0].steps.find((s) => s.name === "NetCDF")!;
};

before(async () => {
  app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "grids", visibility: "private" })).status, 201);
});

test("the gate fails a cut-off NetCDF file, says when conventions are missing, and counts NetCDF-4 as not read", async () => {
  const vars = [{ name: "v", dims: [0], type: 6, vsize: 800 }];
  assert.equal((await put("out/a.nc", netcdf({ dims: [["x", 100]], vars }))).status, 201);
  let s = await step();
  assert.equal(s.status, "passed");
  assert.match(s.detail, /1 name no Conventions attribute|1 names no Conventions attribute/);

  assert.equal((await put("out/b.nc", netcdf({ dims: [["x", 100]], vars, cut: 200 }))).status, 201);
  s = await step();
  assert.equal(s.status, "failed");
  assert.match(s.files!.join("|"), /out\/b\.nc: truncated/);

  assert.equal((await put("out/b.nc", netcdf({ dims: [["x", 100]], vars, conventions: "CF-1.8" }))).status, 201);
  assert.equal((await put("out/c.nc", Buffer.concat([Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]))).status, 201);
  s = await step();
  assert.equal(s.status, "passed");
  assert.match(s.detail, /1 NetCDF-4\/HDF5 file was not read/);
});

test("the encoding hint follows the element type of the largest variable (NetCDF data is big endian)", async () => {
  const { netcdfHint } = await import("../src/checks/netcdf.ts");
  const shorts = netcdf({ dims: [["x", 1000]], vars: [{ name: "small", dims: [0], type: 5, vsize: 40 }, { name: "big", dims: [0], type: 3, vsize: 2000 }] });
  assert.deepEqual(netcdfHint(shorts), { kind: "numeric", width: 2, bigEndian: true });
  const doubles = netcdf({ dims: [["x", 1000]], vars: [{ name: "d", dims: [0], type: 6, vsize: 8000 }] });
  assert.deepEqual(netcdfHint(doubles), { kind: "numeric", width: 8, bigEndian: true });
  const bytes = netcdf({ dims: [["x", 1000]], vars: [{ name: "b", dims: [0], type: 1, vsize: 1000 }] });
  assert.equal(netcdfHint(bytes), null);
  assert.equal(netcdfHint(Buffer.from("not netcdf")), null);
});
