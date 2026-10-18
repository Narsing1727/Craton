// Asking a specific person to review a pull request: it shows as waiting, reaches their inbox, and clears
// when they review. Only people who can write may ask, and only people who can see the repository can be asked.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const people = ["rhea", "sol", "ines", "kai"] as const;

async function call(method: string, path: string, who: string | null, body?: unknown) {
  const res = await app.request(`/v1${path}`, {
    method,
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}
type Item = { type: string; reason: string; actor: string; text: string; href: string; key: string };
const inbox = async (who: string) => ((await call("GET", "/user/inbox", who)).json as { items: Item[] }).items;

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of people) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ctx.db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(u);
  }
  assert.equal((await call("POST", "/repos", "rhea", { name: "basin", visibility: "private", sample: true })).status, 201);
  assert.equal((await call("PUT", "/repos/rhea/basin/collaborators/sol", "rhea", { role: "Write" })).status, 201);
  assert.equal((await call("PUT", "/repos/rhea/basin/collaborators/kai", "rhea", { role: "Read" })).status, 201);
  // Everyone opens their inbox once so the first-look baseline is set before the request below.
  for (const u of people) await inbox(u);
});

const PULL = "/repos/rhea/basin/pulls/1";

test("a request shows on the pull request and reaches the person's inbox", async () => {
  const r = await call("POST", `${PULL}/review-requests`, "rhea", { handle: "sol" });
  assert.equal(r.status, 201);
  assert.deepEqual(r.json.reviewRequests, ["sol"]);
  const items = await inbox("sol");
  const ask = items.find((i) => i.reason === "review");
  assert.ok(ask, "sol is asked");
  assert.equal(ask!.actor, "rhea");
  assert.match(ask!.text, /asked for your review on #1/);
  assert.equal(ask!.href, "/rhea/basin/pull/1");
  assert.ok(!(await inbox("kai")).some((i) => i.reason === "review"), "nobody else is told");
});

test("reviewing answers the request, in the pull request and in the inbox", async () => {
  const rv = await call("POST", `${PULL}/reviews`, "sol", { state: "approved", body: "Looks right" });
  assert.equal(rv.status, 200);
  assert.deepEqual(rv.json.reviewRequests, []);
  assert.ok(!(await inbox("sol")).some((i) => i.reason === "review"));
  // Asking again after a review starts a new request.
  const again = await call("POST", `${PULL}/review-requests`, "rhea", { handle: "sol" });
  assert.deepEqual(again.json.reviewRequests, ["sol"]);
  assert.ok((await inbox("sol")).some((i) => i.reason === "review"));
});

test("who may ask, and whom, is checked", async () => {
  assert.equal((await call("POST", `${PULL}/review-requests`, "kai", { handle: "sol" })).status, 403, "a reader can't ask");
  assert.equal((await call("POST", `${PULL}/review-requests`, "rhea", { handle: "ines" })).status, 400, "someone who can't see a private repository can't be asked");
  assert.equal((await call("POST", `${PULL}/review-requests`, "sol", { handle: "rhea" })).status, 400, "the author can't be asked to review their own work");
  assert.equal((await call("POST", `${PULL}/review-requests`, "rhea", { handle: "nobody-here" })).status, 404);
  assert.equal((await call("POST", `${PULL}/review-requests`, null, { handle: "sol" })).status, 401);
});

test("a request can be withdrawn", async () => {
  const gone = await call("DELETE", `${PULL}/review-requests/sol`, "rhea");
  assert.equal(gone.status, 200);
  assert.deepEqual(gone.json.reviewRequests, []);
  assert.ok(!(await inbox("sol")).some((i) => i.reason === "review"));
  assert.equal((await call("DELETE", `${PULL}/review-requests/sol`, "rhea")).status, 404);
});
