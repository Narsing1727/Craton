import { test } from "node:test";
import assert from "node:assert/strict";
import { fitByGroup, fitStatistics, numericColumn, rateNse } from "../lib/fit.ts";

const close = (a: number | null, b: number, eps = 1e-9) => assert.ok(a !== null && Math.abs(a - b) < eps, `${a} vs ${b}`);

test("a perfect model scores 1 on NSE and KGE, with no error and no bias", () => {
  const f = fitStatistics([1, 2, 3, 4, 5], [1, 2, 3, 4, 5])!;
  close(f.nse, 1); close(f.kge, 1); close(f.pbias, 0); close(f.rmse, 0); close(f.mae, 0); close(f.r, 1);
});

test("predicting the mean of the observations gives NSE 0", () => {
  const f = fitStatistics([1, 2, 3, 4, 5], [3, 3, 3, 3, 3])!;
  close(f.nse, 0);
  assert.equal(f.r, null, "a constant series has no correlation");
});

test("a worked example: NSE, PBIAS, RMSE and MAE by hand", () => {
  // O = 10, 20, 30, 40; S = 12, 18, 33, 37: errors -2, 2, -3, 3
  const f = fitStatistics([10, 20, 30, 40], [12, 18, 33, 37])!;
  // SSE = 4+4+9+9 = 26; SST = 225+25+25+225 = 500; NSE = 1 - 26/500 = 0.948
  close(f.nse, 0.948);
  close(f.rmse, Math.sqrt(26 / 4));
  close(f.mae, 2.5);
  // sum(O - S) = 0 -> no bias
  close(f.pbias, 0);
  assert.equal(rateNse(f.nse), "Very good");
});

test("a model that is too low everywhere reports positive PBIAS (underestimation)", () => {
  const f = fitStatistics([10, 20, 30], [5, 10, 15])!;
  close(f.pbias, 50);
  close(f.r, 1);
  assert.ok(f.nse! < 0.5);
});

test("missing values are dropped pairwise, and too few pairs give nothing", () => {
  const f = fitStatistics([1, NaN, 3, 4], [1, 2, NaN, 4])!;
  assert.equal(f.n, 2);
  assert.equal(fitStatistics([1], [1]), null);
  assert.equal(fitStatistics([NaN, NaN], [1, 2]), null);
});

test("ratings follow the Moriasi bands, and columns are read as numbers", () => {
  assert.deepEqual([0.8, 0.7, 0.6, 0.4, null].map((v) => rateNse(v)), ["Very good", "Good", "Satisfactory", "Unsatisfactory", null]);
  assert.deepEqual(numericColumn([["1.5"], [" 2 "], ["x"], [""], ["-3e2"]], 0).map((v) => (Number.isNaN(v) ? "nan" : v)), [1.5, 2, "nan", "nan", -300]);
});

test("statistics per station come out of one table, largest group first", () => {
  const rows = [
    ["G1", "10", "10"], ["G1", "20", "21"], ["G1", "30", "29"],
    ["G2", "5", "9"], ["G2", "6", "2"],
    ["G3", "1", "x"],
  ];
  const by = fitByGroup(rows, 1, 2, 0);
  assert.deepEqual(by.map((g) => [g.name, g.fit.n]), [["G1", 3], ["G2", 2]], "a station with fewer than two usable pairs is left out");
  assert.ok(by[0].fit.nse! > 0.9);
  assert.ok(by[1].fit.nse! < 0, "G2 is worse than predicting its mean");
});
