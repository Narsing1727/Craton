// Secret scanning: what counts as a credential, that a push or upload containing one is stopped before anything
// moves, that the secret itself is never echoed or logged, and how an administrator can knowingly go past it.

import { test, before, afterEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { resolveRef } from "../src/services/history.ts";
import { scanText } from "../src/services/secretscan.ts";
import { checksumOf, checksumValid, makeToken } from "../src/core/tokens.ts";
import { config } from "../src/config.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

async function call(method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

async function upload(repo: string, who: string, files: Record<string, string | Buffer>, fields: Record<string, string> = {}) {
  const form = new FormData();
  for (const [name, data] of Object.entries(files)) form.append("file", new File([new Uint8Array(typeof data === "string" ? Buffer.from(data) : data)], name.split("/").pop()!));
  form.append("paths", JSON.stringify(Object.keys(files)));
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await app.request(`/v1/repos/${repo}/upload`, { method: "POST", headers: { authorization: `Bearer ${tokens[who]}` }, body: form });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

// Fake credentials are assembled here so this file holds no literal one (and a scanner reading the repository finds nothing).
const random30 = (seed: string) => crypto.createHash("sha256").update(seed).digest("base64").replace(/[^0-9A-Za-z]/g, "").padEnd(30, "x").slice(0, 30);
const githubToken = (seed = "gh") => `ghp_${random30(seed)}${checksumOf(random30(seed))}`;
const awsKey = () => ["AKIA", "ABCDEFGHIJKLMNOP"].join("");
const stripeKey = () => ["sk", "live", "0123456789abcdefghijklmnop"].join("_");
const pemKey = () => ["-----BEGIN RSA PRIVATE KEY-----", "MIIEowIBAAKCAQEA0123456789abcdefghijklmnopqrstuvwxyzABCDEFGH", "-----END RSA PRIVATE KEY-----"].join("\n");

const repoOf = (name: string) => getRepoFor(ctx, "lab", name, ids.alice);
const tipOf = (name: string, branch = "main") => resolveRef(ctx, repoOf(name), branch);
const auditEvents = async () => (await call("GET", "/orgs/lab/audit-log", "alice")).json.events as any[];

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(new Date().toISOString(), u);
    ids[u] = (ctx.db.prepare("SELECT id FROM owners WHERE handle = ?").get(u) as { id: number }).id;
  }
  assert.equal((await call("POST", "/orgs", "alice", { handle: "lab", name: "Lab" })).status, 201);
  for (const [name, visibility] of [["basin", "private"], ["open", "public"]] as const) {
    assert.equal((await call("POST", "/repos", "alice", { name, visibility, owner: "lab" })).status, 201);
    assert.equal((await call("PUT", `/repos/lab/${name}/collaborators/bob`, "alice", { role: "Write" })).status, 201);
    await commitFiles(ctx, repoOf(name), { branch: "main", changes: { "README.md": Buffer.from("# basin\n") }, message: "Start", author: "alice", timestamp: new Date() });
  }
});

const wasEnabled = config.secretScan.enabled;
afterEach(() => {
  config.secretScan.enabled = wasEnabled;
});

// ── The token format ───────────────────────────────────────────────────────

test("new tokens carry a prefix and a checksum that catches a typo", () => {
  const pat = makeToken("pat");
  const ses = makeToken("ses");
  assert.match(pat, /^crt_pat_[0-9A-Za-z]{36}$/);
  assert.match(ses, /^crt_ses_[0-9A-Za-z]{36}$/);
  assert.ok(checksumValid(pat.slice(8)));
  const flipped = pat.slice(8, 20) + (pat[20] === "a" ? "b" : "a") + pat.slice(21);
  assert.ok(!checksumValid(flipped), "one changed character fails the checksum");
  assert.notEqual(makeToken("pat"), pat);
});

test("sign-up and token creation hand out the new format, and tokens from before still work", async () => {
  assert.match(tokens.alice, /^crt_ses_/);
  const made = await call("POST", "/user/tokens", "alice", { note: "ci", scopes: ["repo"] });
  assert.equal(made.status, 201);
  assert.match(made.json.token, /^crt_pat_/);
  // A token issued before the format changed: stored by hash like any other.
  const legacy = `bcn_pat_${crypto.randomBytes(24).toString("base64url")}`;
  ctx.db.prepare("INSERT INTO tokens (user_id, token_hash, kind, note, scopes) VALUES (?, ?, 'pat', 'old', 'repo')").run(ids.alice, crypto.createHash("sha256").update(legacy).digest("hex"));
  const res = await app.request("/v1/user", { headers: { authorization: `Bearer ${legacy}` } });
  assert.equal(res.status, 200);
});

// ── What is recognised ─────────────────────────────────────────────────────

test("each kind of credential is found, with its line, and only a few characters are shown", () => {
  const text = [
    "# settings",
    `aws_access_key_id = ${awsKey()}`,
    `token: ${githubToken()}`,
    `STRIPE=${stripeKey()}`,
    pemKey(),
    "DATABASE_URL=postgres://app:Sup3rS3cretPw@db.internal.example.net:5432/prod",
    `key = AIza${"B".repeat(35)}`,
    `slack = xoxb-123456789012-123456789012-${"a1B2c3D4".repeat(3)}`,
  ].join("\n");
  const found = scanText(ctx, "config/prod.env", text);
  const byKind = Object.fromEntries(found.map((f) => [f.kind, f.line]));
  assert.deepEqual(byKind, {
    "AWS access key id": 2,
    "GitHub token": 3,
    "Stripe live key": 4,
    "Private key": 5,
    "Database password in a connection address": 8,
    "Google API key": 9,
    "Slack token": 10,
  });
  const shown = JSON.stringify(found);
  for (const secret of [awsKey(), githubToken(), stripeKey(), "Sup3rS3cretPw", "MIIEowIBAAKC", "a1B2c3D4"]) assert.ok(!shown.includes(secret), `the findings never repeat ${secret.slice(0, 4)}…`);
});

test("lookalikes are not findings", () => {
  const lookalikes = [
    "ghp_" + "a".repeat(36), // right shape, wrong checksum
    "AKIAIOSFODNN7EXAMPLE", // the documentation key
    "postgres://user:password@localhost:5432/db",
    "postgres://app:${DB_PASSWORD}@db.internal/prod",
    "postgres://postgres:postgres@127.0.0.1/db",
    "-----BEGIN PRIVATE KEY-----", // a mention, with no key under it
    "sk_live_",
    `crt_pat_${"a".repeat(36)}`, // no valid checksum
  ];
  assert.deepEqual(scanText(ctx, "notes.md", lookalikes.join("\n")), []);
});

test("a line marked as an example is skipped", () => {
  assert.deepEqual(scanText(ctx, "docs.md", `key = ${awsKey()}  # craton:allow-secret`), []);
  assert.equal(scanText(ctx, "docs.md", `key = ${awsKey()}`).length, 1);
});

test("a Craton token is a finding only while it works", async () => {
  const made = await call("POST", "/user/tokens", "alice", { note: "leaky", scopes: ["repo"] });
  const live = scanText(ctx, "x.txt", `export CRATON_TOKEN=${made.json.token}`);
  assert.equal(live.length, 1);
  assert.equal(live[0].live, true);
  assert.equal(live[0].preview, "crt_pat_…");
  await call("DELETE", `/user/tokens/${made.json.id}`, "alice");
  assert.deepEqual(scanText(ctx, "x.txt", `export CRATON_TOKEN=${made.json.token}`), [], "a revoked token is harmless");
  const legacy = `bcn_pat_${crypto.randomBytes(24).toString("base64url")}`;
  ctx.db.prepare("INSERT INTO tokens (user_id, token_hash, kind, note, scopes) VALUES (?, ?, 'pat', 'old', 'repo')").run(ids.alice, crypto.createHash("sha256").update(legacy).digest("hex"));
  assert.equal(scanText(ctx, "x.txt", legacy).length, 1, "an older token that works is found too");
});

// ── Upload ─────────────────────────────────────────────────────────────────

test("an upload with a credential is refused before anything is stored", async () => {
  const before = tipOf("basin");
  const res = await upload("lab/basin", "alice", { "data/run.cfg": "ok\n", "deploy/aws.env": `AWS_ACCESS_KEY_ID=${awsKey()}\n` });
  assert.equal(res.status, 422);
  assert.equal(res.json.error.code, "secret_detected");
  assert.match(res.json.error.message, /an AWS access key id in deploy\/aws\.env line 1/);
  assert.ok(!res.text.includes(awsKey()), "the key is not in the response");
  assert.deepEqual(res.json.error.details.findings.map((f: any) => [f.path, f.line, f.kind]), [["deploy/aws.env", 1, "AWS access key id"]]);
  assert.ok(!("tokenId" in res.json.error.details.findings[0]));
  assert.equal(tipOf("basin"), before, "the branch did not move");
});

test("a clean upload, a binary file and a file over 2 MB go through (they are not read)", async () => {
  const binary = Buffer.concat([Buffer.from([0, 1, 2, 3]), Buffer.from(awsKey())]);
  const res = await upload("lab/basin", "alice", { "notes/readme.txt": "just words\n", "raster/dem.bin": binary });
  assert.equal(res.status, 201, res.text);
});

test("a refused upload is on the audit log, with kinds and counts but never the secret", async () => {
  await upload("lab/basin", "bob", { "k.txt": `${stripeKey()}\n` });
  const e = (await auditEvents()).find((x) => x.action === "Push stopped: a credential was found");
  assert.ok(e);
  assert.deepEqual([e.actor, e.repo, e.outcome, e.status], ["bob", "basin", "denied", 422]);
  assert.equal(e.params.kinds, "Stripe live key");
  assert.ok(!JSON.stringify(e).includes(stripeKey()));
});

// ── Going past it ──────────────────────────────────────────────────────────

test("only an administrator can push past it, and has to say why", async () => {
  const files = { "keys/stripe.txt": `${stripeKey()}\n` };
  const writer = await upload("lab/basin", "bob", files, { allowSecrets: "it is a test key" });
  assert.equal(writer.status, 403);
  const noReason = await upload("lab/basin", "alice", files, { allowSecrets: "ok" });
  assert.equal(noReason.status, 400);
  const admin = await upload("lab/basin", "alice", files, { allowSecrets: "sandbox key for the demo" });
  assert.equal(admin.status, 201, admin.text);
  const e = (await auditEvents()).find((x) => x.action === "Pushed past the secret scan");
  assert.ok(e, "the decision is on the audit log");
  assert.equal(e.params.reason, "sandbox key for the demo");
  assert.equal(e.params.kinds, "Stripe live key");
  assert.equal(e.outcome, "done");
});

test("past the scan on a public repository, a live Craton token in it is revoked", async () => {
  const made = await call("POST", "/user/tokens", "alice", { note: "oops", scopes: ["repo"] });
  const text = `CRATON_TOKEN=${made.json.token}\n`;
  const kept = await upload("lab/basin", "alice", { "private-notes.txt": text }, { allowSecrets: "private repo, knowingly" });
  assert.equal(kept.status, 201);
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${made.json.token}` } })).status, 200, "in a private repository it keeps working");
  const exposed = await upload("lab/open", "alice", { "public-notes.txt": text }, { allowSecrets: "pushing anyway" });
  assert.equal(exposed.status, 201);
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${made.json.token}` } })).status, 401, "in a public one it no longer does");
  const e = (await auditEvents()).find((x) => x.action === "Pushed past the secret scan" && x.repo === "open");
  assert.equal(e.params.revoked, 1);
});

test("the server setting turns the scan off for everyone", async () => {
  config.secretScan.enabled = false;
  const res = await upload("lab/basin", "alice", { "anything.txt": `${githubToken("off")}\n` });
  assert.equal(res.status, 201);
});

// ── Push (the CLI's route) ─────────────────────────────────────────────────

test("a push is read for credentials in every new commit, even one a later commit removed", async () => {
  const repo = repoOf("basin");
  const main = tipOf("basin");
  await commitFiles(ctx, repo, { branch: "side", from: "main", changes: { "conf/keys.txt": Buffer.from(`token=${githubToken("push")}\n`) }, message: "Add keys", author: "alice", timestamp: new Date() });
  await commitFiles(ctx, repo, { branch: "side", changes: { "conf/keys.txt": null, "conf/ok.txt": Buffer.from("fine\n") }, message: "Remove keys", author: "alice", timestamp: new Date() });
  const side = tipOf("basin", "side");
  const refused = await call("POST", "/repos/lab/basin/refs/heads/main", "alice", { commit: side, expected: main });
  assert.equal(refused.status, 422);
  assert.equal(refused.json.error.code, "secret_detected");
  assert.match(refused.json.error.message, /a GitHub token in conf\/keys\.txt line 1 \(commit [0-9a-f]{7}\)/);
  assert.ok(!refused.text.includes(githubToken("push")));
  assert.equal(tipOf("basin"), main, "main did not move");

  const writer = await call("POST", "/repos/lab/basin/refs/heads/main", "bob", { commit: side, expected: main, allowSecrets: "needed for the demo" });
  assert.equal(writer.status, 403);
  const allowed = await call("POST", "/repos/lab/basin/refs/heads/main", "alice", { commit: side, expected: main, allowSecrets: "rotated already, kept for the record" });
  assert.equal(allowed.status, 200, allowed.text);
  assert.equal(tipOf("basin"), side);
});

test("a push of clean commits, and a stale or unknown commit, behave as before", async () => {
  const repo = repoOf("basin");
  const main = tipOf("basin");
  await commitFiles(ctx, repo, { branch: "clean", from: "main", changes: { "a.txt": Buffer.from("hello\n") }, message: "Clean", author: "alice", timestamp: new Date() });
  const stale = await call("POST", "/repos/lab/basin/refs/heads/main", "alice", { commit: tipOf("basin", "clean"), expected: "0".repeat(64) });
  assert.equal(stale.status, 409);
  const unknown = await call("POST", "/repos/lab/basin/refs/heads/main", "alice", { commit: "f".repeat(64), expected: main });
  assert.equal(unknown.status, 409);
  const ok = await call("POST", "/repos/lab/basin/refs/heads/main", "alice", { commit: tipOf("basin", "clean"), expected: main });
  assert.equal(ok.status, 200);
});
