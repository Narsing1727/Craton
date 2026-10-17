// The real server code (upload, repack, download, clone path) on real data held in memory: stored bytes before and after
// storing each new version as a difference, and a byte-for-byte check of every download against the file uploaded.
//   node --disable-warning=ExperimentalWarning research/storage/end_to_end.mjs <file1> <file2> ... (same name uploaded as each version)
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createApp } from "../../backend/src/api/app.ts";
import { openDb } from "../../backend/src/db/db.ts";
import { MemoryStore } from "../../backend/src/storage/chunk-store.ts";
import { findRepo } from "../../backend/src/services/repos.ts";
import { repackCommit, verifyDifferences } from "../../backend/src/services/repack.ts";
import { getObject } from "../../backend/src/services/history.ts";
import { getStoredChunk } from "../../backend/src/services/chunks.ts";
import { decompressChunk } from "../../backend/src/core/compress.ts";

const ctx = { db: openDb(":memory:"), store: new MemoryStore() };
const app = createApp(ctx);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "alice", email: "alice@example.org", password: "a-very-long-password" }) });
const token = (await res.json()).token;
ctx.db.prepare("UPDATE users SET plan = 'team', email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run();
await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "dem", visibility: "private" }) });
const repo = findRepo(ctx, "alice", "dem");
const ext = process.argv[2].split(".").pop();
const name = `dem.${ext}`;
const mb = (n) => (n / 1048576).toFixed(2) + " MB";
const stored = (blob) => blob.chunks.reduce((n, c) => n + ctx.db.prepare("SELECT stored_size FROM chunks WHERE hash = ?").get(c.hash).stored_size, 0);
const uniqueStored = () => ctx.db.prepare("SELECT COALESCE(SUM(stored_size), 0) AS n FROM chunks").get().n;
const versions = [];
for (const [i, file] of process.argv.slice(2).entries()) {
  const data = readFileSync(file);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], name));
  form.append("paths", JSON.stringify([name]));
  form.append("message", `v${i}`);
  const up = await app.request("/v1/repos/alice/dem/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
  versions.push({ file, data, commit: (await up.json()).commit });
}
const today = uniqueStored();
console.log(`${versions.length} versions, ${mb(versions.reduce((n, v) => n + v.data.length, 0))} uploaded; stored today (every distinct chunk once): ${mb(today)}`);
for (const [i, v] of versions.entries()) {
  const t0 = Date.now();
  const r = await repackCommit(ctx, repo, v.commit);
  console.log(`v${i} ${v.file.split(/[\/]/).pop()}: ${r.chunks} chunks stored as differences, ${mb(r.savedBytes)} saved [${Date.now() - t0} ms]`);
}
let allIdentical = true, clientOk = true;
for (const v of versions) {
  const back = Buffer.from(await (await app.request(`/v1/repos/alice/dem/raw/${v.commit}/${name}`, { headers: { authorization: `Bearer ${token}` } })).arrayBuffer());
  if (sha(back) !== sha(v.data)) allIdentical = false;
  const tree = getObject(ctx, repo, getObject(ctx, repo, v.commit, "commit").tree, "tree");
  for (const c of getObject(ctx, repo, tree.entries[0].blob, "blob").chunks) {
    if (sha(decompressChunk(await getStoredChunk(ctx, repo, c.hash))) !== c.hash) clientOk = false;
  }
}
const after = uniqueStored();
const check = await verifyDifferences(ctx);
console.log(`stored after: ${mb(after)} (${(today / after).toFixed(2)}x less); every version downloads identical: ${allIdentical}; every chunk decodable by a client: ${clientOk}; ${check.checked} differences verified, ${check.bad.length} bad`);
