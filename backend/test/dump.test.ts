// The logical dump the backup and restore scripts use: every table comes back, bytes stay bytes, ids are kept and the counters carry on
// after them, and a dump that fails halfway changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, SCHEMA_VERSION } from "../src/db/db.ts";
import { dumpDatabase, loadDump, tableOrder } from "../src/db/dump.ts";

async function seeded() {
  const db = await openDb(":memory:");
  const a = await db.insert("INSERT INTO owners (handle, kind, name) VALUES (?, 'user', ?)", "Maya", "Maya");
  await db.insert("INSERT INTO owners (handle, kind, name) VALUES (?, 'user', ?)", "noor", "noor");
  await db.run("INSERT INTO users (owner_id, email, password_hash) VALUES (?, ?, ?)", a, "maya@example.org", "x");
  await db.run("INSERT INTO passkeys (id, user_id, name, public_key, alg) VALUES (?, ?, ?, ?, ?)", "pk-1", a, "laptop", Buffer.from([0, 1, 2, 250, 255]), -7);
  return { db, userId: a };
}

test("a dump loads into another database with the same rows, bytes and ids, and new rows carry on after them", async () => {
  const { db, userId } = await seeded();
  const lines: string[] = [];
  const out = await dumpDatabase(db, (line) => void lines.push(line));
  assert.equal(JSON.parse(lines[0]).craton_dump, 1);
  assert.equal(out.perTable.owners, 2);
  assert.equal(out.perTable.passkeys, 1);

  const copy = await openDb(":memory:");
  const back = await loadDump(copy, lines, { currentVersion: SCHEMA_VERSION });
  assert.deepEqual(back.perTable, Object.fromEntries(Object.entries(out.perTable).filter(([, n]) => n > 0)));

  const key = await copy.get<{ public_key: Buffer; user_id: number }>("SELECT public_key, user_id FROM passkeys WHERE id = 'pk-1'");
  assert.deepEqual([...key!.public_key], [0, 1, 2, 250, 255]);
  assert.equal(key!.user_id, userId);
  const next = await copy.insert("INSERT INTO owners (handle, kind, name) VALUES (?, 'user', ?)", "later", "later");
  assert.ok(next > 2, `the identity counter moved past the loaded ids (got ${next})`);
  assert.equal((await copy.get<{ handle: string }>("SELECT handle FROM owners WHERE handle = 'MAYA'"))?.handle, "Maya", "handles stay case-insensitive");
  await db.close();
  await copy.close();
});

test("loading replaces what is there, and a dump that fails halfway leaves the database as it was", async () => {
  const { db } = await seeded();
  const lines: string[] = [];
  await dumpDatabase(db, (line) => void lines.push(line));
  const target = await openDb(":memory:");
  await target.insert("INSERT INTO owners (handle, kind, name) VALUES (?, 'user', ?)", "old-one", "old-one");

  const broken = [...lines.slice(0, 2), '{"t":"owners","rows":[{"id":1,"no_such_column":1}]}'];
  await assert.rejects(loadDump(target, broken, { currentVersion: SCHEMA_VERSION }));
  assert.deepEqual((await target.all<{ handle: string }>("SELECT handle FROM owners")).map((r) => r.handle), ["old-one"]);

  await loadDump(target, lines, { currentVersion: SCHEMA_VERSION });
  assert.deepEqual((await target.all<{ handle: string }>("SELECT handle FROM owners ORDER BY id")).map((r) => r.handle), ["Maya", "noor"]);
  await db.close();
  await target.close();
});

test("a file that is not a dump, or comes from a newer Craton, is refused before anything changes", async () => {
  const db = await openDb(":memory:");
  await db.insert("INSERT INTO owners (handle, kind, name) VALUES (?, 'user', ?)", "keep", "keep");
  await assert.rejects(loadDump(db, ['{"hello":1}'], { currentVersion: SCHEMA_VERSION }), /not a Craton dump/);
  await assert.rejects(loadDump(db, [JSON.stringify({ craton_dump: 1, schema_version: SCHEMA_VERSION + 1, tables: [] })], { currentVersion: SCHEMA_VERSION }), /newer Craton/);
  assert.equal((await db.get<{ n: number }>("SELECT COUNT(*) AS n FROM owners"))!.n, 1);
  await db.close();
});

test("tables are ordered with the ones others point at first", async () => {
  const db = await openDb(":memory:");
  const order = await tableOrder(db);
  assert.ok(order.indexOf("owners") < order.indexOf("users"));
  assert.ok(order.indexOf("repos") < order.indexOf("commits"));
  assert.ok(!order.includes("schema_version"));
  await db.close();
});
