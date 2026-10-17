import { test } from "node:test";
import assert from "node:assert/strict";
import { embedSnippets } from "../lib/embed.ts";

test("embed snippets point at the commit-pinned render URL and link back to the file at that commit", () => {
  const sha = "a".repeat(64);
  const s = embedSnippets("https://craton.nerolith.in", "hydrolab", "chalakudy", sha, "terrain/basin dem.tif", "basin dem.tif at aaaaaaa");
  assert.equal(s.image, `https://craton.nerolith.in/hydrolab/chalakudy/render/terrain/basin%20dem.tif?ref=${sha}&size=768`);
  assert.equal(s.page, `https://craton.nerolith.in/hydrolab/chalakudy/blob/terrain/basin%20dem.tif?ref=${sha}`);
  assert.equal(s.markdown, `[![basin dem.tif at aaaaaaa](${s.image})](${s.page})`);
  assert.match(s.html, /^<a href="https:\/\/craton\.nerolith\.in\/hydrolab\/chalakudy\/blob\//);
});

test("characters that would break the Markdown or HTML are removed from the alt text", () => {
  const s = embedSnippets("http://localhost:3100", "o", "r", "b".repeat(64), "x.tif", 'a "weird" [name] <b>');
  assert.ok(!/[\[\]"<>]/.test(s.markdown.slice(3, s.markdown.indexOf("]("))));
  assert.ok(!s.html.includes("<b>"));
});
