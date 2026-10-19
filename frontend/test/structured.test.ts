import { test } from "node:test";
import assert from "node:assert/strict";
import { structureOf, textKind } from "../lib/structured.ts";
import { parseMarkdown } from "../lib/markdown-blocks.ts";

test("a SWMM input is sections, with how many rows each holds and a few of them", () => {
  const text = ["[TITLE]", ";;Project", "Example", "", "[JUNCTIONS]", ";;Name Elev", "J1 10", "J2 12", "J3 9", "", "[CONDUITS]", "C1 J1 J2 100 0.013"].join("\n");
  const s = structureOf(text, "model.inp");
  assert.equal(s?.kind, "sections");
  if (s?.kind !== "sections") return;
  assert.deepEqual(s.sections.map((x) => [x.name, x.rows, x.line]), [["TITLE", 1, 1], ["JUNCTIONS", 3, 5], ["CONDUITS", 1, 11]]);
  assert.deepEqual(s.sections[1].sample, ["J1 10", "J2 12", "J3 9"]);
});

test("a HEC-RAS file is settings, whatever else is in it; a script is not", () => {
  const text = ["Geom Title=2D mesh", "Program Version=6.50", "Manning's n Main Channel=0.028", ...Array.from({ length: 50 }, (_, i) => `Cell ${i},632000.00,1130000.00`)].join("\n");
  const s = structureOf(text, "chalakudy.g01");
  assert.equal(s?.kind, "pairs");
  if (s?.kind !== "pairs") return;
  assert.equal(s.total, 3);
  assert.equal(s.others, 50);
  assert.deepEqual(s.pairs[2], { key: "Manning's n Main Channel", value: "0.028", line: 3 });
  assert.equal(structureOf("a=1\nb=2\nc=3\n", "script.py"), null);
  assert.equal(structureOf("one\ntwo\n", "notes.txt"), null);
});

test("a file's name says how to read it", () => {
  assert.equal(textKind("README.md"), "markdown");
  assert.equal(textKind("meta.JSON"), "json");
  assert.equal(textKind("area.geojson"), "json");
  assert.equal(textKind("model.g01"), "text");
});

test("markdown: headings, lists, code, tables and quotes are found; paragraphs join their lines", () => {
  const blocks = parseMarkdown(["# Title", "", "First line", "second line.", "", "- one", "- two", "  wrapped", "", "```py", "x = 1", "```", "", "| a | b |", "|---|--:|", "| 1 | 2 |", "", "> quoted", "", "---"].join("\n"));
  assert.deepEqual(blocks.map((b) => b.t), ["h", "p", "list", "code", "table", "quote", "hr"]);
  assert.deepEqual(blocks[1], { t: "p", text: "First line second line." });
  assert.deepEqual(blocks[2], { t: "list", ordered: false, items: ["one", "two wrapped"] });
  assert.deepEqual(blocks[3], { t: "code", text: "x = 1", lang: "py" });
  assert.deepEqual(blocks[4], { t: "table", head: ["a", "b"], rows: [["1", "2"]], align: ["left", "right"] });
});
