import { test } from "node:test";
import assert from "node:assert/strict";
import { TWIN_PAGES, llmsTxt, skillMd, twinUrl } from "../lib/llms.ts";
import { COMMANDS } from "../../backend/src/cli/commands.ts";

const SITE = "https://craton.example";
const API = "https://api.craton.example";

test("llms.txt follows the llmstxt.org layout and links every page's Markdown version once", () => {
  const text = llmsTxt(`${SITE}/`, `${API}/`);
  const lines = text.split("\n");
  assert.equal(lines[0], "# Craton", "an H1 title first");
  assert.match(lines[2], /^> /, "then a one-paragraph summary as a block quote");
  for (const p of TWIN_PAGES) assert.equal(text.split(twinUrl(SITE, p.path)).length - 1, 1, `${p.path} is listed once`);
  assert.ok(text.includes(`${API}/v1/openapi.json`) && text.includes(`${SITE}/skill.md`) && text.includes(`${SITE}/llms-full.txt`));
  assert.ok(!text.includes("//skill.md") && !/[^:]\/\/v1/.test(text), "no doubled slashes from a trailing slash");
  for (const m of text.matchAll(/^- \[[^\]]+\]\((\S+)\): \S/gm)) assert.match(m[1], /^https:\/\//);
});

test("the skill file has front matter and only names commands that exist", () => {
  const text = skillMd(SITE, API);
  const front = text.match(/^---\nname: craton\ndescription: (.+)\n---\n/);
  assert.ok(front, "name and description in front matter");
  assert.ok(front![1].length < 1024);
  const known = new Set(COMMANDS.map((c) => c.name));
  const used = new Set([...text.matchAll(/^craton (\w+)/gm)].map((m) => m[1]));
  assert.ok(used.size >= 10);
  for (const name of used) assert.ok(known.has(name), `craton ${name} is a real command`);
  assert.ok(text.includes(`${API}/v1/openapi.json`));
});

test("the skill file's claims about the CLI's flags are in the CLI's own help", () => {
  const push = COMMANDS.find((c) => c.name === "push")!;
  assert.ok(push.options.some(([flag]) => flag.startsWith("--allow-secrets")));
  const json = ["push", "status", "log", "clone"].every((n) => COMMANDS.find((c) => c.name === n)!.options.some(([flag]) => flag.startsWith("--json")));
  assert.ok(json, "push, status, log and clone take --json");
});
