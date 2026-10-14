// OPERATING.md is checked against the code: every setting the code reads is documented, every setting documented
// is read, and the commands it names exist.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const doc = fs.readFileSync(path.resolve(root, "../OPERATING.md"), "utf8");

function sourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : sourceFiles(path.join(dir, e.name))) : /\.(ts|tsx|mjs)$/.test(e.name) ? [path.join(dir, e.name)] : []));
}

/** Names of environment variables read anywhere in the backend's source and scripts. */
function variablesInCode(): Set<string> {
  const found = new Set<string>();
  const web = path.resolve(root, "../frontend");
  const dirs = [path.join(root, "src"), path.join(root, "scripts"), path.join(web, "app"), path.join(web, "lib"), path.join(web, "scripts")];
  for (const file of dirs.flatMap(sourceFiles)) {
    const text = fs.readFileSync(file, "utf8");
    for (const m of text.matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]+)\b/g)) found.add(m[1]);
    for (const m of text.matchAll(/env\[["']([A-Z][A-Z0-9_]+)["']\]/g)) found.add(m[1]);
  }
  return found;
}

// Set by the test runner or the shell, not settings of Craton.
const NOT_SETTINGS = new Set(["NODE_TEST_CONTEXT", "HOME", "USERPROFILE", "PATH", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP"]);

test("every setting the code reads is in OPERATING.md", () => {
  const missing = [...variablesInCode()].filter((v) => !NOT_SETTINGS.has(v) && !doc.includes(`\`${v}\``));
  assert.deepEqual(missing, [], `document these in OPERATING.md: ${missing.join(", ")}`);
});

test("every setting named in OPERATING.md is one the code reads", () => {
  const read = variablesInCode();
  const named = new Set([...doc.matchAll(/`((?:CRATON|EMAIL|R2)_[A-Z0-9_]+|PORT|NODE_ENV)`/g)].map((m) => m[1]));
  const unknown = [...named].filter((v) => !read.has(v));
  assert.deepEqual(unknown, [], `OPERATING.md names settings nothing reads: ${unknown.join(", ")}`);
  assert.ok(named.size >= 15, `${named.size} settings documented`);
});

test("the defaults it states are the defaults in config.ts", async () => {
  const { config } = await import("../src/config.ts");
  assert.ok(doc.includes("`PORT` | `4000`"), "port");
  assert.equal(config.port, 4000);
  assert.ok(doc.includes("`CRATON_API_RATE` | `1200`"));
  assert.equal(config.limits.api.max, 1200);
  assert.ok(doc.includes("`CRATON_UPLOAD_MAX_MB` | `100`"));
  assert.equal(config.upload.maxBytes, 100 * 1024 * 1024);
  assert.ok(doc.includes("`CRATON_LOCK_STALE_DAYS` | `7`"));
  assert.equal(config.locks.staleAfterDays, 7);
  assert.ok(doc.includes("`CRATON_WEB_URL` | `http://localhost:3100`"));
  assert.equal(config.webUrl, "http://localhost:3100");
});

test("the npm scripts it tells operators to run exist", () => {
  const scripts = (JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
  for (const name of ["start", "backup", "restore", "gc"]) {
    assert.ok(scripts[name], `npm run ${name} exists`);
    assert.ok(name === "start" || doc.includes(`npm run ${name}`), `${name} is documented`);
  }
});
