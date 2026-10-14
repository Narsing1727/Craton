// P0 trust and safety: stars, email confirmation, rate limits and lockout, token scopes, sessions,
// password change, export and deletion, plan limits, status, security headers, garbage collection.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { sentEmails } from "../src/services/email.ts";
import { collectGarbage } from "../src/services/gc.ts";
import { chunkBuffer, sha256Hex } from "../src/core/fastcdc.ts";
import { config } from "../src/config.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

async function call(method: string, path: string, who: string | null, body?: unknown, extra: Record<string, string> = {}, raw?: Buffer) {
  const headers: Record<string, string> = { ...extra };
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

const lastEmail = (to: string, kind: string) => [...sentEmails].reverse().find((m) => m.to === to && m.kind === kind);

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["olga", "pavel", "quinn"]) {
    const r = await call("POST", "/auth/signup", null, { username: u, email: `${u}@example.org`, password: "a-very-long-password" }, { "x-craton-client-ip": `10.0.0.${u.length}` });
    assert.equal(r.status, 201, r.text);
    tokens[u] = r.json.token;
  }
});

test("signup sends a confirmation email; publishing waits for it", async () => {
  assert.equal((await call("GET", "/user", "olga")).json.emailVerified, false);
  const blocked = await call("POST", "/repos", "olga", { name: "open-data", visibility: "public" });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error.code, "email_unverified");
  // Private work doesn't need it.
  assert.equal((await call("POST", "/repos", "olga", { name: "scratch", visibility: "private" })).status, 201);

  const mail = lastEmail("olga@example.org", "verify")!;
  assert.ok(mail.text.includes("verify-email?token=") && mail.html.includes("Confirm email address"));
  const token = mail.text.match(/token=(\S+)/)![1];
  assert.equal((await call("POST", "/auth/verify", null, { token })).status, 200);
  assert.equal((await call("GET", "/user", "olga")).json.emailVerified, true);
  assert.equal((await call("POST", "/repos", "olga", { name: "open-data", visibility: "public" })).status, 201);
  assert.equal((await call("POST", "/auth/verify", null, { token: "nope" })).status, 400);
});

test("stars are real and counted", async () => {
  assert.equal((await call("PUT", "/repos/olga/open-data/star", "pavel")).json.stars, 1);
  assert.equal((await call("PUT", "/repos/olga/open-data/star", "pavel")).json.stars, 1, "starring twice is one star");
  assert.equal((await call("PUT", "/repos/olga/open-data/star", "quinn")).json.stars, 2);
  assert.equal((await call("GET", "/repos/olga/open-data", "pavel")).json.starred, true);
  assert.equal((await call("GET", "/repos/olga/open-data", null)).json.starred, false);
  assert.deepEqual((await call("GET", "/owners/pavel/starred", null)).json.map((r: any) => r.name), ["open-data"]);
  assert.equal((await call("DELETE", "/repos/olga/open-data/star", "quinn")).json.stars, 1);
  // Private repositories can't be starred by people who can't see them.
  assert.equal((await call("PUT", "/repos/olga/scratch/star", "pavel")).status, 404);
});

test("failed sign-ins lock the account, and the API sends rate-limit headers", async () => {
  const ok = await call("GET", "/health", null);
  assert.ok(ok.headers.get("RateLimit-Limit"));
  assert.ok(ok.headers.get("X-Request-Id"));
  for (let i = 0; i < config.limits.lockout.max; i++) {
    assert.equal((await call("POST", "/auth/login", null, { login: "quinn", password: "wrong-password-!!" }, { "x-craton-client-ip": `172.16.0.${i}` })).status, 401);
  }
  const locked = await call("POST", "/auth/login", null, { login: "quinn", password: "a-very-long-password" }, { "x-craton-client-ip": "172.16.1.1" });
  assert.equal(locked.status, 429, "even the right password waits once the account is locked");
  assert.equal(locked.json.error.code, "account_locked");
});

test("sign-in from a new device emails the owner; sessions can be listed and revoked", async () => {
  const second = await call("POST", "/auth/login", null, { login: "pavel", password: "a-very-long-password" }, { "x-craton-client-ip": "198.51.100.9", "x-craton-user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130" });
  assert.equal(second.status, 200);
  tokens.pavelLaptop = second.json.token;
  const alert = lastEmail("pavel@example.org", "signin")!;
  assert.ok(alert && alert.text.includes("Chrome on Windows (198.51.100.9)"), alert?.text);

  const sessions = (await call("GET", "/user/sessions", "pavel")).json;
  assert.equal(sessions.length, 2);
  assert.equal(sessions.filter((s: any) => s.current).length, 1);
  const laptop = sessions.find((s: any) => s.ip === "198.51.100.9");
  assert.equal((await call("DELETE", `/user/sessions/${laptop.id}`, "pavel")).status, 204);
  assert.equal((await call("GET", "/user", "pavelLaptop")).status, 401);
});

test("token scopes are enforced, and tokens can't manage account security", async () => {
  const readOnly = await call("POST", "/user/tokens", "olga", { note: "ci read", scopes: ["read:repo"] });
  tokens.olgaRead = readOnly.json.token;
  assert.equal((await call("POST", "/user/tokens", "olga", { note: "x", scopes: ["everything"] })).status, 400);

  assert.equal((await call("GET", "/repos/olga/scratch", "olgaRead")).status, 200, "read scope sees private repos");
  const write = await call("POST", "/repos/olga/scratch/branches", "olgaRead", { name: "x", from: "main" });
  assert.equal(write.status, 403);
  assert.equal(write.json.error.code, "insufficient_scope");
  assert.equal((await call("GET", "/user/sessions", "olgaRead")).json.error.code, "session_required");
  assert.equal((await call("POST", "/user/tokens", "olgaRead", { note: "escalate", scopes: ["repo"] })).status, 403);

  const noRepo = await call("POST", "/user/tokens", "olga", { note: "org reader", scopes: ["read:org"] });
  tokens.olgaOrg = noRepo.json.token;
  assert.equal((await call("GET", "/repos/olga/scratch", "olgaOrg")).status, 404, "without repo scopes a token sees public data only");
});

test("changing the password needs the old one and signs out other sessions", async () => {
  const other = await call("POST", "/auth/login", null, { login: "olga", password: "a-very-long-password" });
  tokens.olgaOther = other.json.token;
  assert.equal((await call("POST", "/user/password", "olga", { current: "wrong", next: "another-long-password" })).status, 403);
  assert.equal((await call("POST", "/user/password", "olga", { current: "a-very-long-password", next: "another-long-password" })).status, 200);
  assert.equal((await call("GET", "/user", "olgaOther")).status, 401);
  assert.equal((await call("GET", "/user", "olga")).status, 200, "the session that changed it stays signed in");
});

test("private repository limit on the free plan", async () => {
  for (const n of ["p2", "p3"]) assert.equal((await call("POST", "/repos", "olga", { name: n, visibility: "private" })).status, 201);
  const fourth = await call("POST", "/repos", "olga", { name: "p4", visibility: "private" });
  assert.equal(fourth.status, 403);
  assert.equal(fourth.json.error.code, "private_repo_limit");
  const flip = await call("PATCH", "/repos/olga/open-data", "olga", { visibility: "private" });
  assert.equal(flip.json.error.code, "private_repo_limit");
});

test("storage limit refuses new chunks without deleting anything", async () => {
  const original = config.plans.free.storageBytes;
  (config.plans.free as { storageBytes: number }).storageBytes = 50_000;
  try {
    const data = Buffer.alloc(60_000, 7);
    const [span] = chunkBuffer(data, config.chunking);
    const piece = data.subarray(span.offset, span.offset + span.length);
    const r = await call("PUT", `/repos/olga/open-data/chunks/${sha256Hex(piece)}`, "olga", undefined, {}, Buffer.from(piece));
    assert.equal(r.status, 413);
    assert.equal(r.json.error.code, "storage_limit");
  } finally {
    (config.plans.free as { storageBytes: number }).storageBytes = original;
  }
});

test("export includes what the person wrote; deletion keeps conversations as @ghost", async () => {
  await call("POST", "/repos/olga/open-data/issues", "pavel", { title: "Datum question", body: "Which vertical datum?" });
  const exp = await call("GET", "/user/export", "pavel");
  assert.equal(exp.json.profile.handle, "pavel");
  assert.deepEqual(exp.json.issues.map((i: any) => i.title), ["Datum question"]);
  assert.ok(exp.json.stars.some((s: any) => s.repository === "olga/open-data"));

  assert.equal((await call("DELETE", "/user", "pavel", { handle: "pavel", password: "wrong" })).status, 403);
  assert.equal((await call("DELETE", "/user", "pavel", { handle: "pavle", password: "a-very-long-password" })).status, 400);
  assert.equal((await call("DELETE", "/user", "pavel", { handle: "pavel", password: "a-very-long-password" })).status, 204);
  const outbox = (await call("GET", "/dev/outbox", null)).json as { kind: string; to: string }[];
  assert.ok(outbox.some((m) => m.kind === "account-deleted" && m.to === "pavel@example.org"), "a last message confirms the deletion");
  assert.equal((await call("GET", "/user", "pavel")).status, 401);
  const issue = (await call("GET", "/repos/olga/open-data/issues", "olga")).json[0];
  assert.equal(issue.author, "ghost");
  assert.equal((await call("GET", "/repos/olga/open-data", "olga")).json.stars, 0, "their star went with them");
});

test("the only owner of an organization can't delete their account", async () => {
  await call("POST", "/orgs", "quinn", { handle: "quinn-lab" });
  const r = await call("DELETE", "/user", "quinn", { handle: "quinn", password: "a-very-long-password" });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, "sole_owner");
});

test("security headers on every API response", async () => {
  const r = await call("GET", "/health", null);
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
});

test("garbage collection only removes unreferenced chunks past the grace period", async () => {
  // A chunk uploaded but never committed (an abandoned push).
  const data = Buffer.from("orphan bytes ".repeat(100));
  const hash = sha256Hex(data);
  assert.equal((await call("PUT", `/repos/olga/open-data/chunks/${hash}`, "olga", undefined, {}, data)).status, 201);
  const dry = await collectGarbage(ctx, { apply: false, graceDays: 30 });
  assert.equal(dry.eligible, 0, "too new to collect");
  assert.ok(dry.inGracePeriod >= 1);
  const later = Date.now() + 31 * 86_400_000;
  const run = await collectGarbage(ctx, { apply: true, graceDays: 30, now: later });
  assert.ok(run.removed >= 1);
  assert.equal(await ctx.store.has(hash), false);
  assert.equal(ctx.db.prepare("SELECT 1 FROM chunks WHERE hash = ?").get(hash), undefined);
});

test("uploads never reveal whether someone else's private repository holds the same bytes", async () => {
  const secret = Buffer.from("survey control points, confidential ".repeat(50));
  const hash = sha256Hex(secret);
  assert.equal((await call("PUT", `/repos/olga/scratch/chunks/${hash}`, "olga", undefined, {}, secret)).json.deduplicated, false);
  // quinn uploads identical bytes to their own repository: told nothing about olga's.
  assert.equal((await call("POST", "/repos", "quinn", { name: "probe", visibility: "private" })).status, 201);
  const probe = await call("PUT", `/repos/quinn/probe/chunks/${hash}`, "quinn", undefined, {}, secret);
  assert.equal(probe.status, 201);
  assert.equal(probe.json.deduplicated, false);
  assert.deepEqual((await call("POST", "/repos/quinn/probe/chunks/missing", "quinn", { hashes: [sha256Hex(Buffer.from("other"))] })).json.missing.length, 1);
});

test("organization owners can rename it, and delete it once it has no repositories", async () => {
  // quinn-lab was created above; quinn is its only owner.
  assert.equal((await call("PATCH", "/orgs/quinn-lab", "quinn", { name: "Quinn Flood Lab", bio: "Delta models" })).json.name, "Quinn Flood Lab");
  assert.equal((await call("PATCH", "/orgs/quinn-lab", "olga", { name: "Taken over" })).status, 404, "non-members can't see it");
  assert.equal((await call("POST", "/repos", "quinn", { owner: "quinn-lab", name: "delta", visibility: "private" })).status, 201);
  const refused = await call("DELETE", "/orgs/quinn-lab", "quinn", { confirm: "quinn-lab" });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error.code, "has_repositories");
  assert.equal((await call("DELETE", "/repos/quinn-lab/delta", "quinn")).status, 204);
  assert.equal((await call("DELETE", "/orgs/quinn-lab", "quinn", { confirm: "wrong" })).status, 400);
  assert.equal((await call("DELETE", "/orgs/quinn-lab", "quinn", { confirm: "quinn-lab" })).status, 204);
  assert.equal((await call("GET", "/owners/quinn-lab", null)).status, 404);
});
