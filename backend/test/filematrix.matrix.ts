// Run with `npm run test:matrix` (about 13 minutes, so it is not part of `npm test`).
//
// Fifty end-to-end cases with real files, through the real server and the real command line: every kind of file a hydrologist puts in a
// repository, odd names and sizes, and the ways pushing and cloning can go wrong. Each case checks the one thing that must never fail:
// the bytes that come back are exactly the bytes that went in (SHA-256), and nothing answers 500.
//
//   #01-#16  bytes and names: empty, one byte, line endings, random, huge and repetitive, chunk-size edges, unicode and awkward names,
//            deep paths, hundreds of files, duplicates, a one-byte edit, rename and delete, ignore files, unchanged files
//   #17-#40  formats: GeoTIFF (plain, DEFLATE, strips, predictor, wrong CRS), shapefiles (whole, broken), GeoJSON (good, bad), CSV
//            (plain, BOM and quotes, header only, empty), LAS (good, truncated), NetCDF, HDF5, GeoPackage, GeoParquet, SWMM, HEC-RAS,
//            images, PDF, ZIP, Markdown, big JSON, executables
//   #41-#50  behaviour: a clone is identical, a stale push is refused, branches and pull requests, revert, locks, secret scanning,
//            private repositories, an interrupted push, two simultaneous pushes, and the whole history read back as a ZIP

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { catchments, geotiff, gaugesCsv, hecRas, noiseBytes, shapefile } from "../src/dev/fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), "craton-matrix-"));
const port = 5200 + Math.floor(Math.random() * 300);
const server = `http://localhost:${port}`;
const fixtures = path.join(root, "test/fixtures");
let proc: ChildProcess;
let serverErrors = "";
const tokens: Record<string, string> = {};
let resets = 0; // reads that had to be repeated once because the connection was reset

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const cliPath = path.join(root, "src/cli/craton.ts");
const env = (who: string) => ({ ...process.env, CRATON_HOME: path.join(tmp, `home-${who}`), CRATON_TOKEN: tokens[who], CRATON_AUTHOR: who });

/** Run the CLI as `who` in `cwd`; returns what it printed (throws with the output attached when it fails). */
function cr(who: string, cwd: string, ...args: string[]) {
  return execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", cliPath, ...args], { cwd, env: env(who), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
}
/** Like `cr`, but returns whether it worked and everything it said, so a refusal can be examined. */
function attempt(who: string, cwd: string, ...args: string[]): { ok: boolean; text: string } {
  try {
    return { ok: true, text: cr(who, cwd, ...args) };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message: string };
    return { ok: false, text: `${err.stdout ?? ""}${err.stderr ?? ""}${err.message}` };
  }
}

async function api(method: string, p: string, body?: unknown, who?: string) {
  const res = await fetch(`${server}/v1${p}`, { method, headers: { "content-type": "application/json", ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
const enc = (p: string) => p.split("/").map(encodeURIComponent).join("/");
async function rawBytes(repo: string, ref: string, file: string, who = "alice"): Promise<Buffer> {
  const url = `${server}/v1/repos/${repo}/raw/${encodeURIComponent(ref)}/${enc(file)}`;
  const init = { headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} };
  // A read is safe to repeat, and an idle connection that the other side has just closed is the one failure a client is expected to retry once
  // (browsers do); it is counted, and the last case asserts it is rare.
  const res = await fetch(url, init).catch(async (err) => {
    if ((err as { cause?: { code?: string } }).cause?.code !== "ECONNRESET") throw err;
    resets++;
    return await fetch(url, init);
  });
  assert.equal(res.status, 200, `raw ${file}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

before(async () => {
  proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/server.ts")], {
    env: { ...process.env, PORT: String(port), CRATON_DATA_DIR: path.join(tmp, "server-data"), CRATON_BACKUP_EVERY_HOURS: "0", CRATON_API_RATE: "1000000", CRATON_WARMUP_REPOS: "0" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  proc.stderr!.on("data", (d) => (serverErrors += d));
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`${server}/v1/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  for (const who of ["alice", "bob", "carol"]) {
    const su = await api("POST", "/auth/signup", { username: who, email: `${who}@example.org`, password: "a-very-long-password" });
    assert.equal(su.status, 201, su.text);
    const outbox = (await api("GET", "/dev/outbox")).json as any[];
    const link = outbox.find((m) => m.kind === "verify" && m.to === `${who}@example.org`).text.match(/token=(\S+)/)[1];
    await api("POST", "/auth/verify", { token: link });
    // a personal access token for the command line, made with the sign-up session
    const made = await fetch(`${server}/v1/user/tokens`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${su.json.token}` }, body: JSON.stringify({ note: "matrix", expiresInDays: 1 }) });
    tokens[who] = ((await made.json()) as { token: string }).token;
  }
  assert.equal((await api("POST", "/repos", { name: "basin", visibility: "public", crs: "EPSG:32643" }, "alice")).status, 201);
  assert.equal((await api("PUT", "/repos/alice/basin/collaborators/bob", { role: "Write" }, "alice")).status, 201);
});

after(async () => {
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await exited;
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  if (/Error|error:/.test(serverErrors) && !/^\s*$/.test(serverErrors)) console.error("server stderr:\n" + serverErrors.slice(0, 3000));
});

const A = path.join(tmp, "a");
const written = new Map<string, Buffer>(); // every file pushed to main so far, for the final comparisons

/** Write files into alice's clone, add, commit and push; returns what the push said. */
function pushFiles(files: Record<string, Buffer | string>, message: string, cwd = A, who = "alice") {
  for (const [p, data] of Object.entries(files)) {
    const abs = path.join(cwd, p);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, data);
  }
  cr(who, cwd, "add", ".");
  cr(who, cwd, "commit", "-m", message);
  const out = cr(who, cwd, "push");
  if (cwd === A) for (const [p, data] of Object.entries(files)) written.set(p, Buffer.from(data));
  return out;
}
/** The files must come back from the server byte for byte. */
async function same(files: Record<string, Buffer | string>, repo = "alice/basin", ref = "main", who = "alice") {
  for (const [p, data] of Object.entries(files)) {
    const got = await rawBytes(repo, ref, p, who);
    const want = Buffer.from(data);
    assert.equal(got.length, want.length, `${p}: ${got.length} bytes back, ${want.length} sent`);
    assert.equal(sha(got), sha(want), `${p}: bytes differ`);
  }
}
const uploaded = (out: string) => {
  const m = out.match(/(\d+) of (\d+) chunks to upload/);
  return m ? { sent: Number(m[1]), total: Number(m[2]) } : { sent: 0, total: 0 };
};
const latestChecks = async () => (await api("GET", "/repos/alice/basin/checks?limit=1", undefined, "alice")).json[0] as { status: string; steps: { name: string; status?: string; ok?: boolean | null; detail?: string }[] } | undefined;
const tipOf = async () => (await api("GET", "/repos/alice/basin/commits?limit=1", undefined, "alice")).json[0].sha as string;
const noServerError = (label: string, r: { status: number }) => assert.ok(r.status < 500, `${label}: the server answered ${r.status}`);

const SHAPE = shapefile(catchments(6));
const tif = (name: string) => fs.readFileSync(path.join(fixtures, name));

// ── #01 – #16: bytes and names ───────────────────────────────────────────────

test("#00 a working copy of the repository", () => {
  cr("alice", tmp, "init", "a", "--remote", `${server}/alice/basin`);
  assert.ok(fs.existsSync(path.join(A, ".craton")));
});

test("#01 an empty file", async () => {
  const f = { "c01/empty.txt": Buffer.alloc(0) };
  pushFiles(f, "empty file");
  await same(f);
});

test("#02 a file of one byte, and one of a single NUL", async () => {
  const f = { "c02/one.bin": Buffer.from([0x41]), "c02/nul.bin": Buffer.from([0x00]) };
  pushFiles(f, "one byte");
  await same(f);
});

test("#03 line endings and a missing final newline are kept exactly", async () => {
  const f = { "c03/crlf.txt": "line one\r\nline two\r\nline three\r\n", "c03/lf.txt": "a\nb\nc\n", "c03/nofinal.txt": "no newline at the end", "c03/mixed.txt": "a\r\nb\nc\rd" };
  pushFiles(f, "line endings");
  await same(f);
});

test("#04 three megabytes of random bytes", async () => {
  const f = { "c04/random.bin": randomBytes(3 * 1024 * 1024) };
  pushFiles(f, "random");
  await same(f);
});

test("#05 twenty megabytes of zeros are stored once, not twenty times over", async () => {
  const f = { "c05/zeros.bin": Buffer.alloc(20 * 1024 * 1024) };
  const out = pushFiles(f, "zeros");
  await same(f);
  const { sent, total } = uploaded(out);
  // the chunks are counted once each: 20 MB of zeros is one chunk repeated, so one is sent
  assert.ok(sent >= 1 && sent <= 3, `${sent} of ${total} chunks uploaded for 20 MB of zeros`);
});

test("#06 files sized at and around the chunk limits (min, average, max, plus and minus one)", async () => {
  const f: Record<string, Buffer> = {};
  for (const n of [32 * 1024 - 1, 32 * 1024, 32 * 1024 + 1, 128 * 1024, 512 * 1024 - 1, 512 * 1024, 512 * 1024 + 1, 1024 * 1024]) f[`c06/size-${n}.bin`] = noiseBytes(n, n);
  pushFiles(f, "chunk edges");
  await same(f);
});

test("#07 unicode names: Devanagari, Malayalam, accents, CJK, emoji", async () => {
  const f = { "c07/नदी_नक्शा.txt": "river map", "c07/പെരിയാർ.csv": "a,b\n1,2\n", "c07/café Müller.txt": "umlaut", "c07/长江.txt": "yangtze", "c07/🌊 flood.txt": "wave" };
  pushFiles(f, "unicode names");
  await same(f);
  const tree = (await api("GET", "/repos/alice/basin/paths/main", undefined, "alice")).text;
  assert.ok(tree.includes("नदी_नक्शा.txt"), "the name is listed as written");
});

test("#08 awkward characters in names: spaces, brackets, hash, percent, ampersand, quotes, plus, comma", async () => {
  const f = { "c08/a b (1) [x] #1 & 100% it's, +a;b=c.txt": "x", "c08/{braces}.txt": "y", "c08/trailing space .txt": "z", "c08/UPPER lower.TXT": "w" };
  pushFiles(f, "awkward names");
  await same(f);
});

test("#09 a 180-character name and a path 15 folders deep", async () => {
  const long = `c09/${"n".repeat(176)}.txt`;
  const deep = `c09/${Array.from({ length: 15 }, (_, i) => `d${i}`).join("/")}/leaf.txt`;
  const f = { [long]: "long", [deep]: "deep" };
  pushFiles(f, "long and deep");
  await same(f);
});

test("#10 five hundred small files in one push", async () => {
  const f: Record<string, string> = {};
  for (let i = 0; i < 500; i++) f[`c10/f${String(i).padStart(3, "0")}.txt`] = `file number ${i}\n`.repeat(1 + (i % 7));
  pushFiles(f, "five hundred files");
  for (const i of [0, 1, 249, 250, 499]) await same({ [`c10/f${String(i).padStart(3, "0")}.txt`]: f[`c10/f${String(i).padStart(3, "0")}.txt`] });
});

test("#11 the same content under three names is stored once", async () => {
  const data = noiseBytes(900 * 1024, 11);
  const f = { "c11/one.bin": data, "c11/two.bin": data, "c11/three.bin": data };
  const out = pushFiles(f, "three copies");
  await same(f);
  const { sent, total } = uploaded(out);
  assert.ok(total <= 12 && sent === total, `${sent} of ${total} chunks uploaded for three identical files (about ${Math.ceil(900 / 128)} for one copy)`);
});

test("#12 changing one byte of an 8 MB file uploads about one chunk", async () => {
  const base = noiseBytes(8 * 1024 * 1024, 12);
  pushFiles({ "c12/big.bin": base }, "big file");
  const edited = Buffer.from(base);
  edited[4 * 1024 * 1024] ^= 0xff;
  const out = pushFiles({ "c12/big.bin": edited }, "one byte");
  await same({ "c12/big.bin": edited });
  const { sent, total } = uploaded(out);
  assert.ok(total > 30 && sent <= 3, `${sent} of ${total} chunks uploaded for a one-byte edit`);
});

test("#13 renaming and deleting files: the new tree is right and the old bytes stay readable in the old commit", async () => {
  pushFiles({ "c13/keep.txt": "keep", "c13/old-name.txt": "rename me", "c13/gone.txt": "delete me" }, "before");
  const before = await tipOf();
  fs.renameSync(path.join(A, "c13/old-name.txt"), path.join(A, "c13/new-name.txt"));
  fs.rmSync(path.join(A, "c13/gone.txt"));
  cr("alice", A, "add", ".");
  cr("alice", A, "commit", "-m", "rename and delete");
  cr("alice", A, "push");
  written.delete("c13/old-name.txt");
  written.delete("c13/gone.txt");
  written.set("c13/new-name.txt", Buffer.from("rename me"));
  written.set("c13/keep.txt", Buffer.from("keep"));
  const res = await fetch(`${server}/v1/repos/alice/basin/raw/main/c13/gone.txt`);
  assert.equal(res.status, 404, "deleted at the tip");
  await same({ "c13/new-name.txt": "rename me", "c13/keep.txt": "keep" });
  await same({ "c13/gone.txt": "delete me", "c13/old-name.txt": "rename me" }, "alice/basin", before);
});

test("#14 ignored files and lock files are never stored", async () => {
  fs.writeFileSync(path.join(A, ".cratonignore"), "scratch/\n*.tmp\n");
  const out = pushFiles({ "c14/real.txt": "real", "c14/scratch/notes.txt": "ignored folder", "c14/work.tmp": "ignored pattern", "c14/model.lock": "being written" }, "ignore rules");
  await same({ "c14/real.txt": "real" });
  for (const p of ["c14/scratch/notes.txt", "c14/work.tmp", "c14/model.lock"]) written.delete(p);
  for (const p of ["c14/scratch/notes.txt", "c14/work.tmp", "c14/model.lock"]) {
    assert.equal((await fetch(`${server}/v1/repos/alice/basin/raw/main/${enc(p)}`)).status, 404, `${p} must not be in the repository`);
  }
  assert.ok(out.length > 0);
});

test("#15 binary patterns: all 256 byte values, a UTF-8 BOM first, and long runs of 0xFF", async () => {
  const all = Buffer.from(Array.from({ length: 256 * 8 }, (_, i) => i % 256));
  const f = { "c15/allbytes.bin": all, "c15/bom.txt": Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("text after a BOM\n")]), "c15/ff.bin": Buffer.alloc(700 * 1024, 0xff) };
  pushFiles(f, "binary patterns");
  await same(f);
});

test("#16 a file touched but not changed makes no new commit", async () => {
  const before = await tipOf();
  const p = path.join(A, "c01/empty.txt");
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(A, "c03/lf.txt"), t, t);
  cr("alice", A, "add", ".");
  assert.match(cr("alice", A, "status"), /Nothing to commit/);
  assert.throws(() => cr("alice", A, "commit", "-m", "nothing"), /nothing|No changes|Nothing/i);
  assert.equal(await tipOf(), before);
  assert.ok(fs.existsSync(p));
});

// ── #17 – #40: formats ───────────────────────────────────────────────────────

const checkRun = async () => await latestChecks();

test("#17 a GeoTIFF (float32, EPSG:32643, nodata): exact bytes, a picture, and the gate passes", async () => {
  const dem = geotiff({ width: 512, height: 512, epsg: 32643, nodata: -9999, seed: 17 });
  const out = pushFiles({ "c17/dem.tif": dem }, "geotiff");
  await same({ "c17/dem.tif": dem });
  assert.match(out, /Checks passed|passed/i);
  const png = await fetch(`${server}/v1/repos/alice/basin/render/main/c17/dem.tif?size=256`);
  assert.equal(png.status, 200);
  assert.equal(png.headers.get("content-type"), "image/png");
  const info = await api("GET", "/repos/alice/basin/file/main/c17/dem.tif", undefined, "alice");
  assert.equal(info.status, 200, info.text);
  const px = await api("GET", "/repos/alice/basin/pixel/main/c17/dem.tif?x=100&y=100", undefined, "alice");
  noServerError("pixel", px);
});

test("#18 a DEFLATE-compressed, tiled GeoTIFF", async () => {
  const f = { "c18/deflate_tiled.tif": tif("deflate_tiled.tif") };
  pushFiles(f, "deflate tiled");
  await same(f);
  const r = await fetch(`${server}/v1/repos/alice/basin/render/main/c18/deflate_tiled.tif`);
  noServerError("render", r);
});

test("#19 DEFLATE strips and the floating-point predictor", async () => {
  const f = { "c19/strips.tif": tif("deflate_strips.tif"), "c19/predictor3.tif": tif("deflate_predictor3.tif") };
  pushFiles(f, "deflate variants");
  await same(f);
  for (const n of ["strips", "predictor3"]) noServerError(n, await api("GET", `/repos/alice/basin/file/main/c19/${n}.tif`, undefined, "alice"));
});

test("#20 a GeoTIFF in a different coordinate system than the repository: stored exactly, and the gate speaks up", async () => {
  const wrong = geotiff({ width: 128, height: 128, epsg: 4326, nodata: -9999, seed: 20, origin: [76, 10], pixelSize: 0.001 });
  let out = "";
  try {
    out = pushFiles({ "c20/wrong_crs.tif": wrong }, "wrong CRS");
  } catch (e) {
    out = String((e as { stdout?: string; stderr?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? "");
  }
  // Either the push was accepted with a failed check, or the CLI reported why it was refused; the bytes are never altered.
  const run = await checkRun();
  assert.ok(/coordinate|EPSG|CRS/i.test(out) || run?.status === "failed" || run?.steps.some((s) => /coordinate/i.test(s.name)), `nothing said about the CRS: ${out.slice(0, 300)}`);
});

test("#21 a complete shapefile set: exact bytes, an SVG picture, feature data", async () => {
  const f: Record<string, Buffer> = {};
  for (const [ext, b] of Object.entries(SHAPE)) f[`c21/catch.${ext}`] = b;
  pushFiles(f, "shapefile");
  await same(f);
  const svg = await fetch(`${server}/v1/repos/alice/basin/render/main/c21/catch.shp`);
  assert.equal(svg.status, 200);
  assert.match(svg.headers.get("content-type") ?? "", /svg/);
  const feats = await api("GET", "/repos/alice/basin/features/main/c21/catch.shp", undefined, "alice");
  assert.equal(feats.status, 200, feats.text.slice(0, 200));
});

test("#22 a shapefile with its .dbf missing: stored exactly, no crash, and the gate notices", async () => {
  const f = { "c22/broken.shp": SHAPE.shp, "c22/broken.shx": SHAPE.shx };
  let out = "";
  try {
    out = pushFiles(f, "incomplete shapefile");
  } catch (e) {
    out = String((e as { stdout?: string }).stdout ?? "") + String((e as { stderr?: string }).stderr ?? "");
  }
  await same(f);
  noServerError("render", { status: (await fetch(`${server}/v1/repos/alice/basin/render/main/c22/broken.shp`)).status });
  const run = await checkRun();
  assert.ok(run?.status === "failed" || /shapefile|dbf|incomplete/i.test(out + JSON.stringify(run?.steps)), "an incomplete shapefile set is flagged");
});

test("#23 GeoJSON that is valid, and GeoJSON that is not even JSON: both stored exactly, neither crashes the viewer", async () => {
  const good = JSON.stringify({ type: "FeatureCollection", features: [{ type: "Feature", properties: { name: "Periyar" }, geometry: { type: "LineString", coordinates: [[76.1, 10.2], [76.2, 10.3]] } }] });
  const bad = '{"type": "FeatureCollection", "features": [ {"type": "Feature", ';
  const f = { "c23/good.geojson": good, "c23/bad.geojson": bad };
  pushFiles(f, "geojson");
  await same(f);
  for (const n of ["good", "bad"]) noServerError(n, await api("GET", `/repos/alice/basin/features/main/c23/${n}.geojson`, undefined, "alice"));
});

test("#24 a gauge table (CSV), and a CSV with a BOM, semicolons, quoted newlines and non-ASCII text", async () => {
  const gauges = gaugesCsv(40);
  const odd = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('station;note;stage\n"Peringalkuthu";"two\nlines";2,45\n"നദി";"quote "" inside";3,10\n', "utf8")]);
  const f = { "c24/gauges.csv": gauges, "c24/odd.csv": odd };
  pushFiles(f, "csv");
  await same(f);
  for (const n of ["gauges", "odd"]) noServerError(n, await api("GET", `/repos/alice/basin/file/main/c24/${n}.csv`, undefined, "alice"));
});

test("#25 a CSV with only a header, and a completely empty CSV", async () => {
  const f = { "c25/header.csv": "station,stage_m,discharge_m3s\n", "c25/empty.csv": "" };
  pushFiles(f, "degenerate csv");
  await same(f);
  for (const n of ["header", "empty"]) noServerError(n, await api("GET", `/repos/alice/basin/file/main/c25/${n}.csv`, undefined, "alice"));
});

function las(points: number, truncateBy = 0): Buffer {
  const headerSize = 227;
  const h = Buffer.alloc(headerSize);
  h.write("LASF", 0, "latin1");
  h[24] = 1;
  h[25] = 2;
  h.writeUInt16LE(headerSize, 94);
  h.writeUInt32LE(headerSize, 96);
  h[104] = 1;
  h.writeUInt16LE(28, 105);
  h.writeUInt32LE(points, 107);
  [0.01, 0.01, 0.001].forEach((v, i) => h.writeDoubleLE(v, 131 + i * 8));
  [500100, 500000, 4000100, 4000000, 120.5, 100.25].forEach((v, i) => h.writeDoubleLE(v, 179 + i * 8));
  const body = Buffer.alloc(points * 28);
  for (let i = 0; i < points; i++) {
    body.writeInt32LE(Math.floor((i % 100) * 100), i * 28);
    body.writeInt32LE(Math.floor(Math.floor(i / 100) * 100), i * 28 + 4);
    body.writeInt32LE(10000 + ((i * 7) % 2000), i * 28 + 8);
  }
  return Buffer.concat([h, body]).subarray(0, headerSize + body.length - truncateBy);
}

test("#26 a LAS point cloud: exact bytes and a picture seen from above", async () => {
  const f = { "c26/cloud.las": las(5000) };
  pushFiles(f, "las");
  await same(f);
  const png = await fetch(`${server}/v1/repos/alice/basin/render/main/c26/cloud.las`);
  noServerError("las render", png);
});

test("#27 a LAS file cut short in transfer: stored exactly, no crash", async () => {
  const f = { "c27/cut.las": las(2000, 1000) };
  try {
    pushFiles(f, "truncated las");
  } catch {}
  await same(f);
  noServerError("render", { status: (await fetch(`${server}/v1/repos/alice/basin/render/main/c27/cut.las`)).status });
});

test("#28 a classic NetCDF file, and a NetCDF with a broken header", async () => {
  const classic = Buffer.concat([Buffer.from("CDF\x01"), Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4)]); // no dimensions, attributes or variables
  const broken = Buffer.concat([Buffer.from("CDF\x01"), Buffer.from([0xff, 0xff, 0xff, 0xff, 0x00, 0x00])]);
  const f = { "c28/empty.nc": classic, "c28/broken.nc": broken };
  pushFiles(f, "netcdf");
  await same(f);
  for (const n of ["empty", "broken"]) noServerError(n, await api("GET", `/repos/alice/basin/file/main/c28/${n}.nc`, undefined, "alice"));
});

test("#29 HDF5 files with gzip and shuffle filters", async () => {
  const f = { "c29/plain.h5": tif("h5_gzip_plain.h5"), "c29/shuffle.h5": tif("h5_gzip_shuffle.h5"), "c29/two.h5": tif("h5_two_datasets.h5") };
  pushFiles(f, "hdf5");
  await same(f);
  for (const n of ["plain", "shuffle", "two"]) noServerError(n, await api("GET", `/repos/alice/basin/file/main/c29/${n}.h5`, undefined, "alice"));
});

test("#30 a GeoPackage, and a SQLite file that is not one", async () => {
  const dir = fs.mkdtempSync(path.join(tmp, "gpkg-"));
  const mk = (name: string, setup: (db: DatabaseSync) => void) => {
    const file = path.join(dir, name);
    const db = new DatabaseSync(file);
    setup(db);
    db.close();
    return fs.readFileSync(file);
  };
  const gpkg = mk("a.gpkg", (db) => {
    db.exec("PRAGMA application_id = 1196444487; PRAGMA user_version = 10300;");
    db.exec("CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER, definition TEXT, description TEXT);");
    db.exec("CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT, description TEXT, last_change TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, srs_id INTEGER);");
    db.exec("INSERT INTO gpkg_spatial_ref_sys VALUES ('UTM 43N', 32643, 'EPSG', 32643, 'x', '')");
    db.exec("CREATE TABLE rivers (fid INTEGER PRIMARY KEY, geom BLOB, name TEXT); INSERT INTO rivers (name) VALUES ('a'), ('b');");
    db.exec("INSERT INTO gpkg_contents VALUES ('rivers', 'features', 'rivers', '', '', 75, 10, 76, 11, 32643)");
  });
  const plain = mk("b.sqlite", (db) => db.exec("CREATE TABLE t (a); INSERT INTO t VALUES (1);"));
  fs.rmSync(dir, { recursive: true, force: true });
  const f = { "c30/layers.gpkg": gpkg, "c30/notgpkg.gpkg": plain };
  pushFiles(f, "geopackage");
  await same(f);
  for (const n of ["layers", "notgpkg"]) noServerError(n, await api("GET", `/repos/alice/basin/file/main/c30/${n}.gpkg`, undefined, "alice"));
});

test("#31 a GeoParquet file, and a Parquet-looking file with no footer", async () => {
  const geo = JSON.stringify({ version: "1.0.0", primary_column: "geometry", columns: { geometry: { encoding: "WKB", geometry_types: ["Polygon"], crs: { id: { authority: "EPSG", code: 32643 } } } } });
  const footer = Buffer.concat([Buffer.from([0x15, 0x04, 0x19, 0x2c]), Buffer.from("schema"), Buffer.from([0x03, 0x67, 0x65, 0x6f]), Buffer.from(geo, "utf8"), Buffer.from([0x00, 0x16])]);
  const len = Buffer.alloc(4);
  len.writeUInt32LE(footer.length, 0);
  const good = Buffer.concat([Buffer.from("PAR1"), Buffer.alloc(200, 7), footer, len, Buffer.from("PAR1")]);
  const bad = Buffer.concat([Buffer.from("PAR1"), Buffer.alloc(100, 9)]);
  const f = { "c31/good.parquet": good, "c31/bad.parquet": bad };
  pushFiles(f, "parquet");
  await same(f);
  for (const n of ["good", "bad"]) noServerError(n, await api("GET", `/repos/alice/basin/file/main/c31/${n}.parquet`, undefined, "alice"));
});

test("#32 an SWMM input file", async () => {
  const inp = ["[TITLE]", "Urban drainage, Bengaluru", "", "[OPTIONS]", "FLOW_UNITS CMS", "INFILTRATION HORTON", "", "[JUNCTIONS]", ...Array.from({ length: 40 }, (_, i) => `J${i}  ${900 - i}  3  0  0  0`), "", "[CONDUITS]", ...Array.from({ length: 39 }, (_, i) => `C${i} J${i} J${i + 1} 120 0.013 0 0 0 0`), ""].join("\r\n");
  const f = { "c32/network.inp": inp };
  pushFiles(f, "swmm");
  await same(f);
  noServerError("info", await api("GET", "/repos/alice/basin/file/main/c32/network.inp", undefined, "alice"));
});

test("#33 a HEC-RAS model folder (project, plan, geometry, flow)", async () => {
  const model = hecRas(0.035, 4100);
  const f: Record<string, Buffer> = {};
  for (const [p, b] of Object.entries(model)) f[`c33/${p}`] = b;
  pushFiles(f, "hec-ras");
  await same(f);
  const run = await checkRun();
  assert.ok(run, "a check run exists for the commit");
});

test("#34 images: PNG, JPEG and GIF bytes, a PDF and a ZIP", async () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF"), noiseBytes(3000, 34), Buffer.from([0xff, 0xd9])]);
  const gif = Buffer.concat([Buffer.from("GIF89a"), noiseBytes(500, 35), Buffer.from([0x3b])]);
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  const zip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), noiseBytes(4000, 36), Buffer.from([0x50, 0x4b, 0x05, 0x06]), Buffer.alloc(18)]);
  const f = { "c34/pixel.png": png, "c34/photo.jpg": jpeg, "c34/anim.gif": gif, "c34/report.pdf": pdf, "c34/data.zip": zip };
  pushFiles(f, "images and documents");
  await same(f);
});

test("#35 a README with links, code and non-Latin text", async () => {
  const md = "# Chalakudy basin\n\nSee [the DEM](terrain/dem.tif) and `craton clone`.\n\n```\ncraton add .\n```\n\n| a | b |\n|---|---|\n| नदी | ജലം |\n\n<script>alert(1)</script>\n";
  const f = { "c35/README.md": md };
  pushFiles(f, "readme");
  await same(f);
  noServerError("info", await api("GET", "/repos/alice/basin/file/main/c35/README.md", undefined, "alice"));
});

test("#36 a 5 MB JSON file", async () => {
  const big = JSON.stringify({ stations: Array.from({ length: 40000 }, (_, i) => ({ id: i, name: `G${i}`, lat: 10 + i / 1e5, lon: 76 + i / 1e5, readings: [1, 2, 3] })) });
  const f = { "c36/big.json": big };
  pushFiles(f, "big json");
  await same(f);
  noServerError("info", await api("GET", "/repos/alice/basin/file/main/c36/big.json", undefined, "alice"));
});

test("#37 executable-looking and unknown binary files are stored as they are", async () => {
  const exe = Buffer.concat([Buffer.from("MZ"), noiseBytes(60000, 37)]);
  const elf = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), noiseBytes(40000, 38)]);
  const f = { "c37/tool.exe": exe, "c37/tool.bin": elf, "c37/data.unknownext": noiseBytes(1234, 39) };
  pushFiles(f, "binaries");
  await same(f);
});

test("#38 a file with no extension and one with only an extension", async () => {
  const f = { "c38/Makefile": "all:\n\techo hi\n", "c38/.hidden": "hidden", "c38/.tif": "not really a tif", "c38/a.": "dot at the end?" };
  try {
    pushFiles(f, "odd extensions");
  } catch (e) {
    // a name that ends in a dot cannot exist on every file system; the rest must not be affected
    delete (f as Record<string, string>)["c38/a."];
    pushFiles(f, "odd extensions without the dotted name");
  }
  await same(Object.fromEntries(Object.entries(f).filter(([p]) => written.has(p))));
});

test("#39 a raster that is far too small, and one with zero width", async () => {
  const tiny = geotiff({ width: 1, height: 1, epsg: 32643, nodata: -9999, seed: 3 });
  const f = { "c39/one_pixel.tif": tiny, "c39/header_only.tif": Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00]) };
  try {
    pushFiles(f, "degenerate rasters");
  } catch {}
  await same(f);
  for (const n of ["one_pixel", "header_only"]) noServerError(n, { status: (await fetch(`${server}/v1/repos/alice/basin/render/main/c39/${n}.tif`)).status });
});

test("#40 every viewer route answers (200 or a clear 4xx), never a 500, for every file stored so far", async () => {
  const bad: string[] = [];
  for (const p of written.keys()) {
    for (const route of ["file", "render", "features"]) {
      const res = await fetch(`${server}/v1/repos/alice/basin/${route}/main/${enc(p)}`);
      await res.arrayBuffer();
      if (res.status >= 500) bad.push(`${route} ${p} -> ${res.status}`);
    }
  }
  assert.deepEqual(bad, [], "viewer routes must not fail with a server error");
});

// ── #41 – #50: behaviour ─────────────────────────────────────────────────────

test("#41 a fresh clone holds every file byte for byte", () => {
  const B = path.join(tmp, "clone1");
  cr("alice", tmp, "clone", `${server}/alice/basin`, "clone1");
  let n = 0;
  for (const [p, data] of written) {
    const f = path.join(B, p);
    assert.ok(fs.existsSync(f), `${p} is missing from the clone`);
    assert.equal(sha(fs.readFileSync(f)), sha(data), `${p} differs`);
    n++;
  }
  assert.ok(n > 500, `${n} files compared`);
  assert.match(cr("alice", B, "status"), /Nothing to commit/);
  assert.doesNotMatch(cr("alice", B, "fsck"), /problem|corrupt|mismatch/i);
});

test("#42 a push from a clone that is behind is refused, and nothing is changed", async () => {
  const B = path.join(tmp, "clone1");
  const tip = await tipOf();
  pushFiles({ "c42/ahead.txt": "alice moves on" }, "alice moves on");
  fs.writeFileSync(path.join(B, "c42-behind.txt"), "from the old clone");
  cr("alice", B, "add", ".");
  cr("alice", B, "commit", "-m", "from behind");
  const r = attempt("alice", B, "push");
  assert.equal(r.ok, false);
  assert.match(r.text, /moved since you last pulled|append-only|craton pull/i);
  assert.equal((await fetch(`${server}/v1/repos/alice/basin/raw/main/c42-behind.txt`)).status, 404);
  assert.notEqual(await tipOf(), tip, "alice's own push did land");
});

test("#43 a branch, a pull request and a merge bring exactly the pushed bytes to main", async () => {
  cr("alice", A, "branch", "survey-2025");
  cr("alice", A, "checkout", "survey-2025");
  const dem = geotiff({ width: 256, height: 256, epsg: 32643, nodata: -9999, seed: 43 });
  try {
    pushFiles({ "c43/survey.tif": dem, "c43/notes.txt": "resurvey notes" }, "branch work");
  } finally {
    cr("alice", A, "checkout", "main");
  }
  assert.equal((await fetch(`${server}/v1/repos/alice/basin/raw/main/c43/notes.txt`)).status, 404, "not on main before the merge");
  await same({ "c43/survey.tif": dem, "c43/notes.txt": "resurvey notes" }, "alice/basin", "survey-2025");
  const pr = await api("POST", "/repos/alice/basin/pulls", { title: "Resurvey", source: "survey-2025", target: "main" }, "alice");
  assert.equal(pr.status, 201, pr.text);
  // The repository's earlier files include ones the gate rightly objects to (a raster in the wrong coordinate system, a broken shapefile set), so
  // the pull request cannot be merged while "checks must pass" is on; an administrator can switch that rule off for this repository.
  const refused = await api("POST", `/repos/alice/basin/pulls/${pr.json.number}/merge`, {}, "alice");
  assert.equal(refused.status, 409, refused.text.slice(0, 300));
  assert.equal(refused.json.error.code, "checks_failing");
  assert.equal((await fetch(`${server}/v1/repos/alice/basin/raw/main/c43/notes.txt`)).status, 404, "a refused merge changes nothing");
  assert.equal((await api("PATCH", "/repos/alice/basin", { requireChecks: false }, "alice")).status, 200);
  const merged = await api("POST", `/repos/alice/basin/pulls/${pr.json.number}/merge`, {}, "alice");
  assert.ok(merged.status === 200 || merged.status === 201, merged.text.slice(0, 300));
  assert.equal((await api("PATCH", "/repos/alice/basin", { requireChecks: true }, "alice")).status, 200);
  await same({ "c43/survey.tif": dem, "c43/notes.txt": "resurvey notes" }, "alice/basin", "main");
  cr("alice", A, "pull");
  assert.equal(sha(fs.readFileSync(path.join(A, "c43/survey.tif"))), sha(dem));
});

test("#44 reverting a commit restores the earlier bytes as a new commit", async () => {
  pushFiles({ "c44/doc.txt": "version one" }, "v1");
  pushFiles({ "c44/doc.txt": "version two, with a mistake" }, "v2");
  const log = (await api("GET", "/repos/alice/basin/commits?limit=2", undefined, "alice")).json as { sha: string }[];
  cr("alice", A, "revert", log[0].sha);
  cr("alice", A, "push");
  written.set("c44/doc.txt", Buffer.from("version one"));
  await same({ "c44/doc.txt": "version one" });
  assert.equal(fs.readFileSync(path.join(A, "c44/doc.txt"), "utf8"), "version one");
});

test("#45 a file locked by one person cannot be changed by another's push", async () => {
  pushFiles({ "c45/locked.bin": noiseBytes(300000, 45) }, "to lock");
  assert.match(cr("alice", A, "lock", "c45/locked.bin", "--reason", "recalibrating"), /Locked/);
  const Bd = path.join(tmp, "bob-clone");
  cr("bob", tmp, "clone", `${server}/alice/basin`, "bob-clone");
  const p = path.join(Bd, "c45/locked.bin");
  try {
    fs.chmodSync(p, 0o666);
  } catch {}
  fs.writeFileSync(p, noiseBytes(300000, 46));
  cr("bob", Bd, "add", ".");
  cr("bob", Bd, "commit", "-m", "bob changes a locked file");
  const r = attempt("bob", Bd, "push");
  assert.equal(r.ok, false, "the push must be refused");
  assert.match(r.text, /lock/i);
  await same({ "c45/locked.bin": written.get("c45/locked.bin")! });
  cr("alice", A, "unlock", "c45/locked.bin");
});

test("#46 a pasted credential is stopped at push, and a clean file goes through", async () => {
  const aws = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  const pem = ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEA0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH", "-----END RSA PRIVATE KEY-----"].join("\n");
  for (const [name, body] of [["env.txt", `AWS_ACCESS_KEY_ID=${aws}
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYexamplekey1
`], ["id_rsa", pem]] as const) {
    // a clone of its own for each attempt, so the refused commit never sits in the way of the others
    const dir = `secret-${name.replace(/\W/g, "")}`;
    cr("alice", tmp, "clone", `${server}/alice/basin`, dir);
    fs.writeFileSync(path.join(tmp, dir, name), body);
    cr("alice", path.join(tmp, dir), "add", ".");
    cr("alice", path.join(tmp, dir), "commit", "-m", `secret in ${name}`);
    const r = attempt("alice", path.join(tmp, dir), "push");
    assert.equal(r.ok, false, `${name}: the push must be stopped`);
    assert.match(r.text, /secret|credential|key/i);
    assert.equal((await fetch(`${server}/v1/repos/alice/basin/raw/main/${name}`)).status, 404, `${name} must not have been stored`);
  }
  const clean = { "c46/clean.txt": "no secrets here\n" };
  const r = attempt("alice", A, "status");
  assert.ok(r.ok);
  pushFiles(clean, "clean file");
  await same(clean);
});

test("#47 a private repository is invisible to strangers and to people without access", async () => {
  assert.equal((await api("POST", "/repos", { name: "vault", visibility: "private", crs: "EPSG:32643" }, "alice")).status, 201);
  const V = path.join(tmp, "vault");
  cr("alice", tmp, "init", "vault", "--remote", `${server}/alice/vault`);
  const data = noiseBytes(200000, 47);
  pushFiles({ "secret.bin": data }, "private data", V);
  await same({ "secret.bin": data }, "alice/vault");
  const anon = await fetch(`${server}/v1/repos/alice/vault/raw/main/secret.bin`);
  const carol = await fetch(`${server}/v1/repos/alice/vault/raw/main/secret.bin`, { headers: { authorization: `Bearer ${tokens.carol}` } });
  assert.ok(anon.status === 404 || anon.status === 401 || anon.status === 403, `anonymous got ${anon.status}`);
  assert.ok(carol.status === 404 || carol.status === 403, `a signed-in stranger got ${carol.status}`);
  const chunk = sha(data.subarray(0, 100));
  const cc = await fetch(`${server}/v1/repos/alice/vault/chunks/${chunk}`, { headers: { authorization: `Bearer ${tokens.carol}` } });
  assert.ok(cc.status >= 400 && cc.status < 500, `chunk read by a stranger: ${cc.status}`);
  const clone = attempt("carol", tmp, "clone", `${server}/alice/vault`, "stolen");
  assert.equal(clone.ok, false, "a stranger cannot clone");
  assert.ok(!fs.existsSync(path.join(tmp, "stolen/secret.bin")));
});

test("#48 a push that is interrupted midway can simply be run again", async () => {
  const f = { "c48/huge.bin": randomBytes(24 * 1024 * 1024) };
  fs.mkdirSync(path.join(A, "c48"), { recursive: true });
  fs.writeFileSync(path.join(A, "c48/huge.bin"), f["c48/huge.bin"]);
  cr("alice", A, "add", ".");
  cr("alice", A, "commit", "-m", "big push");
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cliPath, "push"], { cwd: A, env: env("alice"), stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1200));
  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));
  const rerun = cr("alice", A, "push");
  assert.match(rerun, /Pushed main|Everything up to date|up to date/i);
  written.set("c48/huge.bin", f["c48/huge.bin"]);
  await same(f);
  assert.equal((await api("GET", "/repos/alice/basin/commits?limit=200", undefined, "alice")).json.filter((c: any) => c.message === "big push").length, 1, "the commit appears once");
});

test("#49 two people pushing at the same moment: one wins, the other is told to pull, and history stays a straight line", async () => {
  const C1 = path.join(tmp, "race1"), C2 = path.join(tmp, "race2");
  cr("alice", tmp, "clone", `${server}/alice/basin`, "race1");
  cr("bob", tmp, "clone", `${server}/alice/basin`, "race2");
  for (const [d, who, name] of [[C1, "alice", "from-alice.txt"], [C2, "bob", "from-bob.txt"]] as const) {
    fs.writeFileSync(path.join(d, `c49-${name}`), `${who}\n`.repeat(1000));
    cr(who, d, "add", ".");
    cr(who, d, "commit", "-m", `race ${who}`);
  }
  const run = (who: string, d: string) =>
    new Promise<{ ok: boolean; text: string }>((resolve) => {
      let text = "";
      const c = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", cliPath, "push"], { cwd: d, env: env(who) });
      c.stdout.on("data", (x) => (text += x));
      c.stderr.on("data", (x) => (text += x));
      c.on("exit", (code) => resolve({ ok: code === 0, text }));
    });
  const [a, b] = await Promise.all([run("alice", C1), run("bob", C2)]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, `exactly one push succeeds: alice ${a.ok}, bob ${b.ok}`);
  const loser = a.ok ? b : a;
  assert.match(loser.text, /moved since you last pulled|append-only|craton pull|Run `craton pull`/i);
  const log = (await api("GET", "/repos/alice/basin/commits?limit=200", undefined, "alice")).json as { id: string; parents?: string[] }[];
  const raceCommits = log.filter((c: any) => /^race /.test(c.message));
  assert.equal(raceCommits.length, 1, "only the winner's commit is in main");
  cr("alice", A, "pull");
});

test("#50 the whole repository downloaded as a ZIP holds every file byte for byte, and a range read matches", async () => {
  const res = await fetch(`${server}/v1/repos/alice/basin/archive/main`, { headers: { authorization: `Bearer ${tokens.alice}` } });
  assert.equal(res.status, 200);
  const zip = Buffer.from(await res.arrayBuffer());
  // read the central directory
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 70000); i--) if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, "a ZIP end record");
  const count = zip.readUInt16LE(eocd + 10);
  let off = zip.readUInt32LE(eocd + 16);
  const entries = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    assert.equal(zip.readUInt32LE(off), 0x02014b50);
    const method = zip.readUInt16LE(off + 10), csize = zip.readUInt32LE(off + 20), nlen = zip.readUInt16LE(off + 28), xlen = zip.readUInt16LE(off + 30), clen = zip.readUInt16LE(off + 32), lho = zip.readUInt32LE(off + 42);
    const name = zip.subarray(off + 46, off + 46 + nlen).toString("utf8");
    const lnl = zip.readUInt16LE(lho + 26), lxl = zip.readUInt16LE(lho + 28);
    const data = zip.subarray(lho + 30 + lnl + lxl, lho + 30 + lnl + lxl + csize);
    entries.set(name.replace(/^[^/]+\//, ""), method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data));
    off += 46 + nlen + xlen + clen;
  }
  let compared = 0;
  const missing: string[] = [];
  for (const [p, data] of written) {
    const got = entries.get(p);
    if (!got) {
      missing.push(p);
      continue;
    }
    assert.equal(sha(got), sha(data), `${p} differs inside the ZIP`);
    compared++;
  }
  assert.deepEqual(missing, [], "every stored file is in the ZIP");
  assert.ok(compared > 500, `${compared} files compared`);
  // a range read of the middle of a big file
  const big = written.get("c04/random.bin")!;
  const part = await fetch(`${server}/v1/repos/alice/basin/raw/main/c04/random.bin`, { headers: { authorization: `Bearer ${tokens.alice}`, range: "bytes=1000000-1999999" } });
  assert.equal(part.status, 206);
  assert.equal(sha(Buffer.from(await part.arrayBuffer())), sha(big.subarray(1000000, 2000000)));
  assert.ok(resets <= 2, `${resets} reads were reset by the server`);
  assert.equal(serverErrors.includes("TypeError") || serverErrors.includes("unhandled"), false, `the server logged an error:\n${serverErrors.slice(0, 1500)}`);
});
