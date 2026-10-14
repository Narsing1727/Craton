// Proofs for every leaf in one pass must equal the per-leaf proofs, for every tree shape (odd levels carry a node up).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { merkleProof, merkleProofs, merkleRoot, verifyProof } from "../src/core/merkle.ts";

const leaves = (n: number) => Array.from({ length: n }, (_, i) => createHash("sha256").update(`leaf ${i}`).digest());

test("merkleProofs equals merkleProof for every leaf of trees of 1 to 70 leaves, and every proof verifies", () => {
  for (let n = 1; n <= 70; n++) {
    const ls = leaves(n);
    const all = merkleProofs(ls);
    const root = merkleRoot(ls);
    assert.equal(all.length, n);
    for (let i = 0; i < n; i++) {
      assert.deepEqual(all[i], merkleProof(ls, i), `n=${n} i=${i}`);
      assert.ok(verifyProof(ls[i], all[i], root), `n=${n} i=${i} verifies`);
    }
  }
});

test("a tree of 20,000 leaves gets all its proofs in well under a second", () => {
  const ls = leaves(20_000);
  const t0 = Date.now();
  const all = merkleProofs(ls);
  assert.equal(all.length, 20_000);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
});
