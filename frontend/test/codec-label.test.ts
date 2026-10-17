// How a stored form is described to people: plainly, and always as exact.

import { test } from "node:test";
import assert from "node:assert/strict";
import { codecLabel, codecLabels } from "../lib/format.ts";

test("each way a chunk can be stored has a plain label, and none of them suggests anything is lost", () => {
  for (const codec of ["none", "zstd", "records+zstd", "shuffle4+zstd", "delta4+shuffle4+zstd", "ref-delta", "tiles", "something-new"]) {
    const label = codecLabel(codec);
    assert.ok(label.length > 6, codec);
    assert.ok(/exact|uploaded/.test(label), `${codec}: ${label}`);
    assert.ok(!/lossy|approximate/.test(label));
  }
  assert.equal(codecLabel("none"), "kept as uploaded");
  assert.match(codecLabel("tiles"), /old version/);
  assert.match(codecLabel("ref-delta"), /difference from an earlier version/);
});

test("a file made of several forms lists each once", () => {
  assert.equal(codecLabels(["zstd", "tiles", "zstd", "none"]), "compressed, exact · old version kept as pixels, exact · kept as uploaded");
  assert.equal(codecLabels([]), "");
});
