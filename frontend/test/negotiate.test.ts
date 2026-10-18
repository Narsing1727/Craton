import { test } from "node:test";
import assert from "node:assert/strict";
import { prefersMarkdown } from "../lib/negotiate.ts";

test("Markdown is chosen only when it is asked for at least as eagerly as HTML", () => {
  assert.equal(prefersMarkdown("text/markdown"), true);
  assert.equal(prefersMarkdown("text/markdown, text/html;q=0.8"), true);
  assert.equal(prefersMarkdown("text/markdown;q=0.9, text/html"), false);
  assert.equal(prefersMarkdown("text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"), false, "a browser");
  assert.equal(prefersMarkdown("*/*"), false, "a client that accepts anything gets the page");
  assert.equal(prefersMarkdown("text/markdown;q=0"), false);
  assert.equal(prefersMarkdown(null), false);
  assert.equal(prefersMarkdown("TEXT/Markdown"), true);
});

test("the proxy matcher lists every page that has a Markdown version", async () => {
  const fs = await import("node:fs");
  const { TWIN_PAGES } = await import("../lib/llms.ts");
  const proxy = fs.readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const matcher = proxy.match(/matcher: \[([^\]]*)\]/)![1];
  for (const p of TWIN_PAGES) assert.ok(matcher.includes(`"${p.path}"`), `${p.path} is in the matcher`);
  for (const p of TWIN_PAGES) assert.ok(fs.existsSync(new URL(`../app${p.path}.md/route.ts`, import.meta.url)), `${p.path}.md has a route`);
});
