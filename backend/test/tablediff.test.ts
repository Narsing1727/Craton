// CSV reading and the table diff: quoted fields, key-based row matching, columns added and
// removed, numeric deltas, and the HTTP endpoint with its ETag.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { parseCsv, sniffDelimiter } from "../src/core/csv.ts";
import { diffTables } from "../src/services/tablediff.ts";

// ── The reader ─────────────────────────────────────────────────────────────

test("parseCsv handles quotes, doubled quotes, embedded commas and newlines, CRLF and a BOM", () => {
  const text = "﻿name,note,value\r\n\"Smith, J\",\"said \"\"hi\"\"\",1\r\nplain,\"two\nlines\",2\r\n";
  assert.deepEqual(parseCsv(text), [
    ["name", "note", "value"],
    ["Smith, J", 'said "hi"', "1"],
    ["plain", "two\nlines", "2"],
  ]);
});

test("parseCsv keeps empty fields, skips blank lines, and copes with a missing final newline and ragged rows", () => {
  assert.deepEqual(parseCsv("a,b,c\n1,,3\n\n4,5"), [["a", "b", "c"], ["1", "", "3"], ["4", "5"]]);
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("a,b\n"), [["a", "b"]]);
  assert.deepEqual(parseCsv('a,"unterminated\nstill'), [["a", "unterminated\nstill"]], "a stray quote never throws");
});

test("sniffDelimiter picks the separator from the header, ignoring ones inside quotes", () => {
  assert.equal(sniffDelimiter("a,b,c\n1,2,3"), ",");
  assert.equal(sniffDelimiter("a;b;c\n1;2;3"), ";");
  assert.equal(sniffDelimiter("a\tb\tc"), "\t");
  assert.equal(sniffDelimiter('"x,y,z";b;c'), ";");
  assert.deepEqual(parseCsv("a;b\n1;2", sniffDelimiter("a;b\n1;2")), [["a", "b"], ["1", "2"]]);
});

// ── The diff ───────────────────────────────────────────────────────────────

const csv = (rows: string[][]) => rows.map((r) => r.join(",")).join("\n") + "\n";
const HEAD = ["station", "timestamp", "stage_m", "discharge_m3s"];
const gauges = (extra: string[][] = []) =>
  csv([HEAD, ["G1", "2024-06-01", "2.10", "40.0"], ["G2", "2024-06-01", "3.20", "75.5"], ["G1", "2024-06-02", "2.30", "44.0"], ["G2", "2024-06-02", "3.40", "80.0"], ...extra]);

test("rows are matched by a unique key (here station + timestamp), so an insertion at the top is not a mass change", () => {
  const before = gauges();
  const after = csv([HEAD, ["G0", "2024-05-31", "1.00", "10.0"], ["G1", "2024-06-01", "2.10", "40.0"], ["G2", "2024-06-01", "3.20", "75.5"], ["G1", "2024-06-02", "2.30", "44.0"], ["G2", "2024-06-02", "3.40", "80.0"]]);
  const d = diffTables("a", "b", before, after);
  assert.deepEqual(d.matchedBy, { kind: "key", columns: ["station", "timestamp"] });
  assert.deepEqual(d.rows, { before: 4, after: 5, added: 1, removed: 0, changed: 0, unchanged: 4 });
  assert.deepEqual(d.added.map((r) => r.key), ["G0 · 2024-05-31"]);
});

test("a corrected reading shows the cell, both values and the numeric delta", () => {
  const after = gauges().replace("G2,2024-06-02,3.40,80.0", "G2,2024-06-02,3.55,84.5");
  const d = diffTables("a", "b", gauges(), after);
  assert.equal(d.rows.changed, 1);
  assert.equal(d.rows.unchanged, 3);
  assert.deepEqual(d.changed[0].key, "G2 · 2024-06-02");
  assert.deepEqual(d.changed[0].cells, [
    { column: "stage_m", before: "3.40", after: "3.55", delta: 0.15 },
    { column: "discharge_m3s", before: "80.0", after: "84.5", delta: 4.5 },
  ]);
  assert.equal(d.changed[0].row, 5, "row number in the file, counting the header as row 1");
});

test("removed rows, added columns and removed columns are reported separately", () => {
  const before = gauges();
  const after = csv([["station", "timestamp", "stage_m", "quality"], ["G1", "2024-06-01", "2.10", "good"], ["G2", "2024-06-01", "3.20", "good"]]);
  const d = diffTables("a", "b", before, after);
  assert.deepEqual(d.columns, { added: ["quality"], removed: ["discharge_m3s"], common: ["station", "timestamp", "stage_m"] });
  assert.equal(d.rows.removed, 2);
  assert.deepEqual(d.removed.map((r) => r.key), ["G1 · 2024-06-02", "G2 · 2024-06-02"]);
  assert.equal(d.rows.changed, 0, "a column that exists in only one version isn't a cell change");
});

test("a single unique column is preferred as the key, and a table with no unique key falls back to position", () => {
  const byId = diffTables("a", "b", csv([["id", "v"], ["a", "1"], ["b", "2"]]), csv([["id", "v"], ["b", "2"], ["a", "9"]]));
  assert.deepEqual(byId.matchedBy, { kind: "key", columns: ["id"] });
  assert.deepEqual(byId.rows, { before: 2, after: 2, added: 0, removed: 0, changed: 1, unchanged: 1 });

  const dup = diffTables("a", "b", csv([["g", "v"], ["x", "1"], ["x", "1"]]), csv([["g", "v"], ["x", "1"], ["x", "2"], ["x", "2"]]));
  assert.deepEqual(dup.matchedBy, { kind: "position" });
  assert.deepEqual(dup.rows, { before: 2, after: 3, added: 1, removed: 0, changed: 1, unchanged: 1 });
  assert.equal(dup.changed[0].key, "row 2");
});

test("quoted values with commas compare correctly, and non-numeric changes carry no delta", () => {
  const d = diffTables("a", "b", 'id,note\n1,"a, b"\n2,"c"\n', 'id,note\n1,"a, b"\n2,"c, d"\n');
  assert.equal(d.rows.changed, 1);
  assert.deepEqual(d.changed[0].cells, [{ column: "note", before: "c", after: "c, d", delta: null }]);
});

test("identical tables report nothing changed, and listings are capped but counted in full", () => {
  const same = diffTables("a", "b", gauges(), gauges());
  assert.deepEqual([same.rows.added, same.rows.removed, same.rows.changed, same.rows.unchanged], [0, 0, 0, 4]);
  assert.equal(same.truncated, false);

  const many = (v: string) => csv([["id", "v"], ...Array.from({ length: 300 }, (_, i) => [`r${i}`, v])]);
  const big = diffTables("a", "b", many("1"), many("2"));
  assert.equal(big.rows.changed, 300);
  assert.equal(big.changed.length, 100);
  assert.equal(big.truncated, true);
});

// ── The endpoint ───────────────────────────────────────────────────────────

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

const get = (path: string, who: string | null, headers: Record<string, string> = {}) =>
  app.request(`/v1${path}`, { headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...headers } });

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "ines"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private" }) });
  const owner = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'rhea'").get() as { id: number };
  const repo = getRepoFor(ctx, "rhea", "basin", owner.id);
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Gauges", timestamp: new Date(), changes: { "gauges.csv": Buffer.from(gauges()), "notes.txt": Buffer.from("hello") } });
  await commitFiles(ctx, repo, { branch: "fix", from: "main", author: "rhea", message: "Correct G2", timestamp: new Date(), changes: { "gauges.csv": Buffer.from(gauges().replace("3.40,80.0", "3.55,84.5")) } });
});

test("the endpoint returns the diff, with an ETag that answers a repeat request with a 304", async () => {
  const res = await get("/repos/rhea/basin/table-diff/fix/gauges.csv?base=main", "rhea");
  assert.equal(res.status, 200);
  const diff = (await res.json()) as ReturnType<typeof diffTables>;
  assert.equal(diff.rows.changed, 1);
  assert.deepEqual(diff.matchedBy, { kind: "key", columns: ["station", "timestamp"] });
  const tag = res.headers.get("etag");
  assert.match(tag ?? "", /^"[0-9a-f]{32}"$/);
  const again = await get("/repos/rhea/basin/table-diff/fix/gauges.csv?base=main", "rhea", { "if-none-match": tag! });
  assert.equal(again.status, 304);
});

test("the endpoint refuses a missing base, non-table files, unknown files, and strangers", async () => {
  assert.equal((await get("/repos/rhea/basin/table-diff/fix/gauges.csv", "rhea")).status, 400);
  assert.equal((await get("/repos/rhea/basin/table-diff/fix/notes.txt?base=main", "rhea")).status, 400);
  assert.equal((await get("/repos/rhea/basin/table-diff/fix/none.csv?base=main", "rhea")).status, 404);
  assert.equal((await get("/repos/rhea/basin/table-diff/fix/gauges.csv?base=main", "ines")).status, 404);
  assert.equal((await get("/repos/rhea/basin/table-diff/fix/gauges.csv?base=main", null)).status, 404);
});
