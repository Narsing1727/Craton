// Webhooks: signed deliveries to a real local receiver, retries, the delivery log, event
// filtering, who may manage them, and that the server refuses to be pointed at private addresses.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, timingSafeEqual } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { putChunk } from "../src/services/chunks.ts";
import { getObject, registerObjects, resolveRef } from "../src/services/history.ts";
import { deliverDue, isBlockedAddress, sign, validateUrl } from "../src/services/webhooks.ts";
import { makeCommit, makeTree, objectId } from "../src/core/objects.ts";
import type { BlobObject, CommitObject, TreeObject } from "../src/core/objects.ts";
import { chunkBuffer, sha256Hex } from "../src/core/fastcdc.ts";
import { config } from "../src/config.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

type Received = { headers: http.IncomingHttpHeaders; body: string };
const received: Received[] = [];
let respondWith = 200;
let receiver: http.Server;
let receiverUrl = "";

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

const repoOf = () => getRepoFor(ctx, "rhea", "basin", ids.rhea);
const bytes = (s: string) => Buffer.from(s.repeat(1500));

/** Verify a delivery the way a receiver should: signature over id.timestamp.body, constant time, fresh timestamp. */
function verify(secret: string, r: Received) {
  const id = String(r.headers["webhook-id"]), ts = String(r.headers["webhook-timestamp"]);
  const expected = Buffer.from(sign(secret, id, Number(ts), r.body));
  const given = Buffer.from(String(r.headers["webhook-signature"]).split(" ").find((s) => s.startsWith("v1,")) ?? "");
  const same = expected.length === given.length && timingSafeEqual(expected, given);
  const fresh = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
  return same && fresh;
}

async function flush() {
  // The retry loop isn't running in tests; deliver whatever is due, as it would.
  await deliverDue(ctx);
}

/** Make a pending delivery due now, as if its backoff had passed. */
function makeDue() {
  ctx.db.prepare("UPDATE webhook_deliveries SET next_attempt_at = ? WHERE status = 'pending'").run(new Date(Date.now() - 1000).toISOString());
}

before(async () => {
  config.webhooks.allowPrivate = true; // the receiver below is on 127.0.0.1
  config.webhooks.autoDeliver = false; // deliver on demand, so each step can be checked
  receiver = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      received.push({ headers: req.headers, body });
      res.statusCode = respondWith;
      res.end("ok");
    });
  });
  await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hook`;

  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "sol", "ines"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ids[u] = (ctx.db.prepare("SELECT id FROM owners WHERE handle = ?").get(u) as { id: number }).id;
  }
  assert.equal((await call("POST", "/repos", "rhea", { name: "basin", visibility: "private" })).status, 201);
  ctx.db.prepare("INSERT INTO collaborators (repo_id, user_id, role) VALUES (?, ?, 'Write')").run(repoOf().id, ids.sol);
  await commitFiles(ctx, repoOf(), { branch: "main", author: "rhea", message: "Initial", timestamp: new Date(), changes: { "README.md": bytes("a") } });
});

after(async () => {
  config.webhooks.allowPrivate = false;
  config.webhooks.autoDeliver = true;
  await new Promise((r) => receiver.close(r));
});

// ── Pure pieces ────────────────────────────────────────────────────────────

test("the signature follows the Standard Webhooks scheme (id.timestamp.body, HMAC-SHA256, base64 key)", () => {
  // The worked example from the Standard Webhooks / Svix documentation.
  assert.equal(sign("whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw", "msg_p5jXN8AQM9LWM0D4loKWxJek", 1614265330, '{"test": 2432232314}'), "v1,g0hM9SsE+OTPJTGt/tmIKtSyZlE3uFJELVlNIOLJ1OE=");
  // And independently, with the primitives.
  const key = Buffer.from("c2VjcmV0LWJ5dGVz", "base64");
  assert.equal(sign("whsec_c2VjcmV0LWJ5dGVz", "msg_1", 1700000000, "{}"), `v1,${createHmac("sha256", key).update("msg_1.1700000000.{}").digest("base64")}`);
});

test("private, loopback, link-local and reserved addresses are blocked; public ones are not", () => {
  for (const a of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "ff02::1"]) {
    assert.equal(isBlockedAddress(a), true, `${a} must be blocked`);
  }
  for (const a of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
    assert.equal(isBlockedAddress(a), false, `${a} is public`);
  }
  assert.equal(isBlockedAddress("not-an-ip"), true, "anything that isn't an address is refused here");
});

test("URLs must be https and free of credentials; private targets are refused when not in development", () => {
  config.webhooks.allowPrivate = false;
  try {
    for (const bad of ["ftp://example.org/x", "http://example.org/x", "https://user:pw@example.org/x", "https://localhost/x", "https://127.0.0.1/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://10.0.0.1/x", "not a url"]) {
      assert.throws(() => validateUrl(bad), (e: any) => e.status === 400, bad);
    }
    assert.equal(validateUrl("https://hooks.example.org/craton").hostname, "hooks.example.org");
  } finally {
    config.webhooks.allowPrivate = true;
  }
});

// ── Managing webhooks ──────────────────────────────────────────────────────

let secret = "";
let hookId = 0;

test("an admin creates a webhook and sees the signing secret once; the list never shows it", async () => {
  const made = await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: ["push", "release", "pull_request"] });
  assert.equal(made.status, 201, made.text);
  assert.match(made.json.secret, /^whsec_[A-Za-z0-9+/]{43}=$/);
  secret = made.json.secret;
  hookId = made.json.id;

  const list = await call("GET", "/repos/rhea/basin/webhooks", "rhea");
  assert.deepEqual(list.json.events, ["push", "pull_request", "release", "issue", "lock"]);
  assert.equal(list.json.webhooks.length, 1);
  assert.ok(!list.text.includes(secret), "the secret is not in the list");
  assert.equal(list.json.webhooks[0].url, receiverUrl);
});

test("creating a webhook queues a signed ping, which a receiver can verify", async () => {
  received.length = 0;
  await flush();
  assert.equal(received.length, 1);
  const r = received[0];
  assert.equal(r.headers["content-type"], "application/json");
  assert.equal(r.headers["x-craton-event"], "ping");
  assert.match(String(r.headers["webhook-id"]), /^msg_[0-9a-f]{32}$/);
  assert.equal(JSON.parse(r.body).type, "ping");
  assert.equal(JSON.parse(r.body).repository.name, "basin");
  assert.ok(verify(secret, r), "the signature verifies with the secret");
  assert.ok(!verify("whsec_" + Buffer.from("someone else's secret").toString("base64"), r), "and not with another");
  const tampered = { ...r, body: r.body.replace("basin", "other") };
  assert.ok(!verify(secret, tampered), "a changed body fails");
});

test("a push is delivered with the branch, before and after, and the new commits", async () => {
  received.length = 0;
  const repo = repoOf();
  const tip = resolveRef(ctx, repo, "main");
  // Build a commit the way the CLI does, register it, then move the branch through the real endpoint.
  const data = bytes("b");
  const chunks = [];
  for (const s of chunkBuffer(data, config.chunking)) {
    const piece = data.subarray(s.offset, s.offset + s.length);
    const hash = sha256Hex(piece);
    await putChunk(ctx, repo, hash, Buffer.from(piece));
    chunks.push({ hash, size: s.length });
  }
  const blob: BlobObject = { type: "blob", size: data.length, sha256: sha256Hex(data), chunks };
  const parentTree = getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, tip, "commit").tree, "tree");
  const tree = makeTree([...parentTree.entries, { path: "notes.txt", blob: objectId(blob), size: data.length }]);
  const commit = makeCommit({ tree: objectId(tree), parents: [tip], author: "rhea", message: "Add notes", timestamp: new Date().toISOString() }, tree);
  registerObjects(ctx, repo, [blob, tree, commit]);
  const pushed = await call("POST", "/repos/rhea/basin/refs/heads/main", "rhea", { commit: objectId(commit), expected: tip });
  assert.equal(pushed.status, 200, pushed.text);

  await flush();
  const push = received.find((r) => r.headers["x-craton-event"] === "push");
  assert.ok(push, "a push event arrived");
  const body = JSON.parse(push!.body);
  assert.equal(body.type, "push");
  assert.equal(body.data.branch, "main");
  assert.equal(body.data.before, tip);
  assert.equal(body.data.after, objectId(commit));
  assert.equal(body.data.pusher, "rhea");
  assert.deepEqual(body.data.commits.map((c: any) => c.message), ["Add notes"]);
  assert.ok(verify(secret, push!));
});

test("a release and a pull request each produce their own event", async () => {
  received.length = 0;
  assert.equal((await call("POST", "/repos/rhea/basin/releases", "rhea", { tag: "v1.0.0", title: "First", target: "main" })).status, 201);
  await commitFiles(ctx, repoOf(), { branch: "feature", from: "main", author: "rhea", message: "Feature work", timestamp: new Date(), changes: { "feature.txt": bytes("c") } });
  const pr = await call("POST", "/repos/rhea/basin/pulls", "rhea", { title: "Add feature", source: "feature", target: "main" });
  assert.equal(pr.status, 201, pr.text);
  await flush();

  const release = received.find((r) => r.headers["x-craton-event"] === "release");
  assert.equal(JSON.parse(release!.body).data.tag, "v1.0.0");
  const opened = received.find((r) => r.headers["x-craton-event"] === "pull_request");
  const data = JSON.parse(opened!.body).data;
  assert.deepEqual([data.action, data.title, data.source, data.target], ["opened", "Add feature", "feature", "main"]);
  assert.equal(typeof data.number, "number");
});

test("issues and file locks have their own events, each delivered once and signed", async () => {
  const hook = await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: ["issue", "lock"] });
  assert.equal(hook.status, 201, hook.text);
  await flush(); // its ping
  received.length = 0;
  const issue = await call("POST", "/repos/rhea/basin/issues", "rhea", { title: "Datum mismatch", label: "bug" });
  assert.equal(issue.status, 201, issue.text);
  assert.equal((await call("PATCH", `/repos/rhea/basin/issues/${issue.json.number}`, "rhea", { title: "Datum mismatch (edited)" })).status, 200);
  assert.equal((await call("PATCH", `/repos/rhea/basin/issues/${issue.json.number}`, "rhea", { state: "closed" })).status, 200);
  assert.equal((await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "terrain/basin_dem.tif", reason: "re-tiling" })).status, 201);
  assert.equal((await call("DELETE", "/repos/rhea/basin/locks/terrain/basin_dem.tif", "rhea")).status, 204);
  await flush();

  const seen = received.map((r) => `${r.headers["x-craton-event"]}:${JSON.parse(r.body).data.action}`);
  assert.deepEqual(seen, ["issue:opened", "issue:closed", "lock:locked", "lock:unlocked"], "an edit of the title is not an event");
  assert.ok(received.every((r) => verify(hook.json.secret, r)), "every delivery verifies with the hook's secret");
  const locked = JSON.parse(received[2].body).data;
  assert.deepEqual([locked.path, locked.holder, locked.reason], ["terrain/basin_dem.tif", "rhea", "re-tiling"]);
  await call("DELETE", `/repos/rhea/basin/webhooks/${hook.json.id}`, "rhea");
});

test("a webhook only receives the events it asked for, and a paused one receives nothing", async () => {
  const only = await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: ["release"] });
  await flush(); // its ping
  received.length = 0;
  await call("PATCH", `/repos/rhea/basin/webhooks/${hookId}`, "rhea", { active: false });
  await call("POST", "/repos/rhea/basin/releases", "rhea", { tag: "v1.1.0", title: "Second", target: "main" });
  await commitFiles(ctx, repoOf(), { branch: "other", from: "main", author: "rhea", message: "More", timestamp: new Date(), changes: { "x.txt": bytes("d") } });
  await flush();
  const events = received.map((r) => r.headers["x-craton-event"]);
  assert.deepEqual(events, ["release"], "the release-only hook got the release; the paused hook got nothing");
  await call("PATCH", `/repos/rhea/basin/webhooks/${hookId}`, "rhea", { active: true });
  await call("DELETE", `/repos/rhea/basin/webhooks/${only.json.id}`, "rhea");
});

// ── Failure, retry and replay ──────────────────────────────────────────────

test("a failing receiver is retried with backoff, keeping the same message id and signing a fresh timestamp", async () => {
  received.length = 0;
  respondWith = 500;
  await call("POST", `/repos/rhea/basin/webhooks/${hookId}/ping`, "rhea");
  await flush();
  assert.equal(received.length, 1);

  let log = (await call("GET", `/repos/rhea/basin/webhooks/${hookId}/deliveries`, "rhea")).json;
  assert.equal(log[0].status, "pending", "not given up on");
  assert.equal(log[0].attempts, 1);
  assert.equal(log[0].responseCode, 500);
  assert.match(log[0].error, /answered 500/);
  assert.ok(new Date(log[0].nextAttemptAt).getTime() > Date.now() + 20_000, "the next attempt is backed off, not immediate");

  await flush();
  assert.equal(received.length, 1, "nothing is sent before the backoff has passed");

  respondWith = 200;
  makeDue();
  await new Promise((r) => setTimeout(r, 1100)); // so the second timestamp can differ
  await flush();
  assert.equal(received.length, 2);
  assert.equal(received[1].headers["webhook-id"], received[0].headers["webhook-id"], "retries reuse the message id so receivers can de-duplicate");
  assert.notEqual(received[1].headers["webhook-timestamp"], received[0].headers["webhook-timestamp"], "but each attempt is signed with a fresh timestamp");
  assert.ok(verify(secret, received[1]));

  log = (await call("GET", `/repos/rhea/basin/webhooks/${hookId}/deliveries`, "rhea")).json;
  assert.equal(log[0].status, "succeeded");
  assert.equal(log[0].attempts, 2);
  assert.ok(log[0].deliveredAt);
});

test("after the last attempt a delivery is marked failed, and can be replayed from the log", async () => {
  received.length = 0;
  respondWith = 503;
  await call("POST", `/repos/rhea/basin/webhooks/${hookId}/ping`, "rhea");
  for (let i = 0; i < 6; i++) {
    makeDue();
    await flush();
  }
  assert.equal(received.length, 6, "six attempts in all");
  let log = (await call("GET", `/repos/rhea/basin/webhooks/${hookId}/deliveries`, "rhea")).json;
  assert.equal(log[0].status, "failed");
  assert.equal(log[0].attempts, 6);
  makeDue();
  await flush();
  assert.equal(received.length, 6, "a failed delivery is not retried again by itself");

  respondWith = 200;
  assert.equal((await call("POST", `/repos/rhea/basin/webhooks/${hookId}/deliveries/${log[0].id}/redeliver`, "rhea")).status, 202);
  await flush();
  assert.equal(received.length, 7);
  log = (await call("GET", `/repos/rhea/basin/webhooks/${hookId}/deliveries`, "rhea")).json;
  assert.equal(log[0].status, "succeeded");
  assert.equal(received[6].headers["webhook-id"], received[0].headers["webhook-id"], "the replay keeps the original message id");
});

// ── Safety and permissions ─────────────────────────────────────────────────

test("a webhook saved in development cannot be used to reach a private address once that is no longer allowed", async () => {
  received.length = 0;
  respondWith = 200;
  await call("POST", `/repos/rhea/basin/webhooks/${hookId}/ping`, "rhea");
  config.webhooks.allowPrivate = false;
  try {
    await flush();
  } finally {
    config.webhooks.allowPrivate = true;
  }
  assert.equal(received.length, 0, "the receiver on 127.0.0.1 was never contacted");
  const log = (await call("GET", `/repos/rhea/basin/webhooks/${hookId}/deliveries`, "rhea")).json;
  assert.equal(log[0].status, "pending");
  assert.match(log[0].error, /private network/);
  makeDue();
  await flush(); // allowed again: now it goes through
  assert.equal(received.length, 1);
});

test("a hostname that resolves to a loopback address is blocked at delivery, not only an IP written out", async () => {
  received.length = 0;
  const named = receiverUrl.replace("127.0.0.1", "localhost");
  const made = await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: named, events: ["push"] }); // allowed while developing
  assert.equal(made.status, 201, made.text);
  config.webhooks.allowPrivate = false;
  try {
    await flush();
  } finally {
    config.webhooks.allowPrivate = true;
  }
  assert.equal(received.length, 0, "localhost resolved to this machine and was refused before connecting");
  const log = (await call("GET", `/repos/rhea/basin/webhooks/${made.json.id}/deliveries`, "rhea")).json;
  assert.match(log[0].error, /private network/);
  await call("DELETE", `/repos/rhea/basin/webhooks/${made.json.id}`, "rhea");
});

test("creating a webhook rejects private targets, unknown events and an empty event list", async () => {
  config.webhooks.allowPrivate = false;
  try {
    for (const url of ["http://169.254.169.254/latest", "https://127.0.0.1/hook", "https://localhost/hook", "http://example.org/hook"]) {
      const r = await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url, events: ["push"] });
      assert.equal(r.status, 400, url);
    }
  } finally {
    config.webhooks.allowPrivate = true;
  }
  assert.match((await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: ["push", "nope"] })).json.error.message, /“nope” isn’t an event/);
  assert.match((await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: [] })).json.error.message, /at least one event/);
});

test("only repository admins can see or change webhooks", async () => {
  assert.equal((await call("GET", "/repos/rhea/basin/webhooks", "sol")).status, 403, "a writer is not an admin");
  assert.equal((await call("POST", "/repos/rhea/basin/webhooks", "sol", { url: receiverUrl, events: ["push"] })).status, 403);
  assert.equal((await call("GET", `/repos/rhea/basin/webhooks/${hookId}/deliveries`, "sol")).status, 403);
  assert.equal((await call("GET", "/repos/rhea/basin/webhooks", "ines")).status, 404, "a stranger can't tell the repository exists");
  assert.equal((await call("GET", "/repos/rhea/basin/webhooks", null)).status, 404);
});

test("a repository can have at most ten webhooks, and deleting one removes its log", async () => {
  for (let i = 0; i < 9; i++) assert.equal((await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: `${receiverUrl}?n=${i}`, events: ["push"] })).status, 201);
  assert.match((await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: ["push"] })).json.error.message, /up to ten/);
  const list = (await call("GET", "/repos/rhea/basin/webhooks", "rhea")).json.webhooks;
  for (const h of list.filter((h: any) => h.id !== hookId)) await call("DELETE", `/repos/rhea/basin/webhooks/${h.id}`, "rhea");
  assert.equal((await call("DELETE", `/repos/rhea/basin/webhooks/${hookId}`, "rhea")).status, 204);
  assert.equal((await call("GET", `/repos/rhea/basin/webhooks/${hookId}/deliveries`, "rhea")).status, 404);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE webhook_id = ?").get(hookId) as { n: number }).n, 0);
});

test("the documented payload fields are exactly the fields that are delivered, for every event", async () => {
  const { EVENT_DOCS } = await import("../src/services/webhooks.ts");
  const hook = await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: ["push", "pull_request", "release", "issue", "lock"] });
  assert.equal(hook.status, 201, hook.text);
  await flush(); // its ping
  const ping = received.splice(0).filter((r) => r.headers["x-craton-event"] === "ping").pop();
  const seen = new Map<string, Set<string>>();
  const note = (r: Received) => {
    const body = JSON.parse(r.body);
    const set = seen.get(body.type) ?? seen.set(body.type, new Set()).get(body.type)!;
    for (const k of Object.keys(body.data)) set.add(k);
    for (const k of ["id", "type", "createdAt", "repository"]) assert.ok(k in body, `the envelope has ${k}`);
  };
  if (ping) note(ping);

  assert.equal((await call("PATCH", "/repos/rhea/basin", "rhea", { requireChecks: false })).status, 200);
  // push: through the browser upload route, which announces the push like a CLI push does
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes("payload doc"))], "payload.txt"));
  form.append("paths", JSON.stringify(["payload.txt"]));
  form.append("message", "Add payload.txt");
  const up = await app.request("/v1/repos/rhea/basin/upload", { method: "POST", headers: { authorization: `Bearer ${tokens.rhea}` }, body: form });
  assert.equal(up.status, 201, await up.text());
  // pull requests: opened, merged, closed
  await commitFiles(ctx, repoOf(), { branch: "doc-a", from: "main", author: "rhea", message: "A", timestamp: new Date(), changes: { "a.txt": bytes("a") } });
  await commitFiles(ctx, repoOf(), { branch: "doc-b", from: "main", author: "rhea", message: "B", timestamp: new Date(), changes: { "b.txt": bytes("b") } });
  const a = await call("POST", "/repos/rhea/basin/pulls", "rhea", { title: "A", source: "doc-a" });
  const b = await call("POST", "/repos/rhea/basin/pulls", "rhea", { title: "B", source: "doc-b" });
  assert.equal((await call("POST", `/repos/rhea/basin/pulls/${a.json.number}/merge`, "rhea")).status, 200);
  assert.equal((await call("POST", `/repos/rhea/basin/pulls/${b.json.number}/close`, "rhea")).status, 200);
  // release, issue (opened, closed, reopened), lock (locked, unlocked, forced)
  assert.equal((await call("POST", "/repos/rhea/basin/releases", "rhea", { tag: "v7.0.0", title: "Seven" })).status, 201);
  const issue = await call("POST", "/repos/rhea/basin/issues", "rhea", { title: "Doc", label: "question" });
  await call("PATCH", `/repos/rhea/basin/issues/${issue.json.number}`, "rhea", { state: "closed" });
  await call("PATCH", `/repos/rhea/basin/issues/${issue.json.number}`, "rhea", { state: "open" });
  await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "payload.txt", reason: "doc" });
  await call("DELETE", "/repos/rhea/basin/locks/payload.txt", "rhea");
  await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "payload.txt", reason: "again" });
  await call("DELETE", "/repos/rhea/basin/locks/payload.txt?force=true", "rhea");
  await flush();
  for (const r of received) note(r);

  for (const [event, doc] of Object.entries(EVENT_DOCS)) {
    const delivered = seen.get(event);
    assert.ok(delivered, `${event} was delivered`);
    const documented = new Set(Object.keys(doc.fields));
    assert.deepEqual([...delivered!].filter((k) => !documented.has(k)), [], `${event}: delivered but not documented`);
    const required = [...documented].filter((k) => !(doc.optional ?? []).includes(k));
    assert.deepEqual(required.filter((k) => !delivered!.has(k)), [], `${event}: documented as always present but not delivered`);
    // Optional fields really do show up for some action.
    assert.deepEqual((doc.optional ?? []).filter((k) => !delivered!.has(k)), [], `${event}: optional field never delivered`);
  }
  await call("DELETE", `/repos/rhea/basin/webhooks/${hook.json.id}`, "rhea");
});

test("a receiver that fails ten finished deliveries in a row is paused with a reason, and the admins are told once", async () => {
  // Start clean: only the hook under test receives events.
  const existing = (await call("GET", "/repos/rhea/basin/webhooks", "rhea")).json.webhooks as { id: number }[];
  for (const h of existing) await call("DELETE", `/repos/rhea/basin/webhooks/${h.id}`, "rhea");
  const hook = await call("POST", "/repos/rhea/basin/webhooks", "rhea", { url: receiverUrl, events: ["release"] });
  assert.equal(hook.status, 201, hook.text);
  respondWith = 200;
  await flush(); // the ping succeeds, so the run of failures starts after it
  received.length = 0;
  respondWith = 500;

  for (let i = 0; i < 10; i++) {
    assert.equal((await call("POST", "/repos/rhea/basin/releases", "rhea", { tag: `v8.0.${i}`, title: `Eight ${i}`, target: "main" })).status, 201);
  }
  // Each delivery is retried six times before it counts as failed.
  for (let round = 0; round < 7; round++) {
    makeDue();
    await flush();
  }
  const list = (await call("GET", "/repos/rhea/basin/webhooks", "rhea")).json.webhooks as { id: number; active: boolean; pausedReason: string | null }[];
  const mine = list.find((h) => h.id === hook.json.id)!;
  assert.equal(mine.active, false);
  assert.match(mine.pausedReason ?? "", /Paused automatically after 10 failed deliveries in a row\. Last error: /);

  const sent = ((await (await app.request("/v1/dev/outbox")).json()) as { kind: string; to: string; subject: string }[]).filter((m) => m.kind === "webhook-paused");
  assert.equal(sent.length, 1, "one email, not one per failure");
  assert.equal(sent[0].to, "rhea@example.org");
  assert.match(sent[0].subject, /Webhook paused: rhea\/basin/);

  // A paused webhook is sent nothing more, and a person can resume it, which clears the explanation.
  const before = received.length;
  await call("POST", "/repos/rhea/basin/releases", "rhea", { tag: "v8.1.0", title: "After", target: "main" });
  makeDue();
  await flush();
  assert.equal(received.length, before, "nothing is delivered to a paused webhook");
  const resumed = await call("PATCH", `/repos/rhea/basin/webhooks/${hook.json.id}`, "rhea", { active: true });
  assert.deepEqual([resumed.json.active, resumed.json.pausedReason], [true, null]);
  respondWith = 200;
  await call("DELETE", `/repos/rhea/basin/webhooks/${hook.json.id}`, "rhea");
});
