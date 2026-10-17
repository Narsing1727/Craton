import { test } from "node:test";
import assert from "node:assert/strict";
import { entriesFor, parseDictionary, starterDictionary, withEdits } from "../lib/dictionary.ts";

const text = JSON.stringify({ "gauges.csv": { stage_m: { description: "Water level above gauge datum", unit: "m" }, q: { description: "  " }, bad: 5 }, "x.csv": [], junk: "no" });

test("a dictionary is read tolerantly: only described columns survive", () => {
  const d = parseDictionary(text);
  assert.deepEqual(Object.keys(d["gauges.csv"]), ["stage_m"]);
  assert.deepEqual(d["gauges.csv"].stage_m, { description: "Water level above gauge datum", unit: "m" });
  assert.equal(d["x.csv"], undefined);
  assert.deepEqual(parseDictionary("not json"), {});
  assert.deepEqual(parseDictionary(null), {});
  assert.deepEqual(parseDictionary("[1,2]"), {});
});

test("entries follow the file's own column order and flag the undescribed ones", () => {
  const rows = entriesFor(parseDictionary(text), "gauges.csv", ["date", "stage_m", "q"]);
  assert.deepEqual(rows.map((r) => [r.column, r.entry !== null]), [["date", false], ["stage_m", true], ["q", false]]);
  assert.deepEqual(entriesFor({}, "other.csv", ["a"]), [{ column: "a", entry: null }]);
});

test("a starter keeps what is written, adds blanks for the rest, and leaves other files alone", () => {
  const out = JSON.parse(starterDictionary(parseDictionary(text), "gauges.csv", ["date", "stage_m"]));
  assert.deepEqual(out["gauges.csv"], { date: { description: "", unit: "" }, stage_m: { description: "Water level above gauge datum", unit: "m" } });
  assert.ok(!("x.csv" in out) || Array.isArray(out["x.csv"]) === false);
  const fresh = JSON.parse(starterDictionary({}, "a.csv", ["c1"]));
  assert.deepEqual(fresh, { "a.csv": { c1: { description: "", unit: "" } } });
});

test("edits keep other files and removed columns, drop emptied entries, and trim", () => {
  const dict = parseDictionary(JSON.stringify({ "a.csv": { x: { description: "old x", unit: "m" }, gone: { description: "column since removed" } }, "b.csv": { y: { unit: "s" } } }));
  const out = JSON.parse(withEdits(dict, "a.csv", ["x", "z"], { x: { description: "  new x  ", unit: "" }, z: { description: "", unit: "mm" } }));
  assert.deepEqual(out["a.csv"], { x: { description: "new x" }, z: { unit: "mm" }, gone: { description: "column since removed" } });
  assert.deepEqual(out["b.csv"], { y: { unit: "s" } }, "another file is untouched");
  // Clearing everything for a file removes it from the dictionary.
  const cleared = JSON.parse(withEdits(parseDictionary(JSON.stringify({ "a.csv": { x: { unit: "m" } } })), "a.csv", ["x"], { x: { description: "", unit: "" } }));
  assert.deepEqual(cleared, {});
  assert.ok(withEdits({}, "a.csv", ["x"], { x: { unit: "m" } }).endsWith("}" + String.fromCharCode(10)));
});
