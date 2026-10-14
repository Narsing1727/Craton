// The API reference page on the website against the routes the server has: nothing listed that does not exist, and
// (reported, not failed) what exists but is not listed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";

async function served() {
  const app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const doc = (await (await app.request("/v1/openapi.json")).json()) as { paths: Record<string, Record<string, unknown>> };
  const ops = new Set<string>();
  for (const [p, methods] of Object.entries(doc.paths)) for (const m of Object.keys(methods)) ops.add(`${m.toUpperCase()} ${p.replace(/\{[^}]+\}/g, "{}")}`);
  return ops;
}

function listed(): { method: string; path: string }[] {
  const page = fs.readFileSync(path.resolve(import.meta.dirname, "../../frontend/app/api-reference/page.tsx"), "utf8");
  return [...page.matchAll(/method:\s*"([A-Z]+)",\s*path:\s*"([^"]+)"/g)].map((m) => ({ method: m[1], path: m[2] }));
}

/** A listed path may name several routes at once: "/badge/{release|size|license}.svg". */
/** The page writes a comparison as {base}...{head} and the two STAC files by name; the route has one parameter for each. */
function shape(p: string): string {
  return ("/" + p.replace(/^\/+/, "")).replace(/\{[^}]+\}\.\.\.\{[^}]+\}/, "{}").replace(/\/stac\/(collection|items)\.json$/, "/stac/{}").replace(/\{[^}]+\}/g, "{}");
}

function expand(p: string): string[] {
  const m = p.match(/\{([a-z]+(?:\|[a-z]+)+)\}/);
  return m ? m[1].split("|").map((alt) => p.replace(m[0], alt)) : [p];
}

test("every endpoint the API reference lists is a route the server has", async () => {
  const have = await served();
  const wrong: string[] = [];
  const entries = listed();
  assert.ok(entries.length > 100, `${entries.length} endpoints listed`);
  for (const e of entries) {
    for (const p of expand(e.path)) {
      const key = `${e.method} ${shape(p)}`;
      // The reference writes a splat as {path}; the server pattern is the same shape.
      if (!have.has(key)) wrong.push(key);
    }
  }
  assert.deepEqual(wrong, [], `listed but not served:\n${wrong.join("\n")}`);
});

test("every route the server has is on the API reference page, apart from health, readiness, the OpenAPI document and the dev outbox", async () => {
  const have = await served();
  const shown = new Set(listed().flatMap((e) => expand(e.path).map((p) => `${e.method} ${shape(p)}`)));
  const unlisted = [...have].filter((k) => !shown.has(k));
  // Routes that are internal on purpose, or documented by the OpenAPI document only.
  const quiet = (k: string) => /\/dev\/|\/openapi\.json|\/ready|\/health/.test(k);
  const missing = unlisted.filter((k) => !quiet(k));
  console.log(`# ${missing.length} routes are not on the API reference page yet:` + String.fromCharCode(10) + missing.join(String.fromCharCode(10)));
  assert.deepEqual(missing, [], "add these to the API reference page: " + missing.join(", "));
});
