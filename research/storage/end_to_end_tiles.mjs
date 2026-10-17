// The cold tier on real DEFLATE GeoTIFF versions through the real server code: stored bytes today and with the cold tier, the cost
// of reading a cold version, and a byte-for-byte check of every version.
//   node --disable-warning=ExperimentalWarning research/storage/end_to_end_tiles.mjs v0.tif v1.tif v2.tif v3.tif  (the last is the tip)
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
const NAME = "data" + extname(process.argv[2]).replace(".h5", ".hdf");
process.env.CRATON_REPACK = "0";
const { createApp } = await import("../../backend/src/api/app.ts");
const { openDb } = await import("../../backend/src/db/db.ts");
const { FsStore } = await import("../../backend/src/storage/fs-store.ts");
const { findRepo } = await import("../../backend/src/services/repos.ts");
const { recodeRepository } = await import("../../backend/src/services/recode.ts");
const { verifyTiles, forgetRebuiltTiles } = await import("../../backend/src/services/tiles.ts");
const { getStoredChunk } = await import("../../backend/src/services/chunks.ts");
const { decompressChunk } = await import("../../backend/src/core/compress.ts");
const { getObject } = await import("../../backend/src/services/history.ts");

const dir = mkdtempSync(join(tmpdir(), "craton-tiles-"));
const ctx = { db: openDb(":memory:"), store: new FsStore(dir) };
const app = createApp(ctx);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const token = (await (await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) })).json()).token;
ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')").run();
await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "dem", visibility: "private" }) });
const repo = findRepo(ctx, "alice", "dem");
const mb = (n) => (n / 1048576).toFixed(2) + " MB";
const onDisk = (d) => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? onDisk(join(d, e.name)) : statSync(join(d, e.name)).size), 0);
const unique = () => ctx.db.prepare("SELECT COALESCE(SUM(stored_size), 0) AS n FROM chunks").get().n;

const versions = [];
for (const [i, file] of process.argv.slice(2).entries()) {
  const data = readFileSync(file);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], NAME));
  form.append("paths", JSON.stringify([NAME]));
  form.append("message", `v${i}`);
  const up = await app.request("/v1/repos/alice/dem/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  versions.push({ file, data, commit: (await up.json()).commit });
}
const today = unique();
const diskToday = onDisk(dir);
console.log(`${versions.length} versions, ${mb(versions.reduce((n, v) => n + v.data.length, 0))} uploaded; stored today: ${mb(today)} (on disk: ${mb(diskToday)})`);

let t0 = Date.now();
const r = await recodeRepository(ctx, repo);
const afterCold = unique();
console.log(`cold tier (tip left as uploaded): ${r.tiles} tiles kept as pixels, ${r.reused} reused, ${r.chunks} chunks rewritten in ${((Date.now() - t0) / 1000).toFixed(1)} s -> stored ${mb(afterCold)} (${(today / afterCold).toFixed(2)}x less)`);
const tilesKinds = ctx.db.prepare("SELECT kind, COUNT(*) AS n, SUM(stored_size) AS s FROM tiles GROUP BY kind").all();
console.log(`on disk now: ${mb(onDisk(dir))} (${(diskToday / onDisk(dir)).toFixed(2)}x less than before); the database says ${mb(afterCold)}`);
console.log("tiles:", tilesKinds.map((k) => `${k.n} ${k.kind === 1 ? "whole" : "as differences"} (${mb(k.s)})`).join(", "));

let ok = true;
for (const [i, v] of versions.entries()) {
  forgetRebuiltTiles();
  const t = Date.now();
  const back = Buffer.from(await (await app.request(`/v1/repos/alice/dem/raw/${v.commit}/${NAME}`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
  const same = sha(back) === sha(v.data);
  ok &&= same;
  console.log(`v${i} ${v.file.split(/[\/]/).pop()}: download ${same ? "identical" : "DIFFERENT"} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
}
let clientOk = true;
const tree = getObject(ctx, repo, getObject(ctx, repo, versions[1].commit, "commit").tree, "tree");
for (const c of getObject(ctx, repo, tree.entries[0].blob, "blob").chunks) if (sha(decompressChunk(await getStoredChunk(ctx, repo, c.hash))) !== c.hash) clientOk = false;
const check = await verifyTiles(ctx);
console.log(`every version identical: ${ok}; chunks of a cold version decodable by a client: ${clientOk}; ${check.checked} tiles rebuilt exactly, ${check.bad.length} bad`);
rmSync(dir, { recursive: true, force: true });
