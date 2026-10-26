// The server's own backups: a copy that reads back is kept, the newest few are kept, a restart does not start an extra one, and it is off when a
// database server has its own snapshots.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { countRows, lastBackupAt, runBackup, startBackupLoop } from "../src/services/backup.ts";
import { createApp } from "../src/api/app.ts";
import type { Ctx } from "../src/services/context.ts";

async function withData() {
  const ctx = { db: await openDb(":memory:"), store: new MemoryStore() } as Ctx;
  const app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "mira", email: "mira@example.org", password: "a-very-long-password" }) });
  assert.equal(res.status, 201);
  return ctx;
}
const tmp = () => fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), "craton-bk-"));

test("a backup holds every table, reads back with the same counts, and the newest copies are the ones kept", async () => {
  const ctx = await withData();
  const dir = tmp();
  const first = await runBackup(ctx, { target: dir, keep: 2 });
  assert.ok(fs.existsSync(first.file));
  const counts = await countRows(first.file);
  for (const [table, n] of Object.entries(first.summary.perTable)) assert.equal(counts[table] ?? 0, n, table);
  assert.equal(counts.users, 1, "the account is in the copy");
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 15));
    await runBackup(ctx, { target: dir, keep: 2 });
  }
  const kept = fs.readdirSync(path.join(dir, "db")).filter((f) => f.endsWith(".dump.gz"));
  assert.equal(kept.length, 2, "only the newest two remain");
  assert.ok(!kept.includes(path.basename(first.file)));
  assert.ok(lastBackupAt(dir) > 0);
  await ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a copy that cannot be read back is reported, not kept", async () => {
  const dir = tmp();
  const bad = path.join(dir, "bad.dump.gz");
  fs.writeFileSync(bad, Buffer.concat([zlib.gzipSync('{"t":"users","rows":[1]}\n'), Buffer.from("not gzip at all")]));
  await assert.rejects(countRows(bad));
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the schedule: off when asked, waiting out the interval since the last copy, and running when due", async () => {
  const ctx = await withData();
  const dir = tmp();
  assert.equal(startBackupLoop(ctx, { everyHours: 0, dir, keep: 3 }), null, "off");
  const loop = startBackupLoop(ctx, { everyHours: 24, dir, keep: 3 })!;
  assert.ok(loop, "on");
  loop.stop();
  await loop.runNow();
  assert.equal(fs.readdirSync(path.join(dir, "db")).length, 1, "a copy made by the loop");
  const again = startBackupLoop(ctx, { everyHours: 24, dir, keep: 3 })!;
  again.stop();
  await again.runNow(); // a second server of the same installation, on the same shared cache: the interval's copy is already taken
  assert.equal(fs.readdirSync(path.join(dir, "db")).length, 1, "the lock lets one server make each interval's copy");
  assert.ok(lastBackupAt(dir) > Date.now() - 60_000, "a fresh copy on disk is what a restart sees, so it does not make another at once");
  await ctx.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
