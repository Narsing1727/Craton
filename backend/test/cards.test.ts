// README starters: listed, applied as a first commit when a repository is created, filled only with what the
// repository declares, and refused when the template is unknown.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { cardReadme, findCard, listCards } from "../src/services/cards.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
let token = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await app.request(`/v1${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "mira", email: "mira@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
});

test("the templates are listed with a name and a sentence about each", async () => {
  const r = await call("GET", "/readme-templates");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.map((t: { id: string }) => t.id), ["hec-ras-model", "dem-survey", "rainfall-grids", "gis-layers"]);
  assert.ok(r.json.every((t: { name: string; about: string }) => t.name && t.about.length > 20));
});

test("a README is written from what the repository declares, and the rest stays as blanks to fill", () => {
  const text = cardReadme(findCard("dem-survey")!, { name: "kuttanad-lidar", owner: "mira", crs: "EPSG:32643", nodata: -9999, vertical_datum: null, license: "", description: "" });
  assert.match(text, /^# kuttanad-lidar/);
  assert.match(text, /\| Coordinate system \| EPSG:32643 \|/);
  assert.match(text, /\| Nodata value \| -9999 \|/);
  assert.match(text, /\| Vertical datum \| _not declared yet; set it in Settings_ \|/);
  assert.match(text, /## Accuracy/);
  assert.ok(!/EPSG:5\d\d\d/.test(text), "no datum is invented");
});

test("creating a private repository with a template makes a first commit holding the README", async () => {
  const made = await call("POST", "/repos", { name: "grids", visibility: "private", card: "rainfall-grids" });
  assert.equal(made.status, 201, made.text);
  const repo = await call("GET", "/repos/mira/grids");
  assert.equal(repo.status, 200);
  assert.equal(repo.json.commitCount, 1);
  assert.match(repo.json.readme, /## Coverage/);
  assert.match(repo.json.readme, /Coordinate system/);
});

test("an unknown template is refused and nothing is created", async () => {
  const bad = await call("POST", "/repos", { name: "nothing", visibility: "private", card: "made-up" });
  assert.equal(bad.status, 400);
  assert.equal((await call("GET", "/repos/mira/nothing")).status, 404);
  assert.equal(listCards().length, 4);
});
