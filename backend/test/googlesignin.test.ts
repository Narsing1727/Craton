// Sign in with Google, against a local stand-in for Google: a JWKS endpoint, a token endpoint that enforces the
// PKCE verifier, and ID tokens signed with a key this test holds. Covers the flows and every refusal.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { config } from "../src/config.ts";
import { resetKeyCache } from "../src/services/oauth.ts";
import type { Ctx } from "../src/services/context.ts";

const CLIENT_ID = "craton-test.apps.googleusercontent.com";
const goodKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");

type Claims = Record<string, unknown>;
function idToken(claims: Claims, opts: { key?: typeof goodKey; alg?: string; kid?: string } = {}) {
  const header = { alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" };
  const body = { iss: "https://accounts.google.com", aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), email_verified: true, ...claims };
  const signing = `${b64(header)}.${b64(body)}`;
  const signature = header.alg === "none" ? "" : sign("RSA-SHA256", Buffer.from(signing), (opts.key ?? goodKey).privateKey).toString("base64url");
  return `${signing}.${signature}`;
}

// What the browser would have sent to Google, remembered by code so the token endpoint can check it.
const codes = new Map<string, { nonce: string; challenge: string; token: (nonce: string) => string }>();
const tokenRequests: URLSearchParams[] = [];
let server: http.Server;
let app: ReturnType<typeof createApp>;
let ctx: Ctx;

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === "/certs") {
      const jwk = { ...goodKey.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [jwk] }));
    }
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        tokenRequests.push(form);
        const entry = codes.get(form.get("code") ?? "");
        const verifier = form.get("code_verifier") ?? "";
        const pkceOk = entry && createHash("sha256").update(verifier).digest("base64url") === entry.challenge;
        const ok =
          entry &&
          pkceOk &&
          form.get("client_id") === CLIENT_ID &&
          form.get("client_secret") === "shh" &&
          form.get("grant_type") === "authorization_code" &&
          form.get("redirect_uri") === `${config.webUrl}/auth/google/callback`;
        codes.delete(form.get("code") ?? "");
        res.statusCode = ok ? 200 : 400;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(ok ? { id_token: entry!.token(entry!.nonce), access_token: "unused" } : { error: "invalid_grant" }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  Object.assign(config.google, { clientId: CLIENT_ID, clientSecret: "shh", tokenUrl: `${base}/token`, jwksUrl: `${base}/certs`, authUrl: `${base}/auth` });
  resetKeyCache();
  ctx = { db: openDb(":memory:"), store: new MemoryStore() } as Ctx;
  app = createApp(ctx);
});
after(() => {
  server.close();
  Object.assign(config.google, { clientId: "", clientSecret: "" });
});

const json = { "content-type": "application/json" };
const post = (path: string, body: unknown, token?: string) =>
  app.request(`/v1${path}`, { method: "POST", headers: { ...json, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const get = (path: string, token?: string) => app.request(`/v1${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

/** The browser's round trip: start, "consent" at Google (the claims are what Google would vouch for), callback. */
async function viaGoogle(claims: Claims, opts: { token?: string; link?: boolean; next?: string; key?: typeof goodKey; alg?: string; noncePatch?: string } = {}) {
  const start = await post("/auth/google/start", { next: opts.next, link: opts.link }, opts.token);
  assert.equal(start.status, 200, await start.clone().text());
  const { url, state } = (await start.json()) as { url: string; state: string };
  const q = new URL(url).searchParams;
  assert.equal(q.get("state"), state);
  const code = randomBytes(8).toString("hex");
  codes.set(code, {
    nonce: q.get("nonce")!,
    challenge: q.get("code_challenge")!,
    token: (nonce) => idToken({ nonce: opts.noncePatch ?? nonce, ...claims }, { key: opts.key, alg: opts.alg }),
  });
  const res = await post("/auth/google/callback", { code, state }, opts.token);
  return { res, body: (await res.json()) as Record<string, any>, state, code };
}

async function signUp(handle: string, email: string) {
  const res = await post("/auth/signup", { username: handle, email, password: "a-very-long-password" });
  assert.equal(res.status, 201);
  return ((await res.json()) as { token: string }).token;
}

test("providers say Google is on, and the start URL carries state, a PKCE challenge, a nonce and the callback", async () => {
  const providers = (await (await get("/auth/providers")).json()) as { google: boolean };
  assert.equal(providers.google, true);
  const start = await post("/auth/google/start", { next: "/dashboard" });
  const { url } = (await start.json()) as { url: string };
  const q = new URL(url).searchParams;
  assert.equal(q.get("client_id"), CLIENT_ID);
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("scope"), "openid email profile");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.ok((q.get("state") ?? "").length >= 40 && (q.get("nonce") ?? "").length >= 16);
  assert.equal(q.get("redirect_uri"), `${config.webUrl}/auth/google/callback`);
});

test("a first sign-in asks for a username, then the account exists, verified and without a password", async () => {
  const first = await viaGoogle({ sub: "g-100", email: "Maya.Rao@example.org", name: "Maya Rao" }, { next: "/new" });
  assert.equal(first.res.status, 200);
  assert.equal(first.body.needsUsername, true);
  assert.equal(first.body.suggestion, "maya-rao");
  assert.equal(first.body.next, "/new");
  assert.ok(!("token" in first.body), "no session before a username is chosen");
  // The ticket shows what to put on the form.
  const pending = (await (await post("/auth/google/pending", { ticket: first.body.ticket })).json()) as { email: string; suggestion: string };
  assert.equal(pending.email, "Maya.Rao@example.org");
  // A bad username leaves the ticket usable.
  const bad = await post("/auth/google/complete", { ticket: first.body.ticket, username: "Not Valid!" });
  assert.equal(bad.status, 400);
  const done = await post("/auth/google/complete", { ticket: first.body.ticket, username: "maya", name: "Maya Rao" });
  assert.equal(done.status, 200);
  const { token } = (await done.json()) as { token: string };
  const me = (await (await get("/user", token)).json()) as { handle: string; emailVerified: boolean; email: string };
  assert.deepEqual([me.handle, me.emailVerified], ["maya", true]);
  const methods = (await (await get("/user/identities", token)).json()) as { hasPassword: boolean; identities: { provider: string; email: string }[] };
  assert.equal(methods.hasPassword, false);
  assert.equal(methods.identities[0].provider, "google");
  // The ticket is single use.
  assert.equal((await post("/auth/google/complete", { ticket: first.body.ticket, username: "maya2" })).status, 400);
  // Next time Google signs straight in.
  const again = await viaGoogle({ sub: "g-100", email: "maya.rao@example.org", name: "Maya Rao" });
  assert.equal(again.res.status, 200);
  assert.ok(typeof again.body.token === "string");
  // A password sign-in cannot work on an account that has none.
  const pw = await post("/auth/login", { login: "maya", password: "" });
  assert.equal(pw.status, 401);
  const pw2 = await post("/auth/login", { login: "maya", password: "oauth$" });
  assert.equal(pw2.status, 401);
});

test("an existing account with a confirmed address is joined by email; one never confirmed is refused", async () => {
  await signUp("confirmed", "confirmed@example.org");
  ctx.db.prepare("UPDATE users SET email_verified_at = '2026-01-01T00:00:00.000Z' WHERE email = 'confirmed@example.org'").run();
  const joined = await viaGoogle({ sub: "g-200", email: "CONFIRMED@example.org", name: "C" });
  assert.equal(joined.res.status, 200);
  assert.ok(typeof joined.body.token === "string");
  const me = (await (await get("/user", joined.body.token)).json()) as { handle: string };
  assert.equal(me.handle, "confirmed");
  // The password still works: joining added a way in, it did not replace one.
  assert.equal((await post("/auth/login", { login: "confirmed", password: "a-very-long-password" })).status, 200);

  await signUp("squatter", "victim@example.org");
  const refused = await viaGoogle({ sub: "g-201", email: "victim@example.org", name: "Victim" });
  assert.equal(refused.res.status, 409);
  assert.equal(refused.body.error?.code ?? refused.body.code, "email_unverified_account");
  const stillOwned = ctx.db.prepare("SELECT COUNT(*) AS n FROM oauth_identities WHERE subject = 'g-201'").get() as { n: number };
  assert.equal(stillOwned.n, 0);
});

test("two-step verification still applies after Google", async () => {
  await signUp("guarded", "guarded@example.org");
  ctx.db.prepare("UPDATE users SET email_verified_at = '2026-01-01T00:00:00.000Z', totp_enabled_at = '2026-01-02T00:00:00.000Z', totp_secret = 'not-used-here' WHERE email = 'guarded@example.org'").run();
  const r = await viaGoogle({ sub: "g-300", email: "guarded@example.org", name: "G" });
  assert.equal(r.res.status, 200);
  assert.equal(r.body.mfaRequired, true);
  assert.ok(typeof r.body.ticket === "string");
  assert.ok(!("token" in r.body), "no session until the code is given");
});

test("every way an ID token can be wrong is refused", async () => {
  const cases: { name: string; claims?: Claims; opts?: Parameters<typeof viaGoogle>[1]; status: number; code: string }[] = [
    { name: "signed by another key", opts: { key: otherKey }, status: 401, code: "invalid_id_token" },
    { name: "alg none", opts: { alg: "none" }, status: 401, code: "invalid_id_token" },
    { name: "alg HS256", opts: { alg: "HS256" }, status: 401, code: "invalid_id_token" },
    { name: "another audience", claims: { aud: "someone-else" }, status: 401, code: "invalid_id_token" },
    { name: "another issuer", claims: { iss: "https://evil.example" }, status: 401, code: "invalid_id_token" },
    { name: "expired", claims: { exp: Math.floor(Date.now() / 1000) - 3600 }, status: 401, code: "invalid_id_token" },
    { name: "wrong nonce", opts: { noncePatch: "replayed" }, status: 401, code: "invalid_id_token" },
    { name: "no subject", claims: { sub: "" }, status: 401, code: "invalid_id_token" },
    { name: "address not verified by Google", claims: { email_verified: false }, status: 403, code: "email_not_verified" },
  ];
  for (const c of cases) {
    const r = await viaGoogle({ sub: "g-bad", email: "nobody@example.org", name: "N", ...c.claims }, c.opts);
    assert.equal(r.res.status, c.status, `${c.name}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.error?.code ?? r.body.code, c.code, c.name);
  }
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM oauth_pending").get() as { n: number }).n, 0, "no refused attempt left a pending account behind");
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM oauth_identities WHERE subject = 'g-bad'").get() as { n: number }).n, 0, "nor a linked identity");
});

test("state is single use and must be one we issued; an expired sign-in is refused", async () => {
  const first = await viaGoogle({ sub: "g-400", email: "replay@example.org", name: "R" });
  assert.equal(first.res.status, 200);
  const replay = await post("/auth/google/callback", { code: first.code, state: first.state });
  assert.equal(replay.status, 400);
  const forged = await post("/auth/google/callback", { code: "x", state: "made-up-state" });
  assert.equal(forged.status, 400);
  const missing = await post("/auth/google/callback", {});
  assert.equal(missing.status, 400);
  // Expire a stored sign-in.
  const start = (await (await post("/auth/google/start", {})).json()) as { state: string };
  ctx.db.prepare("UPDATE oauth_flows SET expires_at = '2020-01-01T00:00:00.000Z'").run();
  assert.equal((await post("/auth/google/callback", { code: "x", state: start.state })).status, 400);
});

test("the PKCE verifier is sent to Google and the secret never reaches the browser", async () => {
  tokenRequests.length = 0;
  const r = await viaGoogle({ sub: "g-500", email: "pkce@example.org", name: "P" });
  assert.equal(r.res.status, 200);
  assert.equal(tokenRequests.length, 1);
  assert.ok((tokenRequests[0].get("code_verifier") ?? "").length >= 43);
  const start = await post("/auth/google/start", {});
  assert.ok(!JSON.stringify(await start.json()).includes("shh"), "client secret is not in the start answer");
});

test("a signed-in person can connect Google from settings; another account cannot take the same Google", async () => {
  const token = await signUp("linker", "linker@example.org");
  const noSession = await post("/auth/google/start", { link: true });
  assert.equal(noSession.status, 401);
  const linked = await viaGoogle({ sub: "g-600", email: "other-address@example.org", name: "L" }, { token, link: true });
  assert.equal(linked.res.status, 200);
  assert.equal(linked.body.linked, true);
  // Signing in with that Google now reaches the same account.
  const via = await viaGoogle({ sub: "g-600", email: "other-address@example.org", name: "L" });
  const me = (await (await get("/user", via.body.token)).json()) as { handle: string };
  assert.equal(me.handle, "linker");
  // Someone else connecting the same Google is refused.
  const other = await signUp("other", "other@example.org");
  const clash = await viaGoogle({ sub: "g-600", email: "other-address@example.org", name: "L" }, { token: other, link: true });
  assert.equal(clash.res.status, 409);
  // A link started by one person cannot be completed by another.
  const start = (await (await post("/auth/google/start", { link: true }, token)).json()) as { url: string; state: string };
  const code = randomBytes(6).toString("hex");
  codes.set(code, { nonce: new URL(start.url).searchParams.get("nonce")!, challenge: new URL(start.url).searchParams.get("code_challenge")!, token: (nonce) => idToken({ nonce, sub: "g-601", email: "x@example.org" }) });
  assert.equal((await post("/auth/google/callback", { code, state: start.state }, other)).status, 403);
});

test("Google can be disconnected only while another way in exists", async () => {
  // Google-only account: the only way in.
  const first = await viaGoogle({ sub: "g-700", email: "solo@example.org", name: "S" });
  const done = await post("/auth/google/complete", { ticket: first.body.ticket, username: "solo" });
  const { token } = (await done.json()) as { token: string };
  const refused = await app.request("/v1/user/identities/google", { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  assert.equal(refused.status, 409);
  // And it has no password to change; the answer says how to add one.
  const change = await post("/user/password", { current: "", next: "a-brand-new-long-password" }, token);
  assert.equal(change.status, 409);
  // With a password (as "Forgot password" would set) it can be disconnected.
  ctx.db.prepare("UPDATE users SET password_hash = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = 'solo')").run(
    (await import("../src/services/accounts.ts")).hashPassword("a-brand-new-long-password"),
  );
  const ok = await app.request("/v1/user/identities/google", { method: "DELETE", headers: { authorization: `Bearer ${token}` } });
  assert.equal(ok.status, 204);
  const log = (await (await get("/user/security-log", token)).json()) as { type: string }[] | { events: { type: string }[] };
  const types = (Array.isArray(log) ? log : log.events).map((e) => e.type);
  assert.ok(types.includes("oauth_linked") && types.includes("oauth_unlinked"), types.join(","));
});

test("a Google-only account is deleted by typing its username, no password", async () => {
  const first = await viaGoogle({ sub: "g-800", email: "leaver@example.org", name: "Leaver" });
  const done = await post("/auth/google/complete", { ticket: first.body.ticket, username: "leaver" });
  const { token } = (await done.json()) as { token: string };
  const wrong = await app.request("/v1/user", { method: "DELETE", headers: { ...json, authorization: `Bearer ${token}` }, body: JSON.stringify({ handle: "nope", password: "" }) });
  assert.equal(wrong.status, 400);
  const gone = await app.request("/v1/user", { method: "DELETE", headers: { ...json, authorization: `Bearer ${token}` }, body: JSON.stringify({ handle: "leaver", password: "" }) });
  assert.equal(gone.status, 204);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM oauth_identities WHERE subject = 'g-800'").get() as { n: number }).n, 0, "the link goes with the account");
});

test("with no client id the button is off and the routes say so", async () => {
  const was = config.google.clientId;
  config.google.clientId = "";
  try {
    assert.equal(((await (await get("/auth/providers")).json()) as { google: boolean }).google, false);
    assert.equal((await post("/auth/google/start", {})).status, 404);
  } finally {
    config.google.clientId = was;
  }
});
