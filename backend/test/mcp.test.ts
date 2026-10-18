// The MCP server: the tools answer "what changed since the last release" from real data, and the stdio
// transport speaks the protocol.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { blame, listFiles, listReleases, pullOwners, rasterStats, tableFit, textDiff, whatChanged, type Get, type GetText } from "../src/mcp/tools.ts";

let app: ReturnType<typeof createApp>;
let token = "";

const get: Get = async (p) => {
  const res = await app.request(`/v1${p}`, { headers: { authorization: `Bearer ${token}` } });
  const j = await res.json();
  if (!res.ok) throw new Error((j as { error?: { message?: string } }).error?.message ?? String(res.status));
  return j;
};

const getText: GetText = async (p) => {
  const res = await app.request(`/v1${p}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(String(res.status));
  return res.text();
};

before(async () => {
  const ctx: Ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  const post = (p: string, body: unknown) =>
    app.request(`/v1${p}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("/repos", { name: "basin", visibility: "private", sample: true })).status, 201);
  assert.equal((await post("/repos/rhea/basin/releases", { tag: "v1.0.0", title: "First release", notes: "Terrain and gauges." })).status, 201);
});

test("with no release named, the latest release is the starting point and the DEM change comes with numbers", async () => {
  const text = await whatChanged(get, "rhea", "basin", { until: "sample-resurvey" });
  assert.match(text, /^rhea\/basin: v1\.0\.0 \(the latest release, \d{4}-\d\d-\d\d\) -> sample-resurvey/);
  assert.match(text, /modified\s+terrain\/basin_dem\.tif \[DEM\]/);
  assert.match(text, /Re-survey the right bank/, "the commit message is listed");
  assert.match(text, /change: mean -[\d.]+, .*; 0\.0% of cells raised, [1-9][\d.]*% lowered/, "the sample re-survey lowers the right bank");
  assert.match(text, /net volume -\d+ m3/);
});

test("a filter narrows the file list, and no difference is said plainly", async () => {
  const none = await whatChanged(get, "rhea", "basin", { until: "sample-resurvey", filter: "gauges" });
  assert.match(none, /No changed file matches that filter\./);
  const same = await whatChanged(get, "rhea", "basin", { since: "main", until: "main" });
  assert.match(same, /0 commits since, 0 files changed\./);
  assert.match(same, /No files differ\./);
});

test("releases are listed, and a missing file is an error message rather than a crash", async () => {
  assert.match(await listReleases(get, "rhea", "basin"), /^v1\.0\.0 \(latest\)\s+\d{4}-\d\d-\d\d\s+First release/);
  await assert.rejects(() => rasterStats(get, "rhea", "basin", "terrain/missing.tif", "main", "sample-resurvey"), /missing\.tif|not found/i);
});

test("files are listed with their data type, and can be narrowed by type or by text", async () => {
  const all = await listFiles(get, "rhea", "basin");
  assert.match(all, /^rhea\/basin at main: \d+ files/);
  assert.match(all, /terrain\/basin_dem\.tif \[DEM\]/);
  const dems = await listFiles(get, "rhea", "basin", { filter: "dem" });
  assert.match(dems, /basin_dem\.tif/);
  assert.doesNotMatch(dems, /gauges\.csv/);
  assert.match(await listFiles(get, "rhea", "basin", { filter: "zzz" }), /No files matching "zzz" at main\./);
});

test("a gauge table is compared column against column, per station, from the stored file", async () => {
  const text = await tableFit(getText, "rhea", "basin", "gauges.csv", "main", "stage_m", "discharge_m3s", "station");
  assert.match(text, /^gauges\.csv at main: discharge_m3s against stage_m/);
  assert.match(text, /^all rows: \d+ pairs, NSE /m);
  assert.match(text, /^G1-/m, "each station has its own line");
  await assert.rejects(() => tableFit(getText, "rhea", "basin", "gauges.csv", "main", "nope", "stage_m"), /no column "nope"/);
  await assert.rejects(() => tableFit(getText, "rhea", "basin", "gauges.csv", "main", "stage_m", "stage_m"), /two different columns/);
});

test("blame names the commit behind a re-surveyed DEM, and a pull request with no CODEOWNERS says so", async () => {
  const text = await blame(get, "rhea", "basin", "terrain/basin_dem.tif", "sample-resurvey");
  assert.match(text, /^terrain\/basin_dem\.tif at sample-resurvey \([0-9a-f]{7}\): \d+ chunks?/);
  assert.match(text, /Re-survey the right bank/, "the re-survey commit owns its strip");
  await assert.rejects(() => blame(get, "rhea", "basin", "nope.tif"), /not found|File/i);
  assert.match(await pullOwners(get, "rhea", "basin", 1).catch((e) => String(e.message)), /No code owners|not found|Pull request/i);
});

test("a text diff names the changed lines, and says so when nothing changed", async () => {
  const same = await textDiff(get, "rhea", "basin", "README.md", "main", "main");
  assert.match(same, /no lines changed/);
  await assert.rejects(() => textDiff(get, "rhea", "basin", "terrain/basin_dem.tif", "main", "sample-resurvey"), /too large|not text|over 1 MB/i);
});

test("the stdio server lists its tools and reports a failed call as a result the assistant can read", async () => {
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.resolve(import.meta.dirname, "../src/mcp/server.ts")], {
    env: { ...process.env, CRATON_SERVER: "http://127.0.0.1:9" },
    stdio: ["pipe", "pipe", "inherit"],
  });
  const lines: any[] = [];
  let buf = "";
  const waiters: (() => void)[] = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (d: string) => {
    buf += d;
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      lines.push(JSON.parse(buf.slice(0, nl)));
      buf = buf.slice(nl + 1);
      waiters.splice(0).forEach((w) => w());
    }
  });
  const ask = async (msg: object, id: number) => {
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
    for (let i = 0; i < 200 && !lines.some((l) => l.id === id); i++) await new Promise<void>((r) => { waiters.push(r); setTimeout(r, 50); });
    return lines.find((l) => l.id === id);
  };
  try {
    const init = await ask({ id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "0" } } }, 1);
    assert.equal(init.result.serverInfo.name, "craton");
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
    const list = await ask({ id: 2, method: "tools/list" }, 2);
    assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ["craton_what_changed", "craton_list_releases", "craton_list_files", "craton_table_fit", "craton_blame", "craton_text_diff", "craton_pull_owners", "craton_raster_stats"]);
    assert.ok(list.result.tools.every((t: { inputSchema: { required: string[] } }) => t.inputSchema.required.includes("owner")));
    const missing = await ask({ id: 3, method: "tools/call", params: { name: "craton_list_releases", arguments: { owner: "rhea" } } }, 3);
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /Missing: repo/);
    const down = await ask({ id: 4, method: "tools/call", params: { name: "craton_list_releases", arguments: { owner: "rhea", repo: "basin" } } }, 4);
    assert.equal(down.result.isError, true, "an unreachable server is reported inside the result, not as a protocol error");
    const unknown = await ask({ id: 5, method: "nope" }, 5);
    assert.equal(unknown.error.code, -32601);
  } finally {
    child.kill();
  }
});
