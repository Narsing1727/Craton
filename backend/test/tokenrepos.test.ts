// A personal access token limited to named repositories: it works inside them, and everywhere else it is
// no better than having no token (public data readable, private repositories hidden, writes refused).

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let app: ReturnType<typeof createApp>;
let ctx: Ctx;
let session = "";
let limited = "";
let free = "";

async function call(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "mira", email: "mira@example.org", password: "a-very-long-password" }) });
  session = ((await res.json()) as { token: string }).token;
  ctx.db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = 'mira')").run();
  for (const [name, visibility] of [["alpha", "private"], ["beta", "private"], ["gamma", "public"]] as const) {
    const r = await call("POST", "/repos", session, { name, visibility, sample: true });
    assert.equal(r.status, 201, r.text);
  }
  const a = await call("POST", "/user/tokens", session, { note: "alpha only", scopes: ["repo"], repos: ["mira/alpha"] });
  assert.equal(a.status, 201, a.text);
  limited = a.json.token;
  const b = await call("POST", "/user/tokens", session, { note: "everything", scopes: ["repo"] });
  free = b.json.token;
});

test("inside its repository the limited token reads and writes like any token", async () => {
  assert.equal((await call("GET", "/repos/mira/alpha", limited)).status, 200);
  assert.equal((await call("POST", "/repos/mira/alpha/locks", limited, { path: "model/plan.p01", reason: "test" })).status, 201);
  assert.equal((await call("GET", "/repos/mira/alpha/locks", limited)).status, 200);
});

test("outside it, a private repository is hidden and a write is refused, as with no token", async () => {
  assert.equal((await call("GET", "/repos/mira/beta", limited)).status, 404);
  assert.equal((await call("GET", "/repos/mira/beta", free)).status, 200, "an unlimited token still sees it");
  const write = await call("POST", "/repos/mira/beta/locks", limited, { path: "x.tif" });
  assert.ok([401, 403, 404].includes(write.status), `refused (${write.status})`);
  assert.equal((await call("GET", "/repos/mira/beta/locks", limited)).status, 404);
});

test("public data stays readable outside the limit, and the account's other routes are closed", async () => {
  assert.equal((await call("GET", "/repos/mira/gamma", limited)).status, 200);
  assert.equal((await call("GET", "/user/inbox", limited)).status, 401);
  assert.equal((await call("POST", "/repos", limited, { name: "sneaky", visibility: "public" })).status, 401);
  assert.equal((await call("GET", "/user", limited)).status, 200, "whoami still works");
});

test("the token list says what each token is limited to, and bad input is refused", async () => {
  const list = await call("GET", "/user/tokens", session);
  const alpha = (list.json as { note: string; repos: string[] | null }[]).find((t) => t.note === "alpha only")!;
  assert.deepEqual(alpha.repos, ["mira/alpha"]);
  assert.equal((list.json as { note: string; repos: string[] | null }[]).find((t) => t.note === "everything")!.repos, null);
  assert.equal((await call("POST", "/user/tokens", session, { note: "x", repos: ["not a repo"] })).status, 400);
  assert.equal((await call("POST", "/user/tokens", session, { note: "x", repos: ["mira/missing"] })).status, 404);
});
