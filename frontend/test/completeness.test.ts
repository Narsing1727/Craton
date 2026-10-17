import { test } from "node:test";
import assert from "node:assert/strict";
import { repoCompleteness } from "../lib/completeness.ts";

const full = { description: "Rainfall grids for the Chalakudy basin, 2018 to 2024", license: "CC-BY-4.0", topics: ["rainfall"], verticalDatum: 5703, nodata: -9999, footprint: [76, 10, 77, 11], hasRelease: true, hasReadme: true };

test("a fully described repository scores 100 and lists nothing to do", () => {
  const c = repoCompleteness(full);
  assert.equal(c.percent, 100);
  assert.equal(c.done, c.total);
  assert.ok(c.items.every((i) => i.done));
});

test("each missing piece is reported, and only that piece", () => {
  const c = repoCompleteness({ ...full, license: "", verticalDatum: null, hasRelease: false });
  assert.deepEqual(c.items.filter((i) => !i.done).map((i) => i.id), ["license", "datum", "release"]);
  assert.equal(c.done, 5);
  assert.equal(c.percent, 63);
});

test("a one-word description or empty topics do not count; a datum of zero does", () => {
  const c = repoCompleteness({ ...full, description: "data", topics: [], verticalDatum: 0, nodata: 0 });
  assert.deepEqual(c.items.filter((i) => !i.done).map((i) => i.id), ["description", "topics"]);
});

test("a brand new repository starts near zero", () => {
  const c = repoCompleteness({ description: "", license: "", topics: undefined, verticalDatum: null, nodata: null, footprint: null, hasRelease: false, hasReadme: false });
  assert.equal(c.done, 0);
  assert.equal(c.percent, 0);
});
