// Structural checks on SWMM5 input files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSwmm } from "../src/checks/swmm.ts";

const GOOD = `
[TITLE]
Example network

[OPTIONS]
FLOW_UNITS CFS
LINK_OFFSETS DEPTH

[JUNCTIONS]
;;Name  Elevation MaxDepth InitDepth SurDepth Aponded
J1      100       5        0         0        0
J2      98        5        0         0        0

[OUTFALLS]
;;Name  Elevation Type  Stage Gate
Out1    96        FREE  NO

[CONDUITS]
;;Name From To Length Roughness InOffset OutOffset InitFlow MaxFlow
C1      J1   J2 400    0.013     0        0         0        0
C2      J2   Out1 300   0.013     0        0
`;

test("a consistent network has no problems and is counted", () => {
  const r = checkSwmm(GOOD);
  assert.deepEqual(r.problems, []);
  assert.equal(r.nodes, 3);
  assert.equal(r.links, 2);
});

test("a conduit to a node that is not defined is named", () => {
  const r = checkSwmm(GOOD.replace("C2      J2   Out1", "C2      J2   Ghost"));
  assert.deepEqual(r.problems, ["Conduit C2 uses node Ghost, which is not defined"]);
});

test("zero and negative lengths are refused, and an impossible drop is explained", () => {
  assert.deepEqual(checkSwmm(GOOD.replace("J1   J2 400", "J1   J2 0")).problems, ["Conduit C1 has a length of 0; a conduit needs a positive length"]);
  assert.match(checkSwmm(GOOD.replace("J1   J2 400", "J1   J2 -5")).problems[0], /length of -5/);
  // 100 down to 98 is a drop of 2; a 1 m conduit cannot drop 2.
  const steep = checkSwmm(GOOD.replace("J1   J2 400", "J1   J2 1"));
  assert.equal(steep.problems.length, 1);
  assert.match(steep.problems[0], /^Conduit C1 drops 2\.00 over a length of 1/);
});

test("offsets move the drop (depth offsets by default, elevations when the option says so)", () => {
  // Depth offsets: in 0, out 3 lowers the downstream end by 3, so the drop is 2 + 0 - 3 = -1 (an adverse slope, not an error here).
  assert.deepEqual(checkSwmm(GOOD.replace("J1   J2 400    0.013     0        0 ", "J1   J2 5      0.013     0        3 ")).problems, []);
  // Elevation offsets: inlet 100.0 and outlet 90.0 over 5 units is a drop of 10.
  const elevation = GOOD.replace("LINK_OFFSETS DEPTH", "LINK_OFFSETS ELEVATION").replace("J1   J2 400    0.013     0        0 ", "J1   J2 5      0.013     100      90");
  assert.match(checkSwmm(elevation).problems[0], /drops 10\.00 over a length of 5/);
});

test("a name used by two nodes, a link defined twice, and an outlet that is both node and subcatchment", () => {
  const dup = checkSwmm(GOOD.replace("Out1    96", "J2      96"));
  assert.ok(dup.problems.some((p) => /Node J2 is defined twice \(junctions and outfalls\)/.test(p)), dup.problems.join("|"));
  const twice = checkSwmm(GOOD.replace("C2      J2   Out1 300", "C1      J2   Out1 300"));
  assert.ok(twice.problems.some((p) => p === "Link C1 is defined twice"));
  const ambiguous = checkSwmm(GOOD + "\n[SUBCATCHMENTS]\nS1 RG1 J2 10 50 100 0.5 0\nJ2 RG1 J1 5 50 100 0.5 0\n");
  assert.ok(ambiguous.problems.some((p) => /Subcatchment S1 drains to J2, which is both a node and a subcatchment/.test(p)));
});

test("sections and keywords it does not know are left alone, comments and blank lines are ignored", () => {
  const r = checkSwmm(GOOD + "\n[REPORT]\nINPUT NO\n[SOMETHING_NEW]\nfoo bar\n;; end\n");
  assert.deepEqual(r.problems, []);
});
