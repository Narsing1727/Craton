import { test } from "node:test";
import assert from "node:assert/strict";
import { buildChart, buildSeries, detectTimeColumn, niceTicks } from "../lib/timeseries.ts";

const header = ["station", "timestamp", "stage_m"];
const rows = [
  ["G1", "2024-06-01T00:00Z", "3.1"],
  ["G2", "2024-06-01T00:00Z", "2.0"],
  ["G1", "2024-06-02T00:00Z", "3.6"],
  ["G2", "2024-06-02T00:00Z", "x"],
  ["G1", "2024-06-03T00:00Z", "3.3"],
  ["G2", "2024-06-03T00:00Z", "2.4"],
];

test("the time column is the first one that is dates throughout", () => {
  assert.equal(detectTimeColumn(header, rows), 1);
  assert.equal(detectTimeColumn(["a", "b"], [["1", "x"], ["2", "y"], ["3", "z"]]), -1);
});

test("series are grouped by the chosen column, sorted by time, and skip non-numbers", () => {
  const s = buildSeries(rows, 1, 2, 0);
  assert.deepEqual(s.map((x) => x.name), ["G1", "G2"]);
  assert.deepEqual(s[0].points.map((p) => p.v), [3.1, 3.6, 3.3]);
  assert.deepEqual(s[1].points.map((p) => p.v), [2.0, 2.4], "the unreadable value is left out");
  assert.equal(buildSeries(rows, 1, 2, -1).length, 1, "without a grouping column it is one series");
});

test("long series are thinned to the limit and at most six are drawn", () => {
  const many = Array.from({ length: 5000 }, (_, i) => ["s", new Date(Date.UTC(2024, 0, 1) + i * 3600_000).toISOString(), String(i)]);
  assert.ok(buildSeries(many, 1, 2, -1, 6, 800)[0].points.length <= 800);
  const stations = Array.from({ length: 10 }, (_, i) => [`S${i}`, "2024-01-01", String(i)]);
  assert.equal(buildSeries(stations, 1, 2, 0).length, 6);
});

test("ticks are round numbers that cover the range", () => {
  assert.deepEqual(niceTicks(0, 10, 5), [0, 2.5, 5, 7.5, 10]);
  const t = niceTicks(2.07, 4.51);
  assert.ok(t[0] <= 2.07 && t[t.length - 1] >= 4.51);
  assert.deepEqual(niceTicks(3, 3), [3]);
});

test("the chart keeps every point inside the plot and puts the overlay first", () => {
  const cur = buildSeries(rows, 1, 2, 0);
  const before = [{ name: "G1", points: [{ t: Date.parse("2024-06-01T00:00Z"), v: 3.0 }, { t: Date.parse("2024-06-03T00:00Z"), v: 3.2 }] }];
  const c = buildChart(cur, before, 760, 240);
  assert.equal(c.empty, false);
  assert.equal(c.lines[0].overlay, true);
  assert.equal(c.lines.length, 3);
  const coords = c.lines.flatMap((l) => [...l.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]));
  assert.ok(coords.every(([x, y]) => x >= 52 && x <= 748 && y >= 10 && y <= 216));
  assert.equal(buildChart([], []).empty, true);
});
