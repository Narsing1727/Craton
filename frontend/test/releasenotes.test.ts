import { test } from "node:test";
import assert from "node:assert/strict";
import { draftNotes } from "../lib/releasenotes.ts";

test("notes list the commits and the files, with how much of a changed file was rewritten", () => {
  const text = draftNotes({
    latestVersion: "v1.1.0",
    commits: [{ sha: "a1b2c3d4e5", message: "Re-survey rows 600 to 640\n\nlonger body", author: "priyam" }],
    files: [
      { path: "terrain/basin_dem.tif", change: "modified", chunksRewritten: 3, chunksTotal: 14 },
      { path: "vectors/levees.shp", change: "added" },
      { path: "old.csv", change: "removed" },
    ],
  });
  const lines = text.split(String.fromCharCode(10));
  assert.equal(lines[0], "Changes since v1.1.0:");
  assert.ok(lines.includes("- Re-survey rows 600 to 640 (a1b2c3d, priyam)"), "only the first line of a message");
  assert.ok(lines.includes("Files changed (3):"));
  assert.ok(lines.includes("- changed terrain/basin_dem.tif: 3 of 14 chunks rewritten"));
  assert.ok(lines.includes("- added vectors/levees.shp"));
  assert.ok(lines.includes("- removed old.csv"));
});

test("a first release, no commits and many files are said plainly", () => {
  assert.match(draftNotes({ latestVersion: null, commits: [], files: [] }), /^Changes:\n\n- \(no commits since the previous release\)$/);
  const many = Array.from({ length: 25 }, (_, i) => ({ path: `f${i}.tif`, change: "added" as const }));
  const text = draftNotes({ latestVersion: "v1.0.0", commits: [], files: many, maxFiles: 5 });
  assert.match(text, /Files changed \(25\):/);
  assert.match(text, /- and 20 more$/);
});
