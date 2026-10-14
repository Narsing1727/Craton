import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { matchesAny } from "../lib/globs.ts";

test("the lock-pattern matcher here is the same file as the backend's, so the page and the server agree", () => {
  const here = readFileSync(new URL("../lib/globs.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const there = readFileSync(new URL("../../backend/src/core/globs.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  assert.equal(here, there);
});

test("a file that must be locked is recognised", () => {
  assert.equal(matchesAny(["model/*.p0*", "*.gdb"], "model/plan.p01"), true);
  assert.equal(matchesAny(["model/*.p0*", "*.gdb"], "terrain/basin_dem.tif"), false);
});
