// The checks badge: an SVG for public repositories only, reflecting the default branch's latest check run.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { checksBadge, renderBadge } from "../src/services/badge.ts";

let app: ReturnType<typeof createApp>;
let ctx: Ctx;
let token = "";

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "mira", email: "mira@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  // Public repositories need a confirmed address.
  ctx.db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'mira')").run();
  for (const [name, visibility] of [["open", "public"], ["closed", "private"]] as const) {
    const r = await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name, visibility, sample: true }) });
    assert.equal(r.status, 201, await r.text());
  }
});

test("a public repository's badge is an SVG that says its checks pass, readable without signing in", async () => {
  const r = await app.request("/v1/repos/mira/open/badge/checks.svg");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /image\/svg\+xml/);
  const svg = await r.text();
  assert.match(svg, /^<svg /);
  assert.match(svg, /checks/);
  assert.match(svg, /passing/);
  assert.ok(!/<script/i.test(svg));
});

test("a private repository has no badge for anonymous or signed-in callers alike", async () => {
  assert.equal((await app.request("/v1/repos/mira/closed/badge/checks.svg")).status, 404);
  assert.equal((await app.request("/v1/repos/mira/closed/badge/checks.svg", { headers: { authorization: `Bearer ${token}` } })).status, 404);
});

test("the three states have their own words, and text is escaped", () => {
  assert.match(checksBadge("passed"), /passing/);
  assert.match(checksBadge("failed"), /failing/);
  assert.match(checksBadge(null), /none yet/);
  assert.ok(!renderBadge("a<b", '"x"&', "neutral").includes("<b"));
});

test("release, size and licence badges say what they should, anonymously, for public repositories only", async () => {
  const get = (p: string, auth = false) => app.request(`/v1/repos/mira/${p}`, auth ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  // No release yet, and no licence stated.
  let svg = await (await get("open/badge/release.svg")).text();
  assert.match(svg, /release/);
  assert.match(svg, /none yet/);
  assert.match(await (await get("open/badge/license.svg")).text(), /not stated/);
  const size = await (await get("open/badge/size.svg")).text();
  assert.match(size, /\d+(\.\d)? (MB|KB|GB)/);

  assert.equal((await app.request("/v1/repos/mira/open/releases", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ tag: "v2.1.0", title: "Two" }) })).status, 201);
  assert.equal((await app.request("/v1/repos/mira/open", { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ license: "CC-BY-4.0" }) })).status, 200);
  svg = await (await get("open/badge/release.svg")).text();
  assert.match(svg, /v2\.1\.0/);
  assert.match(await (await get("open/badge/license.svg")).text(), /CC-BY-4\.0/);

  for (const name of ["release", "size", "license"]) {
    assert.equal((await get(`closed/badge/${name}.svg`)).status, 404, `${name}: private`);
    assert.equal((await get(`closed/badge/${name}.svg`, true)).status, 404, `${name}: private, signed in`);
  }
});
