// "Continue with GitHub", end to end against a local stand-in for GitHub's token and API endpoints: the flow is the same
// as Google's (state, PKCE, one-time use), but the identity is read from the API and only a verified email counts.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { config } from "../src/config.ts";
import type { Ctx } from "../src/services/context.ts";

type Account = { id: number; login: string; name: string | null; emails: { email: string; primary: boolean; verified: boolean }[] };
const CLIENT_ID = "Iv1.craton-test";

// What the browser would have sent to GitHub, by code; and the account each access token belongs to.
const codes = new Map<string, { challenge: string; account: Account }>();
const tokens = new Map<string, Account>();
let server: http.Server;
let app: ReturnType<typeof createApp>;
let ctx: Ctx;

before(async () => {
  server = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        const entry = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const pkceOk = entry && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
        if (!entry || !pkceOk || form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== "shh" || form.get("redirect_uri") !== `${config.webUrl}/auth/github/callback`) {
          // GitHub answers 200 with an error for a bad code.
          return res.end(JSON.stringify({ error: "bad_verification_code" }));
        }
        const access = `gho_${randomBytes(12).toString("hex")}`;
        tokens.set(access, entry.account);
        res.end(JSON.stringify({ access_token: access, token_type: "bearer", scope: "read:user,user:email" }));
      });
      return;
    }
    const account = tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    if (!account) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ message: "Bad credentials" }));
    }
    if (req.url === "/user") return res.end(JSON.stringify({ id: account.id, login: account.login, name: account.name }));
    if (req.url === "/user/emails") return res.end(JSON.stringify(account.emails));
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(config.github, { clientId: CLIENT_ID, clientSecret: "shh", tokenUrl: `${base}/token`, apiUrl: base, authUrl: `${base}/authorize` });
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() } as Ctx;
  app = createApp(ctx);
});
after(() => {
  server.close();
  Object.assign(config.github, { clientId: "", clientSecret: "" });
});

const json = { "content-type": "application/json" };
const post = (path: string, body: unknown, token?: string) => app.request(`/v1${path}`, { method: "POST", headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (path: string, token?: string) => app.request(`/v1${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

const account = (id: number, login: string, emails: Account["emails"], name: string | null = null): Account => ({ id, login, name, emails });
const verifiedPrimary = (email: string) => [{ email, primary: true, verified: true }];

/** The browser's round trip: start, "consent" at GitHub (which account approved), callback. */
async function viaGithub(who: Account, opts: { token?: string; link?: boolean; next?: string; replayCode?: boolean } = {}) {
  const start = await post("/auth/github/start", { next: opts.next, link: opts.link }, opts.token);
  assert.equal(start.status, 200, await start.clone().text());
  const { url, state } = (await start.json()) as { url: string; state: string };
  const q = new URL(url).searchParams;
  assert.equal(q.get("state"), state);
  const code = randomBytes(8).toString("hex");
  codes.set(code, { challenge: q.get("code_challenge")!, account: who });
  const res = await post("/auth/github/callback", { code, state }, opts.token);
  return { res, body: (await res.json()) as Record<string, any>, state, code };
}

async function signUp(handle: string, email: string) {
  const res = await post("/auth/signup", { username: handle, email, password: "a-very-long-password" });
  assert.equal(res.status, 201);
  await ctx.db.run("UPDATE users SET email_verified_at = ? WHERE lower(email) = lower(?)", new Date().toISOString(), email);
  return ((await res.json()) as { token: string }).token;
}

test("providers say GitHub is on, and the start URL carries state, a PKCE challenge, the scopes and the callback", async () => {
  const providers = (await (await get("/auth/providers")).json()) as { github: boolean; google: boolean };
  assert.equal(providers.github, true);
  assert.equal(providers.google, false);
  const { url } = (await (await post("/auth/github/start", {})).json()) as { url: string };
  const q = new URL(url).searchParams;
  assert.equal(q.get("client_id"), CLIENT_ID);
  assert.equal(q.get("scope"), "read:user user:email");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("redirect_uri"), `${config.webUrl}/auth/github/callback`);
  assert.ok((q.get("state") ?? "").length >= 40);
});

test("a first sign-in asks for a username, uses the primary verified email, and creates a verified account with no password", async () => {
  const who = account(1001, "octo-maya", [
    { email: "maya@users.noreply.github.com", primary: false, verified: true },
    { email: "old@example.org", primary: false, verified: true },
    { email: "Maya.Rao@example.org", primary: true, verified: true },
    { email: "unconfirmed@example.org", primary: false, verified: false },
  ], "Maya Rao");
  const first = await viaGithub(who, { next: "/new" });
  assert.equal(first.res.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.needsUsername, true);
  assert.equal(first.body.email, "Maya.Rao@example.org");
  assert.equal(first.body.suggestion, "maya-rao");
  assert.equal(first.body.next, "/new");
  assert.ok(!("token" in first.body));
  // A GitHub ticket cannot be spent as a Google one (nor the reverse).
  assert.equal((await post("/auth/google/complete", { ticket: first.body.ticket, username: "sneaky" })).status, 400);
  const done = await post("/auth/github/complete", { ticket: first.body.ticket, username: "maya", name: "Maya Rao" });
  assert.equal(done.status, 200);
  const { token } = (await done.json()) as { token: string };
  const me = (await (await get("/user", token)).json()) as { handle: string; emailVerified: boolean };
  assert.deepEqual([me.handle, me.emailVerified], ["maya", true]);
  const methods = (await (await get("/user/identities", token)).json()) as { hasPassword: boolean; githubAvailable: boolean; identities: { provider: string; email: string }[] };
  assert.equal(methods.hasPassword, false);
  assert.equal(methods.githubAvailable, true);
  assert.deepEqual(methods.identities.map((i) => i.provider), ["github"]);
  // The next sign-in goes straight in, matched by GitHub's account number, even if the login name changed.
  const again = await viaGithub(account(1001, "octo-maya-renamed", verifiedPrimary("maya.rao@example.org")));
  assert.equal(again.res.status, 200);
  assert.ok(typeof again.body.token === "string");
  const log = (await (await get("/user/security-log", token)).json()) as { kind?: string; detail?: string }[];
  assert.ok(JSON.stringify(log).includes("GitHub"), "the security log says GitHub was used");
});

test("an account with no verified email address is refused, and a login name is not an identity", async () => {
  const none = await viaGithub(account(1002, "no-email", [{ email: "x@example.org", primary: true, verified: false }]));
  assert.equal(none.res.status, 403);
  assert.equal(none.body.error.code, "email_not_verified");
  const onlyNoReply = await viaGithub(account(1003, "hidden", [{ email: "1003+hidden@users.noreply.github.com", primary: true, verified: true }]));
  assert.equal(onlyNoReply.res.status, 403, "a no-reply address cannot reach anyone, so it cannot prove anything");
});

test("a verified email matching an existing, confirmed account signs in to it; an unconfirmed account is not merged", async () => {
  await signUp("dana", "dana@example.org");
  const joined = await viaGithub(account(1004, "dana-gh", verifiedPrimary("DANA@example.org")));
  assert.equal(joined.res.status, 200, JSON.stringify(joined.body));
  const me = (await (await get("/user", joined.body.token)).json()) as { handle: string };
  assert.equal(me.handle, "dana");
  const res = await post("/auth/signup", { username: "eli", email: "eli@example.org", password: "a-very-long-password" });
  assert.equal(res.status, 201);
  const refused = await viaGithub(account(1005, "eli-gh", verifiedPrimary("eli@example.org")));
  assert.equal(refused.res.status, 409);
  assert.equal(refused.body.error.code, "email_unverified_account");
});

test("the state is single use, a code works once, and a state from one provider cannot finish the other's", async () => {
  const who = account(1006, "replay", verifiedPrimary("replay@example.org"));
  const first = await viaGithub(who);
  assert.equal(first.res.status, 200);
  // The same state again.
  const again = await post("/auth/github/callback", { code: first.code, state: first.state });
  assert.equal(again.status, 400);
  // A bad code: GitHub answers 200 with an error, which must not become a sign-in.
  const start = (await (await post("/auth/github/start", {})).json()) as { state: string };
  const bad = await post("/auth/github/callback", { code: "not-a-real-code", state: start.state });
  assert.equal(bad.status, 502);
  // A state minted for GitHub is not valid for Google.
  Object.assign(config.google, { clientId: "g", clientSecret: "g" });
  try {
    const s2 = (await (await post("/auth/github/start", {})).json()) as { state: string };
    assert.equal((await post("/auth/google/callback", { code: "x", state: s2.state })).status, 400);
  } finally {
    Object.assign(config.google, { clientId: "", clientSecret: "" });
  }
});

test("connecting GitHub from Settings, a taken GitHub account, and disconnecting only while another way in remains", async () => {
  const token = await signUp("frank", "frank@example.org");
  const link = await viaGithub(account(1007, "frank-gh", verifiedPrimary("frank-gh@example.org")), { token, link: true });
  assert.equal(link.res.status, 200);
  assert.equal(link.body.linked, true);
  // Another Craton account cannot take the same GitHub account.
  const other = await signUp("gina", "gina@example.org");
  const taken = await viaGithub(account(1007, "frank-gh", verifiedPrimary("frank-gh@example.org")), { token: other, link: true });
  assert.equal(taken.res.status, 409);
  assert.equal(taken.body.error.code, "identity_taken");
  // Disconnecting works while a password remains…
  const del = await app.request("/v1/user/identities/github", { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  assert.equal(del.status, 204);
  assert.equal((await app.request("/v1/user/identities/github", { method: "DELETE", headers: { authorization: `Bearer ${token}` } })).status, 404);
  // …but not when it is the only way in.
  const solo = (await viaGithub(account(1008, "solo", verifiedPrimary("solo@example.org")))).body;
  const made = (await (await post("/auth/github/complete", { ticket: solo.ticket, username: "solo" })).json()) as { token: string };
  const refused = await app.request("/v1/user/identities/github", { method: "DELETE", headers: { authorization: `Bearer ${made.token}` } });
  assert.equal(refused.status, 409);
  assert.equal(((await refused.json()) as { error: { code: string } }).error.code, "last_sign_in_method");
});

test("with both providers connected, either can go while the other remains", async () => {
  Object.assign(config.google, { clientId: "g", clientSecret: "g" });
  try {
    const solo = (await viaGithub(account(1009, "both", verifiedPrimary("both@example.org")))).body;
    const made = (await (await post("/auth/github/complete", { ticket: solo.ticket, username: "both" })).json()) as { token: string };
    await ctx.db.run("INSERT INTO oauth_identities (provider, subject, user_id, email) VALUES ('google', 'g-1', (SELECT owner_id FROM users WHERE email = 'both@example.org'), 'both@example.org')");
    assert.equal((await app.request("/v1/user/identities/github", { method: "DELETE", headers: { authorization: `Bearer ${made.token}` } })).status, 204);
    assert.equal((await app.request("/v1/user/identities/google", { method: "DELETE", headers: { authorization: `Bearer ${made.token}` } })).status, 409, "now Google is the last way in");
  } finally {
    Object.assign(config.google, { clientId: "", clientSecret: "" });
  }
});

test("without credentials the routes say so plainly", async () => {
  Object.assign(config.github, { clientId: "", clientSecret: "" });
  try {
    const res = await post("/auth/github/start", {});
    assert.equal(res.status, 404);
    assert.equal(((await res.json()) as { error: { code: string } }).error.code, "not_configured");
  } finally {
    Object.assign(config.github, { clientId: CLIENT_ID, clientSecret: "shh" });
  }
});
