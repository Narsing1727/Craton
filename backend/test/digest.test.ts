// The optional weekly digest: off by default, a week after switching it on, only for confirmed addresses, nothing when
// there is nothing, and an unsubscribe link that works without signing in and cannot be forged.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { sentEmails } from "../src/services/email.ts";
import { sendDue, unsubscribeToken } from "../src/services/digest.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};
const week = 7 * 24 * 3_600_000;

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
  return { status: res.status, json };
}
const digests = () => sentEmails.filter((e) => e.kind === "digest");

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ids[u] = (ctx.db.prepare("SELECT id FROM owners WHERE handle = ?").get(u) as { id: number }).id;
    ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = ?").run(new Date().toISOString(), ids[u]);
  }
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "public" })).status, 201);
});

test("it is off by default, can be turned on and off from the profile, and only those two values are accepted", async () => {
  assert.equal((await call("GET", "/user", "alice")).json.digest, "off");
  assert.equal((await call("PATCH", "/user", "alice", { digest: "daily" })).status, 400);
  assert.equal((await call("PATCH", "/user", "alice", { digest: "weekly" })).json.digest, "weekly");
  await call("PATCH", "/user", "carol", { digest: "weekly" });
});

test("nothing is sent the day it is switched on, nor when there is nothing new, but a week later what is unread goes out once", async () => {
  assert.equal(await sendDue(ctx), 0, "not due yet");
  // Other people do things in alice's repository; carol has none of her own, so nothing concerns her.
  assert.equal((await call("POST", "/repos/alice/basin/issues", "bob", { title: "Gauge 4 drifting <script>", label: "bug" })).status, 201);
  assert.equal((await call("POST", "/repos/alice/basin/issues/1/comments", "bob", { body: "Hey @alice can you look at this?" })).status, 201);
  const later = new Date(Date.now() + week + 60_000);
  assert.equal(await sendDue(ctx, later), 1, "alice has unread items; carol has none");
  const mail = digests().at(-1)!;
  assert.equal(mail.to, "alice@example.org");
  assert.match(mail.subject, /things are waiting for you on Craton/);
  assert.match(mail.text, /alice\/basin/);
  assert.ok(mail.text.includes("/alice/basin/issues/1"));
  assert.match(mail.text, /1 mention of you|mentions? of you/);
  assert.ok(!mail.html.includes("<script>"), "what people typed is escaped");
  assert.ok(!/<img/i.test(mail.html), "no tracking pixel");
  assert.equal(digests().filter((e) => e.to === "carol@example.org").length, 0, "nothing for someone with nothing");
  // The same week again: not due.
  assert.equal(await sendDue(ctx, new Date(later.getTime() + 3_600_000)), 0);
});

test("an address that was never confirmed never gets one", async () => {
  ctx.db.prepare("UPDATE users SET email_verified_at = NULL WHERE owner_id = ?").run(ids.alice);
  await call("POST", "/repos/alice/basin/issues", "bob", { title: "Another", label: "question" });
  assert.equal(await sendDue(ctx, new Date(Date.now() + 3 * week)), 0);
  ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = ?").run(new Date().toISOString(), ids.alice);
});

test("the unsubscribe link works without signing in, only for the person it was made for, and only if it is genuine", async () => {
  const mail = digests().at(-1)!;
  const link = mail.text.match(/digest\/unsubscribe\?token=(\S+)/)![1];
  assert.equal(link, unsubscribeToken(ids.alice));
  // A forged or altered token changes nothing.
  for (const bad of [`${ids.alice}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`, `${ids.bob}.${link.split(".")[1]}`, "", "x", `${ids.alice}`]) {
    assert.equal((await call("POST", "/auth/digest/unsubscribe", null, { token: bad })).status, 400, bad);
  }
  assert.equal((await call("GET", "/user", "alice")).json.digest, "weekly");
  const done = await call("POST", "/auth/digest/unsubscribe", null, { token: link });
  assert.equal(done.status, 200);
  assert.deepEqual(done.json, { handle: "alice", digest: "off" });
  assert.equal((await call("GET", "/user", "alice")).json.digest, "off");
  assert.equal(await sendDue(ctx, new Date(Date.now() + 4 * week)), 0, "and no more arrive");
});

test("turning it back on starts a fresh week instead of sending the backlog", async () => {
  await call("PATCH", "/user", "alice", { digest: "weekly" });
  assert.equal(await sendDue(ctx, new Date(Date.now() + 3_600_000)), 0);
});
