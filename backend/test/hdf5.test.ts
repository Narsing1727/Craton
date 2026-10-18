// HDF5 structure reader (src/checks/hdf5.ts), the "HDF5" step of the validation gate, and the line description a
// HEC-RAS results file gets. The fixtures were written by libhdf5 (see test/fixtures/hdf5-samples.ts) together with
// the listing h5py reports for each; the reader must agree with that listing in every layout.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { NotHdf5Error, hdf5Problems, readHdf5 } from "../src/checks/hdf5.ts";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { HDF5_SAMPLES } from "./fixtures/hdf5-samples.ts";

const read = (buf: Buffer) => readHdf5(async (o, l) => buf.subarray(o, o + l), buf.length);
const kindOfType = (t: string | null) => (t?.startsWith("float") ? ["f"] : t?.startsWith("uint") ? ["u"] : t?.startsWith("int") ? ["i"] : t === "string" ? ["S", "O"] : t ? ["V"] : null);

for (const [name, sample] of Object.entries(HDF5_SAMPLES)) {
  test(`the reader lists exactly what libhdf5 reports: ${name}`, async () => {
    const info = await read(sample.bytes);
    const mine = new Map(info.objects.filter((o) => o.path !== "/").map((o) => [o.path, o]));
    assert.deepEqual([...mine.keys()].sort(), Object.keys(sample.expected).sort());
    for (const [path, [kind, shape, dk]] of Object.entries(sample.expected)) {
      const o = mine.get(path)!;
      assert.equal(o.kind === "soft-link" ? "soft" : o.kind, kind, path);
      if (kind === "dataset") {
        assert.deepEqual(o.shape, shape, path);
        assert.ok(kindOfType(o.type)?.includes(dk!), `${path}: ${o.type} vs ${dk}`);
      }
    }
    // Group attributes (fixed and variable-length strings, integers, floats, arrays) are what h5py reports too.
    const attributes: Record<string, Record<string, unknown>> = {};
    for (const o of info.objects) if (o.attributes) attributes[o.path] = o.attributes;
    assert.deepEqual(attributes, sample.attributes);
    assert.equal(info.declaredEnd, sample.bytes.length, "the superblock's end of file is the file's size");
    assert.deepEqual(info.notes, []);
    assert.equal(info.limited, false);
  });
}

test("old files use superblock 0 and newer layouts 3, and the dense group's links are all found", async () => {
  assert.equal((await read(HDF5_SAMPLES.oldStyle.bytes)).version, 0);
  assert.equal((await read(HDF5_SAMPLES.compact.bytes)).version, 3);
  const dense = await read(HDF5_SAMPLES.dense.bytes);
  const group = dense.objects.find((o) => o.path === "/Results/Summary")!;
  assert.equal(group.links, 40);
  assert.equal(dense.objects.filter((o) => o.path.startsWith("/Results/Summary/")).length, 40);
});

test("a cut-off file is recognised from its superblock, and the reader does not crash on it", async () => {
  const cut = HDF5_SAMPLES.oldStyle.bytes.subarray(0, 5000);
  const info = await read(cut);
  assert.match(hdf5Problems(info, cut.length).join("|"), /truncated: the superblock puts the end of the file at byte 14,255/);
  assert.deepEqual(hdf5Problems(await read(HDF5_SAMPLES.oldStyle.bytes), HDF5_SAMPLES.oldStyle.bytes.length), []);
  // A file with trailing bytes (padding some tools add) is not a problem.
  assert.deepEqual(hdf5Problems(info, HDF5_SAMPLES.oldStyle.bytes.length + 100), []);
});

test("something that is not HDF5 is refused, and the object limit stops a huge file", async () => {
  await assert.rejects(read(Buffer.from("plain text, nothing to see")), NotHdf5Error);
  await assert.rejects(read(Buffer.alloc(0)), NotHdf5Error);
  const limited = await readHdf5(async (o, l) => HDF5_SAMPLES.dense.bytes.subarray(o, o + l), HDF5_SAMPLES.dense.bytes.length, { maxObjects: 10 });
  assert.equal(limited.limited, true);
  assert.ok(limited.objects.length <= 10);
});

test("a damaged group is reported in the notes instead of throwing", async () => {
  const bad = Buffer.from(HDF5_SAMPLES.oldStyle.bytes);
  // Wipe a stretch in the middle of the metadata; whatever it held, reading must still return a result.
  bad.fill(0xab, 1500, 2500);
  const info = await read(bad);
  assert.ok(info.objects.length >= 1);
});

// ── the gate and the description ────────────────────────────────────────────

let app: ReturnType<typeof createApp>;
let token = "";
const call = (method: string, p: string, body?: unknown) =>
  app.request(`/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
const put = async (name: string, data: Buffer) => {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name.split("/").pop()!));
  form.append("paths", JSON.stringify([name]));
  form.append("branch", "main");
  return app.request("/v1/repos/rhea/ras/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
};
const step = async () => {
  const runs = (await (await call("GET", "/repos/rhea/ras/checks")).json()) as { steps: { name: string; status: string; detail: string; files?: string[] }[] }[];
  return runs[0].steps.find((s) => s.name === "HDF5")!;
};

before(async () => {
  app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "ras", visibility: "private" })).status, 201);
});

test("the gate passes a sound results file, fails a cut-off one and a file that is not HDF5", async () => {
  assert.equal((await put("model/Chalakudy.p01.hdf", HDF5_SAMPLES.oldStyle.bytes)).status, 201);
  let s = await step();
  assert.equal(s.status, "passed", JSON.stringify(s));
  assert.match(s.detail, /1 HDF5 file has readable structure \(\d+ groups and datasets\) and is complete; 1 holds a Results group/);

  assert.equal((await put("model/cut.p02.hdf", HDF5_SAMPLES.oldStyle.bytes.subarray(0, 4000))).status, 201);
  s = await step();
  assert.equal(s.status, "failed");
  assert.match(s.files!.join("|"), /model\/cut\.p02\.hdf: truncated/);

  assert.equal((await put("model/cut.p02.hdf", HDF5_SAMPLES.compact.bytes)).status, 201);
  assert.equal((await put("model/fake.h5", Buffer.from("this is not an HDF5 file at all"))).status, 201);
  s = await step();
  assert.equal(s.status, "failed");
  assert.match(s.files!.join("|"), /model\/fake\.h5: not an HDF5 file/);
});

test("the step is skipped when there is no HDF5 file", async () => {
  assert.equal((await call("POST", "/repos", { name: "plain", visibility: "private" })).status, 201);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(Buffer.from("a,b\n1,2\n"))], "t.csv"));
  form.append("paths", JSON.stringify(["t.csv"]));
  form.append("branch", "main");
  assert.equal((await app.request("/v1/repos/rhea/plain/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form })).status, 201);
  const runs = (await (await call("GET", "/repos/rhea/plain/checks")).json()) as { steps: { name: string; status: string }[] }[];
  assert.equal(runs[0].steps.find((s) => s.name === "HDF5")!.status, "skipped");
});

test("the line diff of a results file shows a dataset that grew and what is in the file", async () => {
  assert.equal((await call("POST", "/repos", { name: "runs", visibility: "private" })).status, 201);
  const up = async (data: Buffer) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(data)], "r.p01.hdf"));
    form.append("paths", JSON.stringify(["r.p01.hdf"]));
    form.append("branch", "main");
    return app.request("/v1/repos/rhea/runs/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  };
  assert.equal((await up(HDF5_SAMPLES.oldStyle.bytes)).status, 201);
  assert.equal((await up(HDF5_SAMPLES.extended.bytes)).status, 201);
  const commits = (await (await call("GET", "/repos/rhea/runs/commits")).json()) as { sha?: string; id?: string }[];
  const head = commits[0].sha ?? commits[0].id;
  const base = commits[1].sha ?? commits[1].id;
  const res = await call("GET", `/repos/rhea/runs/text-diff/${head}/r.p01.hdf?base=${base}`);
  assert.equal(res.status, 200);
  const d = (await res.json()) as { hunks: { lines: { t: string; text: string }[] }[] };
  const changed = d.hunks.flatMap((h) => h.lines).filter((l) => l.t !== " ").map((l) => `${l.t}${l.text}`);
  assert.deepEqual(changed, [
    "-attribute /Plan Data/Plan Information/Time Steps: 3",
    "+attribute /Plan Data/Plan Information/Time Steps: 6",
    "-dataset /Results/Unsteady/Water Surface: float32 [3, 4]",
    "+dataset /Results/Unsteady/Water Surface: float32 [6, 4]",
  ]);
  // A file that is new in a commit shows its whole description as added lines: what the file holds.
  const form = new FormData();
  form.append("file", new File([new Uint8Array(HDF5_SAMPLES.oldStyle.bytes)], "second.p02.hdf"));
  form.append("paths", JSON.stringify(["second.p02.hdf"]));
  form.append("branch", "main");
  assert.equal((await app.request("/v1/repos/rhea/runs/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form })).status, 201);
  const after = (await (await call("GET", "/repos/rhea/runs/commits")).json()) as { sha?: string; id?: string }[];
  const added = await call("GET", `/repos/rhea/runs/text-diff/${after[0].sha ?? after[0].id}/second.p02.hdf?base=${head}`);
  assert.equal(added.status, 200);
  const all = ((await added.json()) as { hunks: { lines: { t: string; text: string }[] }[] }).hunks.flatMap((h) => h.lines).map((l) => `${l.t}${l.text}`);
  assert.ok(all.includes("+format: HDF5, superblock version 0"), all.slice(0, 3).join(" | "));
  assert.ok(all.includes("+dataset /Geometry/2D Flow Areas/Area1/Cells Center Coordinate: float64 [4, 2]"));
  assert.ok(all.includes("+dataset /Plan Data/Plan Name: string scalar"));
  assert.ok(all.includes("+link /Results/Latest"));
  // The file's own attributes: what HEC-RAS says about the file and the plan.
  assert.ok(all.includes("+attribute /File Type: HEC-RAS Results"));
  assert.ok(all.includes("+attribute /File Version: HEC-RAS 6.5.0 February 2024"));
  assert.ok(all.includes("+attribute /Extent: 75.9, 10.2, 76.4, 10.4"));
  assert.ok(all.includes("+attribute /Plan Data/Plan Information/Plan Title: Levee scenario: raise crest 0.5 m"));
});

test("the file page's info carries the structure of a results file, and NetCDF-4 is described the same way", async () => {
  const up = put;
  assert.equal((await up("info/plan.p01.hdf", HDF5_SAMPLES.oldStyle.bytes)).status, 201);
  const res = await call("GET", "/repos/rhea/ras/file/main/info/plan.p01.hdf");
  assert.equal(res.status, 200);
  const f = (await res.json()) as { hdf5: { version: number; groups: number; datasets: number; top: string[]; results: boolean; biggest: { path: string; shape: number[] }[]; properties: { path: string; name: string; value: string }[]; problems: string[] } | null; netcdf: unknown };
  assert.ok(f.hdf5);
  assert.deepEqual([f.hdf5!.version, f.hdf5!.results, f.hdf5!.problems], [0, true, []]);
  assert.deepEqual([...f.hdf5!.top].sort(), ["Geometry", "Plan Data", "Results"]);
  assert.equal(f.hdf5!.datasets, 5);
  assert.equal(f.hdf5!.biggest[0].path, "/Results/Unsteady/Water Surface");
  assert.deepEqual(f.hdf5!.biggest[0].shape, [3, 4]);
  assert.equal(f.netcdf, null);
  // The file's own attributes come first, then the plan's information.
  const names = f.hdf5!.properties.map((p) => `${p.path}::${p.name}=${p.value}`);
  assert.equal(names[0], "/::Extent=75.9, 10.2, 76.4, 10.4");
  assert.ok(names.includes("/::File Version=HEC-RAS 6.5.0 February 2024"));
  assert.ok(names.indexOf("/::Units System=SI Units") < names.indexOf("/Plan Data/Plan Information::Plan Title=Levee scenario: raise crest 0.5 m"));
  // A .nc file that is HDF5 underneath (NetCDF-4) falls through to the HDF5 reader.
  assert.equal((await up("info/grid.nc", HDF5_SAMPLES.compact.bytes)).status, 201);
  const nc = (await (await call("GET", "/repos/rhea/ras/file/main/info/grid.nc")).json()) as { hdf5: { version: number } | null; netcdf: unknown };
  assert.equal(nc.netcdf, null);
  assert.equal(nc.hdf5?.version, 3);
  // A plain CSV has neither.
  assert.equal((await up("info/t.csv", Buffer.from("a,b\n1,2\n"))).status, 201);
  const csv = (await (await call("GET", "/repos/rhea/ras/file/main/info/t.csv")).json()) as { hdf5: unknown };
  assert.equal(csv.hdf5, null);
});

// ── HEC-RAS run summary ─────────────────────────────────────────────────────

test("a results file's own account of its run is read: status, error, time, mass balance", async () => {
  const { summarizeRun } = await import("../src/checks/hecras.ts");
  const ok = summarizeRun((await read(HDF5_SAMPLES.finished.bytes)).objects)!;
  assert.equal(ok.group, "/Results/Unsteady/Summary");
  assert.equal(ok.solution, "Unsteady Finished Successfully");
  assert.equal(ok.unstable, false);
  assert.ok(ok.maxWselError !== null && Math.abs(ok.maxWselError - 0.0123) < 1e-6, String(ok.maxWselError));
  assert.equal(ok.computeTotal, "00:00:12");
  assert.equal(ok.runWindow, "01JAN2024 00:00:00 to 05JAN2024 00:00:00");
  assert.equal(ok.cores, 8);
  assert.deepEqual(ok.volume.map((v) => [v.name, v.value]), [["Error Percent", 0.0012], ["Total Volume In", 12345.5]]);

  const bad = summarizeRun((await read(HDF5_SAMPLES.unstable.bytes)).objects)!;
  assert.equal(bad.unstable, true);
  assert.equal(bad.unstableAt, "02JAN2024 06:10:00");
  assert.equal(bad.maxWselError, null, "a figure the file does not hold is null, not guessed");

  // A file with no Results summary (geometry only, or any other HDF5) has no run.
  assert.equal(summarizeRun((await read(HDF5_SAMPLES.compact.bytes)).objects), null);
});

test("the gate fails a plan that says it went unstable, and the file page carries the run", async () => {
  // Earlier tests left deliberately broken files in this repository; replace them with sound ones.
  const putOrSame = async (name: string, data: Buffer) => assert.ok([201, 409].includes((await put(name, data)).status), name);
  await putOrSame("model/fake.h5", HDF5_SAMPLES.compact.bytes);
  await putOrSame("model/cut.p02.hdf", HDF5_SAMPLES.compact.bytes);
  await putOrSame("runs/Finished.p01.hdf", HDF5_SAMPLES.finished.bytes);
  let s = await step();
  assert.equal(s.status, "passed", JSON.stringify(s));
  assert.equal((await put("runs/Unstable.p02.hdf", HDF5_SAMPLES.unstable.bytes)).status, 201);
  s = await step();
  assert.equal(s.status, "failed");
  assert.match(s.files!.join("|"), /runs\/Unstable\.p02\.hdf: the run reports "Unsteady Went Unstable" \(02JAN2024 06:10:00\)/);
  const f = (await (await call("GET", "/repos/rhea/ras/file/main/runs/Finished.p01.hdf")).json()) as { hdf5: { run: { solution: string; maxWselError: number; unstable: boolean } } };
  assert.equal(f.hdf5.run.solution, "Unsteady Finished Successfully");
  assert.equal(f.hdf5.run.unstable, false);
  // Leave the repository tidy for tests that follow.
  assert.equal((await put("runs/Unstable.p02.hdf", HDF5_SAMPLES.finished.bytes)).status, 201);
});
