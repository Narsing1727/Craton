import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fitByGroup, fitStatistics } from "../src/core/fit.ts";

test("the fit module is the same code the website uses", () => {
  const here = fs.readFileSync(path.resolve(import.meta.dirname, "../src/core/fit.ts"), "utf8");
  const there = path.resolve(import.meta.dirname, "../../frontend/lib/fit.ts");
  if (fs.existsSync(there)) assert.equal(here, fs.readFileSync(there, "utf8"), "src/core/fit.ts and frontend/lib/fit.ts have drifted apart; copy one over the other");
});

test("a worked example and a per-station split give the same numbers as the website", () => {
  const f = fitStatistics([10, 20, 30, 40], [12, 18, 33, 37])!;
  assert.ok(Math.abs(f.nse! - 0.948) < 1e-9);
  const rows = [["A", "1", "1"], ["A", "2", "2"], ["B", "1", "3"], ["B", "2", "0"]];
  assert.deepEqual(fitByGroup(rows, 1, 2, 0).map((g) => g.name), ["A", "B"]);
});
