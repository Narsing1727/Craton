// End to end: a real server process and the real CLI, in temporary folders.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { catchments, geotiff, gaugesCsv, shapefile } from "../src/dev/fixtures.ts";

const root = path.resolve(import.meta.dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "craton-cli-"));
const port = 4600 + Math.floor(Math.random() * 300);
const server = `http://localhost:${port}`;
let serverErrors = "";
let proc: ChildProcess;
let token = "";

const sha = (f: string) => createHash("sha256").update(fs.readFileSync(f)).digest("hex");

function craton(cwd: string, ...args: string[]) {
  return execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), ...args], {
    cwd,
    env: { ...process.env, CRATON_HOME: path.join(tmp, "home"), CRATON_TOKEN: token, CRATON_AUTHOR: "alice" },
    encoding: "utf8",
  });
}

/** The same CLI, acting as another person: only the name it shows and compares locks against changes. */
function cratonAs(author: string, cwd: string, ...args: string[]) {
  return execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), ...args], {
    cwd,
    env: { ...process.env, CRATON_HOME: path.join(tmp, "home"), CRATON_TOKEN: token, CRATON_AUTHOR: author },
    encoding: "utf8",
  });
}

const writable = (file: string) => {
  try {
    fs.accessSync(file, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
};

async function api(method: string, p: string, body?: unknown, auth?: string) {
  const res = await fetch(`${server}/v1${p}`, {
    method,
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return await res.json() as Promise<any>;
}

before(async () => {
  proc = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/server.ts")], {
    env: { ...process.env, PORT: String(port), CRATON_DATA_DIR: path.join(tmp, "server-data") },
    stdio: ["ignore", "ignore", "pipe"],
  });
  // If the server dies mid-run, say why instead of failing later with ECONNRESET.
  proc.stderr!.on("data", (d) => (serverErrors += d));
  proc.once("exit", (code) => code !== null && code !== 0 && console.error(`server exited with ${code}:
${serverErrors}`));
  for (let i = 0; i < 600; i++) {
    try {
      if ((await fetch(`${server}/v1/health`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const signup = await api("POST", "/auth/signup", { username: "alice", email: "alice@example.org", password: "a-very-long-password" });
  // Confirm the email the real way: take the link from the dev outbox and follow it.
  const outbox = await api("GET", "/dev/outbox");
  const link = outbox.find((m: any) => m.kind === "verify" && m.to === "alice@example.org").text.match(/token=(\S+)/)[1];
  await api("POST", "/auth/verify", { token: link });
  await api("POST", "/repos", { name: "basin", visibility: "public", crs: "EPSG:32643" }, signup.token);
  token = (await api("POST", "/user/tokens", { note: "cli test", expiresInDays: 1 }, signup.token)).token;
});

after(async () => {
  if (proc && proc.exitCode === null) {
    const exited = new Promise((r) => proc.once("exit", r));
    proc.kill();
    await exited;
  }
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

const A = path.join(tmp, "a");
const B = path.join(tmp, "b");
const dem = (resurvey?: { from: number; to: number; offset: number }) => geotiff({ width: 724, height: 724, epsg: 32643, nodata: -9999, seed: 5, resurvey });

test("init, add, commit, push", () => {
  craton(tmp, "init", "a", "--remote", `${server}/alice/basin`);
  fs.mkdirSync(path.join(A, "terrain"));
  fs.mkdirSync(path.join(A, "vectors"));
  fs.writeFileSync(path.join(A, "terrain/basin_dem.tif"), dem());
  const set = shapefile(catchments(8));
  for (const [ext, buf] of Object.entries(set)) fs.writeFileSync(path.join(A, `vectors/catchment.${ext}`), buf);
  fs.writeFileSync(path.join(A, "gauges.csv"), gaugesCsv(30));
  fs.writeFileSync(path.join(A, "hec.lock"), "being written");

  const added = craton(A, "add", ".");
  assert.match(added, /Staged 6 changed files/);
  assert.doesNotMatch(craton(A, "status"), /hec\.lock/, "lock files are never read");
  assert.match(craton(A, "commit", "-m", "Initial import"), /\[main [0-9a-f]{7}\] Initial import/);
  const pushed = craton(A, "push");
  assert.match(pushed, /Pushed main: \(new\) →/);
  assert.match(pushed, /Checks passed/);
});

test("clone is byte-identical", () => {
  const out = craton(tmp, "clone", `${server}/alice/basin`, "b");
  assert.match(out, /Cloned alice\/basin \(6 files/);
  for (const f of ["terrain/basin_dem.tif", "vectors/catchment.shp", "vectors/catchment.dbf", "gauges.csv"]) {
    assert.equal(sha(path.join(B, f)), sha(path.join(A, f)), f);
  }
  assert.match(craton(B, "status"), /Nothing to commit/);
});

test("a partial re-survey uploads and downloads only the changed chunks", () => {
  fs.writeFileSync(path.join(A, "terrain/basin_dem.tif"), dem({ from: 600, to: 640, offset: 0.35 }));
  craton(A, "add", ".");
  assert.match(craton(A, "status"), /modified\s+terrain\/basin_dem\.tif \[DEM\]\s+\d+ of \d+ chunks changed/);
  craton(A, "commit", "-m", "Re-survey rows 600 to 640");
  const pushed = craton(A, "push");
  const m = pushed.match(/(\d+) of (\d+) chunks to upload/)!;
  const [uploaded, total] = [Number(m[1]), Number(m[2])];
  assert.ok(uploaded > 0 && uploaded <= total / 3, `uploaded ${uploaded} of ${total} chunks`);

  const pulled = craton(B, "pull");
  assert.match(pulled, /Fast-forwarded main/);
  assert.equal(sha(path.join(B, "terrain/basin_dem.tif")), sha(path.join(A, "terrain/basin_dem.tif")));
  const downloaded = pulled.match(/([\d.]+) (KB|MB) downloaded/)!;
  const bytes = Number(downloaded[1]) * (downloaded[2] === "MB" ? 1024 * 1024 : 1024);
  assert.ok(bytes < fs.statSync(path.join(A, "terrain/basin_dem.tif")).size / 3, `downloaded ${downloaded[0]}`);
});

test("stats gives the numbers behind a raster change, and the fit of a gauge table, from the terminal", () => {
  // The re-survey raised rows 600 to 640 by 0.35 m, so the change is positive and touches a small share of cells.
  const text = craton(A, "stats", "terrain/basin_dem.tif");
  assert.match(text, /^terrain\/basin_dem\.tif: [0-9a-f]{7} -> main/m);
  assert.match(text, /^before\s+min/m);
  assert.match(text, /^after\s+min/m);
  const json = JSON.parse(craton(A, "stats", "terrain/basin_dem.tif", "--json"));
  assert.ok(json.change.meanChange > 0 && json.change.raisedPercent > 0 && json.change.raisedPercent < 20, JSON.stringify(json.change));
  assert.equal(json.change.loweredPercent, 0);
  assert.throws(() => craton(A, "stats", "gauges.csv"), /--obs/);

  // Observed against simulated, per station, computed from the working file.
  const fit = JSON.parse(craton(A, "stats", "gauges.csv", "--obs", "stage_m", "--sim", "discharge_m3s", "--by", "station", "--json"));
  assert.equal(fit.overall.n, 30 * 5);
  assert.equal(fit.groups.length, 5);
  assert.ok(fit.groups.every((g: any) => g.fit.n === 30));
  assert.throws(() => craton(A, "stats", "gauges.csv", "--obs", "nope", "--sim", "stage_m"), /no column/);
});

test("diff lists what a commit changed, by name or by commit id, and how much of each file was rewritten", () => {
  const last = craton(A, "diff");
  assert.match(last, /^[0-9a-f]{7} -> [0-9a-f]{7}$/m);
  assert.match(last, /modified\s+terrain\/basin_dem\.tif \[DEM\]\s+\d+ of \d+ chunks rewritten/);
  assert.match(last, /1 file changed, \d+ chunks rewritten\./);
  const first = JSON.parse(craton(A, "diff", "HEAD~1", "HEAD", "--json"));
  assert.equal(first.changes.length, 1);
  assert.equal(first.changes[0].type, "DEM");
  // From the very first commit every file is an addition.
  const all = JSON.parse(craton(A, "diff", first.from.slice(0, 8), "main", "--json"));
  assert.equal(all.to, first.to);
  assert.throws(() => craton(A, "diff", "no-such-thing"), /No branch or commit/);
});

test("revert records a new commit and restores the old bytes", () => {
  const original = createHash("sha256").update(dem()).digest("hex");
  const sha1 = craton(A, "log", "-n", "1").slice(0, 7);
  assert.match(craton(A, "revert", sha1), /Revert "Re-survey rows 600 to 640"/);
  assert.equal(sha(path.join(A, "terrain/basin_dem.tif")), original);
  assert.equal(craton(A, "log").trim().split("\n").length, 3, "history keeps all three commits");
  assert.match(craton(A, "push"), /Pushed main/);
  assert.match(craton(A, "fsck", "--verify"), /OK: 6 files re-hashed and verified/);
});

test("a stale clone can't overwrite newer history", () => {
  fs.appendFileSync(path.join(B, "gauges.csv"), "G9,2024-07-01T00:00Z,1.00,10.0\n");
  craton(B, "add", "gauges.csv");
  craton(B, "commit", "-m", "Add a reading");
  assert.throws(() => craton(B, "push"), /moved since you last pulled|append-only|Run `craton pull`/);
});

test("clone --tag checks out a release, and owner/repo works without a URL", async () => {
  // Release the first commit, before the re-survey and its revert.
  const log = craton(A, "log").trim().split("\n");
  const first = log[log.length - 1].slice(0, 7);
  const release = await api("POST", "/repos/alice/basin/releases", { tag: "v1.0.0", target: first, title: "First" }, token);
  assert.equal(release.tag, "v1.0.0", JSON.stringify(release));

  const out = craton(tmp, "clone", "alice/basin", "tagged", "--tag", "v1.0.0", "--server", server);
  assert.match(out, /Cloned alice\/basin \(6 files/);
  const T = path.join(tmp, "tagged");
  assert.equal(sha(path.join(T, "terrain/basin_dem.tif")), createHash("sha256").update(dem()).digest("hex"));
  assert.match(craton(T, "log"), new RegExp(`^${first}`));
  assert.match(craton(T, "fsck"), /OK: 6 files/);
  assert.throws(() => craton(tmp, "clone", "alice/basin", "nope", "--tag", "v9.9.9", "--server", server), /has no release v9\.9\.9/);
});

test("--help prints help and never runs the command", () => {
  const before = fs.readdirSync(tmp).sort();
  assert.match(craton(tmp, "init", "--help"), /^craton init \[folder\]/);
  assert.match(craton(tmp, "-h"), /version control for geospatial data[\s\S]*clone\s+Download a repository/);
  assert.deepEqual(fs.readdirSync(tmp).sort(), before, "init --help must not create a folder");
});

test("lock, locks and unlock from the CLI; a file someone else locked turns read-only until released", () => {
  const mine = path.join(A, "terrain/basin_dem.tif");
  const theirs = path.join(B, "terrain/basin_dem.tif");
  assert.ok(writable(mine) && writable(theirs));

  assert.match(craton(A, "lock", "terrain/basin_dem.tif", "--reason", "recalibrating"), /Locked terrain\/basin_dem\.tif \(recalibrating\)/);
  assert.match(craton(A, "locks"), /terrain\/basin_dem\.tif\s+you\s+recalibrating/);
  assert.ok(writable(mine), "your own lock never stops you editing");

  // Someone else working in their own clone sees the lock and can't save over the file by accident.
  const seen = cratonAs("bob", B, "locks");
  assert.match(seen, /terrain\/basin_dem\.tif\s+@alice\s+recalibrating/);
  assert.match(seen, /1 file is read-only here/);
  assert.ok(!writable(theirs), "locked by someone else: read-only");

  // Releasing it makes the file writable again for them.
  assert.match(craton(A, "unlock", "terrain/basin_dem.tif"), /Unlocked terrain\/basin_dem\.tif/);
  assert.match(cratonAs("bob", B, "locks"), /No files are locked/);
  assert.ok(writable(theirs), "released: writable again");

  assert.throws(() => craton(A, "unlock", "terrain/basin_dem.tif"), /No lock|not found|A lock on/i, "nothing to unlock");
  assert.throws(() => craton(A, "lock"), /Usage: craton lock/);
  assert.throws(() => craton(A, "lock", path.join(tmp, "elsewhere.txt")), /outside this repository/);
});

// The in-process test client reads a response whole; the real server streams it. These are the
// downloads that are streamed (a ZIP, a shared file, a shared ZIP), checked over real HTTP.
test("downloads stream correctly through the real server: ZIP, share link file and share link ZIP", async () => {
  const link = await api("POST", "/repos/alice/basin/share-links", { expiresInDays: 1, note: "streaming check" }, token);
  assert.match(link.token, /^bcn_share_/, JSON.stringify(link));
  const original = fs.readFileSync(path.join(A, "terrain/basin_dem.tif"));

  const get = async (p: string, auth?: string) => {
    const res = await fetch(`${server}/v1${p}`, { headers: auth ? { authorization: `Bearer ${auth}` } : {} });
    return { res, body: Buffer.from(await res.arrayBuffer()) };
  };
  const zipCount = (zip: Buffer) => zip.readUInt16LE(zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10);

  const repoZip = await get("/repos/alice/basin/archive/main", token);
  assert.equal(repoZip.res.status, 200, repoZip.body.toString().slice(0, 200));
  assert.equal(Number(repoZip.res.headers.get("content-length")), repoZip.body.length);
  assert.ok(zipCount(repoZip.body) >= 3);

  const file = await get(`/shared/${link.token}/file/terrain/basin_dem.tif`);
  assert.equal(file.res.status, 200, file.body.toString().slice(0, 200));
  assert.ok(file.body.equals(original), "the shared file is byte for byte the repository's");
  assert.equal(file.res.headers.get("etag"), null, "streamed downloads aren't hashed for an ETag");

  const sharedZip = await get(`/shared/${link.token}/archive`);
  assert.equal(sharedZip.res.status, 200, sharedZip.body.toString().slice(0, 200));
  assert.equal(Number(sharedZip.res.headers.get("content-length")), sharedZip.body.length);
  assert.equal(zipCount(sharedZip.body), zipCount(repoZip.body));

  const overview = await get(`/shared/${link.token}`);
  assert.equal(overview.res.status, 200);
  assert.ok(JSON.parse(overview.body.toString()).files.length >= 3);
  assert.equal(serverErrors.includes("disturbed or locked"), false, "the server logged no stream errors");
});

test("a sparse clone brings only some folders, commits and pushes without losing the rest, and can be widened", () => {
  const C = path.join(tmp, "c");
  const out = craton(tmp, "clone", `${server}/alice/basin`, "c", "--only", "vectors/,gauges.csv");
  assert.match(out, /Cloned alice\/basin \(\d+ of \d+ files, .* of .*; only vectors, gauges\.csv\)/);
  assert.ok(fs.existsSync(path.join(C, "vectors/catchment.shp")));
  assert.ok(fs.existsSync(path.join(C, "gauges.csv")));
  assert.ok(!fs.existsSync(path.join(C, "terrain/basin_dem.tif")), "the DEM was not downloaded");
  assert.match(craton(C, "sparse"), /Only these are in this folder: vectors, gauges\.csv/);

  // A sparse folder is not a folder full of deletions.
  const status = craton(C, "status");
  assert.match(status, /Nothing to commit/);
  assert.match(status, /Sparse checkout: 1 files outside vectors, gauges\.csv/);
  assert.match(craton(C, "add", "."), /Nothing new to stage/);
  assert.match(craton(C, "fsck"), /^OK:/);

  // Edit something inside the set, commit, push: the server's tree keeps the DEM.
  fs.appendFileSync(path.join(C, "gauges.csv"), "G9-Test,2030-01-01,3.1,55\n");
  craton(C, "add", ".");
  assert.match(craton(C, "status"), /modified\s+gauges\.csv/);
  assert.doesNotMatch(craton(C, "status"), /deleted\s+terrain/);
  craton(C, "commit", "-m", "Add a gauge reading from a sparse clone");
  assert.match(craton(C, "diff", "--json"), /gauges\.csv/);
  assert.doesNotMatch(craton(C, "diff", "--json"), /terrain\/basin_dem\.tif/, "the DEM is not part of this commit's change");
  craton(C, "push");

  const paths = (JSON.parse(execFileSync(process.execPath, ["-e", `fetch("${server}/v1/repos/alice/basin/paths/main",{headers:{authorization:"Bearer ${token}"}}).then(r=>r.json()).then(j=>console.log(JSON.stringify(j.files.map(f=>f.path))))`], { encoding: "utf8" })) as string[]);
  assert.ok(paths.includes("terrain/basin_dem.tif"), "the DEM is still in the repository");
  assert.ok(paths.includes("vectors/catchment.shp"));

  // Widening downloads exactly what was missing, and the bytes match the original.
  const added = craton(C, "sparse", "add", "terrain/");
  assert.match(added, /1 files brought into this folder/);
  assert.equal(sha(path.join(C, "terrain/basin_dem.tif")), sha(path.join(A, "terrain/basin_dem.tif")));
  assert.match(craton(C, "sparse"), /Only these are in this folder: vectors, gauges\.csv, terrain/);
  assert.throws(() => craton(C, "sparse", "add", "nonsense/"), /Nothing in this repository is called nonsense/);
  craton(C, "sparse", "all");
  assert.match(craton(C, "sparse"), /whole repository/);
  assert.match(craton(C, "status"), /Nothing to commit/);
});

test("a fresh clone of a repository with history can commit and push (older trees were never downloaded)", () => {
  const D = path.join(tmp, "d");
  craton(tmp, "clone", `${server}/alice/basin`, "d");
  fs.appendFileSync(path.join(D, "gauges.csv"), "G8-Test,2030-01-02,3.2,56\n");
  craton(D, "add", ".");
  craton(D, "commit", "-m", "from a full clone");
  assert.match(craton(D, "push"), /Pushed main/);
});

test("a clone that loses its connection leaves nothing half-written, and running it again resumes with the chunks already fetched", () => {
  const E = path.join(tmp, "e");
  const env = { ...process.env, CRATON_HOME: path.join(tmp, "home"), CRATON_TOKEN: token, CRATON_AUTHOR: "alice", CRATON_FAIL_AFTER_CHUNKS: "3" };
  const cli = path.join(root, "src/cli/craton.ts");
  assert.throws(
    () => execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", cli, "clone", `${server}/alice/basin`, "e"], { cwd: tmp, env, encoding: "utf8", stdio: "pipe" }),
    /connection was lost/,
  );
  const leftovers: string[] = [];
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.name === ".craton") continue;
      const full = path.join(dir, f.name);
      if (f.isDirectory()) walk(full);
      else leftovers.push(full);
    }
  };
  walk(E);
  assert.deepEqual(leftovers.filter((f) => f.endsWith(".tmp")), [], "no temporary files are left behind");
  assert.ok(fs.existsSync(path.join(E, ".craton", "fetched")), "downloaded chunks are kept for the retry");

  const again = craton(tmp, "clone", `${server}/alice/basin`, "e");
  assert.match(again, /Resuming an unfinished clone/);
  assert.match(again, /Cloned alice\/basin/);
  assert.equal(sha(path.join(E, "terrain/basin_dem.tif")), sha(path.join(A, "terrain/basin_dem.tif")));
  assert.ok(!fs.existsSync(path.join(E, ".craton", "fetched")), "the cache is cleared once the checkout is complete");
  assert.match(craton(E, "fsck", "--verify"), /^OK:/);
});

test("the Python SDK reads repositories, tables and raster statistics from the real server", () => {
  const sdk = path.resolve(root, "../sdk/python/check_sdk.py");
  let out: string;
  try {
    out = execFileSync("python", [sdk], { env: { ...process.env, CRATON_SERVER: server, CRATON_TOKEN: token }, encoding: "utf8" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return; // no Python on this machine: nothing to check
    throw e;
  }
  const r = JSON.parse(out);
  assert.equal(r.me, "alice");
  assert.deepEqual(r.repos, ["basin"]);
  assert.ok(r.paths.includes("terrain/basin_dem.tif") && r.paths.includes("gauges.csv"));
  assert.ok(r.rows >= 30 * 5, `${r.rows} rows`);
  assert.deepEqual(r.columns, ["station", "timestamp", "stage_m", "discharge_m3s"]);
  assert.ok(r.bytes > 1_000_000);
  assert.ok(r.commits >= 2);
  assert.ok(r.compare_changes.length >= 1);
  assert.equal(r.stats_has_change, true);
  assert.equal(r.openapi, "3.1.0");
  assert.deepEqual(r.missing, { status: 404, code: "not_found" });
  assert.equal(r.streamed_rows, r.rows, "streaming rows() yields the same rows as table()");
  assert.ok(r.all_commits >= r.commits, "all_commits() pages through the whole history");
  assert.equal(r.all_commits_sorted_newest_first, true);
  assert.equal(r.since_newest, 1, "since=<newest commit time> returns just that commit");
  assert.equal(r.second_commit_matches_page, true, "offset=1 is the second commit");
  assert.equal(r.issue_title, "From the SDK");
  assert.deepEqual([r.release_tag, r.release_prerelease], ["v9.9.0-sdk.1", true]);
  assert.deepEqual([r.lock_holder, r.lock_listed, r.lock_released], ["alice", true, true]);
  assert.equal(r.bad_tag_status, 400, "a malformed version is refused by the server and raised as CratonError");
});

test("blame names the commit behind each part of the DEM", () => {
  const text = craton(A, "blame", "terrain/basin_dem.tif");
  assert.match(text, /^terrain\/basin_dem\.tif at [0-9a-f]{7}: \d+ chunks?, /m);
  assert.match(text, /Initial import/);
  assert.match(text, /Re-survey rows 600 to 640/, "the partial re-survey owns its own strip");
  const json = JSON.parse(craton(A, "blame", "terrain/basin_dem.tif", "--json"));
  assert.equal(json.ranges[0].start, 0);
  assert.equal(json.ranges.at(-1).end, json.size);
  assert.throws(() => craton(A, "blame", "no/such/file.tif"), /isn’t on the server/);
});

test("log <path> lists only the commits that changed that file", () => {
  const dem = craton(A, "log", "terrain/basin_dem.tif");
  assert.match(dem, /Re-survey rows 600 to 640/);
  assert.match(dem, /Initial import/);
  assert.match(dem, / added +Initial import/);
  const gauges = craton(A, "log", "gauges.csv");
  assert.match(gauges, /Initial import/);
  assert.doesNotMatch(gauges, /Re-survey rows 600/, "a commit that did not touch gauges.csv is not listed");
  assert.throws(() => craton(A, "log", "no/such/file.csv"), /isn’t on the server/);
});

test("diff --text prints the changed lines of a text file", () => {
  craton(A, "pull"); // earlier tests pushed from other clones
  fs.writeFileSync(path.join(A, "notes.txt"), ["line one", "Manning n=0.035", "line three", ""].join(String.fromCharCode(10)));
  craton(A, "add", "notes.txt");
  craton(A, "commit", "-m", "Add notes");
  fs.writeFileSync(path.join(A, "notes.txt"), ["line one", "Manning n=0.042", "line three", ""].join(String.fromCharCode(10)));
  craton(A, "add", "notes.txt");
  craton(A, "commit", "-m", "Raise n");
  craton(A, "push");
  const text = craton(A, "diff", "--text", "notes.txt");
  assert.match(text, /^notes\.txt  [0-9a-f]{7} -> [0-9a-f]{7}  \+1 -1$/m);
  assert.match(text, /^-Manning n=0\.035$/m);
  assert.match(text, /^\+Manning n=0\.042$/m);
  assert.match(text, /^@@ -1,3 \+1,3 @@$/m);
  assert.throws(() => craton(A, "diff", "--text", "terrain/basin_dem.tif"), /too large|not text/);
});

test("status, log, branch and locks speak JSON for scripts", () => {
  const status = JSON.parse(craton(A, "status", "--json"));
  assert.equal(status.branch, "main");
  assert.match(status.commit, /^[0-9a-f]{64}$/);
  assert.equal(status.clean, true);
  assert.deepEqual([status.staged, status.modified, status.deleted, status.untracked], [[], [], [], []]);

  fs.writeFileSync(path.join(A, "scratch.txt"), "x");
  const dirty = JSON.parse(craton(A, "status", "--json"));
  assert.deepEqual(dirty.untracked, ["scratch.txt"]);
  assert.equal(dirty.clean, false);
  craton(A, "add", "scratch.txt");
  const staged = JSON.parse(craton(A, "status", "--json"));
  assert.deepEqual(staged.staged.map((s: any) => [s.path, s.change]), [["scratch.txt", "added"]]);
  fs.rmSync(path.join(A, "scratch.txt"));
  craton(A, "add", "scratch.txt");

  const log = JSON.parse(craton(A, "log", "-n", "2", "--json"));
  assert.equal(log.length, 2);
  assert.ok(log[0].sha && log[0].author && log[0].message && Array.isArray(log[0].parents));
  const fileLog = JSON.parse(craton(A, "log", "terrain/basin_dem.tif", "--json"));
  assert.ok(fileLog.some((h: any) => h.message === "Initial import"));

  const branches = JSON.parse(craton(A, "branch", "--json"));
  assert.ok(branches.some((b: any) => b.name === "main" && b.current === true));
  const locks = JSON.parse(craton(A, "locks", "--json"));
  assert.ok(Array.isArray(locks));
});

test("push and pull --json print one event per line", () => {
  craton(A, "pull");
  fs.writeFileSync(path.join(A, "events.txt"), "one");
  craton(A, "add", "events.txt");
  craton(A, "commit", "-m", "Add events.txt");
  const lines = craton(A, "push", "--json").trim().split(String.fromCharCode(10)).map((l) => JSON.parse(l));
  assert.equal(lines[0].event, "plan");
  assert.ok(lines[0].chunksToUpload >= 1 && lines[0].chunksTotal >= lines[0].chunksToUpload);
  const done = lines.at(-1);
  assert.equal(done.event, "done");
  assert.equal(done.updated, true);
  assert.equal(done.branch, "main");
  assert.ok(lines.some((l) => l.event === "upload" && l.done === l.total));
  // A second push has nothing to do.
  assert.equal(JSON.parse(craton(A, "push", "--json").trim().split(String.fromCharCode(10)).at(-1)!).updated, false);

  // Another clone catches up.
  const P = path.join(tmp, "pj");
  craton(tmp, "clone", `${server}/alice/basin`, "pj");
  fs.writeFileSync(path.join(A, "events.txt"), "two");
  craton(A, "add", "events.txt");
  craton(A, "commit", "-m", "Edit events.txt");
  craton(A, "push");
  const pulled = JSON.parse(craton(P, "pull", "--json").trim());
  assert.deepEqual([pulled.event, pulled.updated, pulled.filesUpdated], ["done", true, 1]);
  assert.equal(JSON.parse(craton(P, "pull", "--json").trim()).reason, "up_to_date");
});

test("exit codes: 0 for success, 1 for a failed job, 2 for a usage mistake; clone --json prints one done event", () => {
  const run = (cwd: string, ...args: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), ...args], { cwd, env: { ...process.env, CRATON_HOME: path.join(tmp, "home"), CRATON_TOKEN: token, CRATON_AUTHOR: "alice" }, encoding: "utf8" });
  assert.equal(run(A, "status").status, 0);
  assert.equal(run(A, "blame").status, 2, "no path given is a usage mistake");
  assert.equal(run(A, "frobnicate").status, 2, "an unknown command is a usage mistake");
  assert.equal(run(A, "diff", "no-such-thing").status, 1, "a bad reference is a failure");
  const cloned = run(tmp, "clone", `${server}/alice/basin`, "cj", "--json");
  assert.equal(cloned.status, 0, cloned.stderr);
  const done = JSON.parse(cloned.stdout.trim());
  assert.deepEqual([done.event, done.repository], ["done", "alice/basin"]);
  assert.ok(done.files >= 3 && done.bytesDownloaded > 0 && done.seconds >= 0);
});

test("doctor reports each check with its fix, and exits 1 only when something is broken", () => {
  const run = (cwd: string, env: Record<string, string>, ...args: string[]) =>
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), ...args], { cwd, env: { ...process.env, CRATON_HOME: path.join(tmp, "home"), CRATON_AUTHOR: "alice", ...env }, encoding: "utf8" });
  const good = run(A, { CRATON_TOKEN: token }, "doctor", "--json");
  assert.equal(good.status, 0, good.stdout + good.stderr);
  const report = JSON.parse(good.stdout);
  assert.equal(report.ok, true);
  const by = Object.fromEntries(report.checks.map((c: any) => [c.check, c]));
  assert.equal(by["Node.js"].status, "ok");
  assert.equal(by["Server"].status, "ok");
  assert.match(by["Server"].detail, /Craton \d+\.\d+\.\d+, API 1/);
  assert.equal(by["CLI version"].status, "ok");
  assert.match(by["Sign-in"].detail, /signed in as alice/);
  assert.match(by["Repository access"].detail, /alice\/basin: admin/);

  // A token the server does not know: the report says so and names the fix.
  const bad = run(A, { CRATON_TOKEN: "bcn_pat_not_a_real_token" }, "doctor");
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /FAIL\s+Sign-in\s+the saved token was not accepted/);
  assert.match(bad.stdout, /-> Create a new token/);

  // Outside a repository there is nothing to check but Node, and that is not a failure.
  const outside = run(os.tmpdir(), {}, "doctor");
  assert.equal(outside.status, 0);
  assert.match(outside.stdout, /warn\s+Repository/);
});

test("a private repository you cannot see is reported as not found, with where to look", async () => {
  await api("POST", "/repos", { name: "hidden", visibility: "private" }, token);
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), "clone", `${server}/alice/hidden`, "h-" + Math.random().toString(36).slice(2, 6)], { cwd: tmp, env: { ...process.env, CRATON_HOME: path.join(tmp, "nohome"), ...env }, encoding: "utf8" });
  const anon = run({ CRATON_TOKEN: "" });
  assert.equal(anon.status, 1);
  assert.match(anon.stderr, /alice\/hidden was not found\. If it is private, sign in first: craton auth login/);
  const wrong = run({ CRATON_TOKEN: "bcn_pat_not_a_real_token" });
  assert.equal(wrong.status, 1);
  assert.doesNotMatch(wrong.stderr, /sign in first/, "a token was sent, so the hint is about access, not about signing in");
  const real = run({ CRATON_TOKEN: token });
  assert.equal(real.status, 0, real.stderr);
});

test("a push containing a credential is refused with where it is, and an administrator can push past it with a reason", async () => {
  const key = ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
  fs.writeFileSync(path.join(A, "deploy.env"), `# deploy\nAWS_ACCESS_KEY_ID=${key}\n`);
  craton(A, "add", ".");
  craton(A, "commit", "-m", "Add deploy settings");
  let message = "";
  try {
    craton(A, "push");
  } catch (err) {
    message = String((err as { stderr?: Buffer | string }).stderr ?? err);
  }
  assert.match(message, /Nothing was pushed: an AWS access key id in deploy\.env line 2/);
  assert.match(message, /craton push --allow-secrets/);
  assert.ok(!message.includes(key), "the key is not printed");
  const refs = await api("GET", "/repos/alice/basin/refs", undefined, token);
  const before = refs.branches.find((b: any) => b.name === "main").commit_id;
  const pushed = craton(A, "push", "--allow-secrets", "a sandbox key, rotated every day");
  assert.match(pushed, /Pushed main:/);
  const after = (await api("GET", "/repos/alice/basin/refs", undefined, token)).branches.find((b: any) => b.name === "main").commit_id;
  assert.notEqual(after, before);
});

test("the Python fsspec filesystem reads a version of a file by byte range, lists folders and refuses writes", () => {
  const script = path.resolve(root, "../sdk/python/check_fsspec.py");
  let out: string;
  try {
    out = execFileSync("python", [script], { env: { ...process.env, CRATON_SERVER: server, CRATON_TOKEN: token }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: string };
    if (err.code === "ENOENT" || /No module named 'fsspec'/.test(String(err.stderr))) return; // no Python or no fsspec here: nothing to check
    throw new Error(`${err.message}\n${err.stderr}`);
  }
  const r = JSON.parse(out);
  assert.deepEqual(r.listing, [["terrain/basin_dem.tif", "file"]]);
  assert.ok(r.size > 100_000, `${r.size} bytes`);
  for (const k of ["size_ok", "middle_ok", "tail_ok", "head_ok", "sha_ok", "pair_ok", "negative_ok", "csv_ok", "isdir", "isfile", "readonly", "missing"]) assert.equal(r[k], true, k);
  assert.deepEqual(r.glob, ["alice/basin@main/vectors/catchment.shp"]);
});
