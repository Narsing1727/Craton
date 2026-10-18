// Invite by email: a one-time link for someone with no account yet, accepted only by the account that uses the
// invited address and has confirmed it; people who already have an account are simply added.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { sentEmails } from "../src/services/email.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

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

async function signup(handle: string, email = `${handle}@example.org`) {
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: handle, email, password: "a-very-long-password" }) });
  assert.equal(res.status, 201);
  tokens[handle] = ((await res.json()) as { token: string }).token;
}
const verify = async (handle: string) => await ctx.db.run("UPDATE users SET email_verified_at = now_iso() WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)", handle);
const lastInviteLink = (to: string) => {
  const mail = [...sentEmails].reverse().find((m) => m.to === to && m.kind === "repo-invite");
  const m = mail?.text.match(/\/invite\?token=([\w-]+)/);
  return m ? m[1] : null;
};

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  await signup("rhea");
  await verify("rhea");
  assert.equal((await call("POST", "/repos", "rhea", { name: "basin", visibility: "private" })).status, 201);
});

test("inviting an address with no account sends a one-time link and lists the invitation", async () => {
  const r = await call("POST", "/repos/rhea/basin/invites", "rhea", { email: "kofi@field.example", role: "Write" });
  assert.equal(r.status, 201);
  assert.equal(r.json.added, false);
  const token = lastInviteLink("kofi@field.example");
  assert.ok(token, "the email carries the link");
  const list = await call("GET", "/repos/rhea/basin/invites", "rhea");
  assert.deepEqual(list.json.map((i: { email: string; role: string }) => [i.email, i.role]), [["kofi@field.example", "Write"]]);
  assert.ok(!JSON.stringify(list.json).includes(token!), "the link is not stored or listed");
  const peek = await call("GET", `/invites/${token}`, null);
  assert.equal(peek.status, 200);
  assert.deepEqual([peek.json.repo, peek.json.role, peek.json.invitedBy, peek.json.emailHint, peek.json.hasAccount], ["rhea/basin", "Write", "rhea", "k***@field.example", false]);
});

test("only the invited address, confirmed, can accept; then the person is a collaborator and the link is spent", async () => {
  const token = lastInviteLink("kofi@field.example")!;
  await signup("someoneelse");
  await verify("someoneelse");
  const wrong = await call("POST", "/invites/accept", "someoneelse", { token });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.json.error.code, "invite_email_mismatch");
  assert.match(wrong.json.error.message, /k\*\*\*@field\.example/);

  await signup("kofi", "kofi@field.example");
  const early = await call("POST", "/invites/accept", "kofi", { token });
  assert.equal(early.status, 403);
  assert.equal(early.json.error.code, "email_unverified");
  await verify("kofi");
  const ok = await call("POST", "/invites/accept", "kofi", { token });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.json.repo, ok.json.role], ["rhea/basin", "Write"]);
  assert.equal((await call("GET", "/repos/rhea/basin", "kofi")).status, 200, "the private repository is now visible to them");
  assert.equal((await call("POST", "/invites/accept", "kofi", { token })).status, 400, "the link works once");
  assert.deepEqual((await call("GET", "/repos/rhea/basin/invites", "rhea")).json, []);
});

test("an address that already has an account is added directly, and others cannot invite", async () => {
  const r = await call("POST", "/repos/rhea/basin/invites", "rhea", { email: "someoneelse@example.org", role: "Read" });
  assert.equal(r.status, 201);
  assert.equal(r.json.added, true);
  assert.equal(r.json.handle, "someoneelse");
  assert.equal((await call("GET", "/repos/rhea/basin", "someoneelse")).status, 200);
  assert.equal((await call("POST", "/repos/rhea/basin/invites", "kofi", { email: "x@example.org" })).status, 403, "a writer is not an admin");
  assert.equal((await call("GET", "/repos/rhea/basin/invites", "kofi")).status, 403);
});

test("an invitation can be withdrawn, replaced by a newer one, and is refused for bad input", async () => {
  assert.equal((await call("POST", "/repos/rhea/basin/invites", "rhea", { email: "ines@lab.example" })).status, 201);
  const first = lastInviteLink("ines@lab.example")!;
  const b = await call("POST", "/repos/rhea/basin/invites", "rhea", { email: "ines@lab.example", role: "Admin" });
  assert.equal((await call("GET", `/invites/${first}`, null)).status, 400, "the earlier link stops working");
  assert.equal((await call("DELETE", `/repos/rhea/basin/invites/${b.json.invite.id}`, "rhea")).status, 204);
  assert.equal((await call("GET", `/invites/${lastInviteLink("ines@lab.example")}`, null)).status, 400, "a withdrawn link stops working");
  assert.equal((await call("POST", "/repos/rhea/basin/invites", "rhea", { email: "not an email" })).status, 400);
  assert.equal((await call("POST", "/repos/rhea/basin/invites", "rhea", { email: "a@b.example", role: "Owner" })).status, 400);
  assert.equal((await call("POST", "/repos/rhea/basin/invites", null, { email: "a@b.example" })).status, 401);
});
