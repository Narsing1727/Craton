// Single sign-on for an organization, against a local identity provider (discovery, keys, token endpoint).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { config } from "../src/config.ts";
import type { Ctx } from "../src/services/context.ts";
import { resetKeyCache } from "../src/services/sso.ts";

const goodKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (v: object | Buffer) => (Buffer.isBuffer(v) ? v : Buffer.from(JSON.stringify(v))).toString("base64url");
const CLIENT_ID = "craton-hydrolab";
let ISSUER = "";

type Claims = Record<string, unknown>;
function idToken(claims: Claims, opts: { key?: typeof goodKey; alg?: string; kid?: string } = {}) {
  const header = { alg: opts.alg ?? "RS256", kid: opts.kid ?? "k1", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const body = { iss: ISSUER, aud: CLIENT_ID, exp: now + 600, iat: now, ...claims };
  const signing = `${b64(header)}.${b64(body)}`;
  const signature = header.alg === "none" ? "" : sign("RSA-SHA256", Buffer.from(signing), (opts.key ?? goodKey).privateKey).toString("base64url");
  return `${signing}.${signature}`;
}

const codes = new Map<string, { nonce: string; challenge: string; token: (nonce: string) => string }>();
const tokenForms: { form: URLSearchParams; auth: string | undefined }[] = [];
let idp: http.Server;
let app: ReturnType<typeof createApp>;
let ctx: Ctx;
let discoveryBody: (base: string) => object = () => ({});
let basicOnly = false;
const tokens: Record<string, string> = {};

before(async () => {
  config.webhooks.allowPrivate = true; // the provider below is on 127.0.0.1
  idp = http.createServer((req, res) => {
    res.setHeader("content-type", "application/json");
    const base = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
    if (req.url === "/.well-known/openid-configuration") return res.end(JSON.stringify(discoveryBody(base)));
    if (req.url === "/jwks") return res.end(JSON.stringify({ keys: [{ ...goodKey.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] }));
    if (req.url === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const form = new URLSearchParams(raw);
        tokenForms.push({ form, auth: req.headers.authorization });
        const entry = codes.get(form.get("code") ?? "");
        codes.delete(form.get("code") ?? "");
        const secretOk = basicOnly ? req.headers.authorization === `Basic ${Buffer.from(`${encodeURIComponent(CLIENT_ID)}:${encodeURIComponent("s3cret")}`).toString("base64")}` : form.get("client_secret") === "s3cret" && form.get("client_id") === CLIENT_ID;
        const ok = entry && secretOk && createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url") === entry.challenge && form.get("redirect_uri") === `${config.webUrl}/auth/sso/callback`;
        res.statusCode = ok ? 200 : 400;
        res.end(JSON.stringify(ok ? { id_token: entry!.token(entry!.nonce), access_token: "x" } : { error: "invalid_grant" }));
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  });
  await new Promise<void>((r) => idp.listen(0, "127.0.0.1", r));
  ISSUER = `http://127.0.0.1:${(idp.address() as AddressInfo).port}`;
  discoveryBody = (base) => ({ issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, jwks_uri: `${base}/jwks`, token_endpoint_auth_methods_supported: basicOnly ? ["client_secret_basic"] : ["client_secret_post", "client_secret_basic"] });
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() } as Ctx;
  app = createApp(ctx);
  resetKeyCache();
  for (const [u, email] of [["owen", "owen@hydrolab.org"], ["maya", "maya@hydrolab.org"], ["rhea", "rhea@gmail.com"]]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    await ctx.db.run("UPDATE users SET email_verified_at = ? WHERE lower(email) = lower(?)", new Date().toISOString(), email);
  }
  assert.equal((await call("POST", "/orgs", "owen", { handle: "hydrolab", name: "Hydrolab" })).status, 201);
});
after(() => {
  idp.close();
  config.webhooks.allowPrivate = false;
});

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

/** A person arrives at the provider, signs in, and is sent back with a code. */
async function viaProvider(email: string, claims: Claims, opts: { key?: typeof goodKey; alg?: string; nonce?: string } = {}) {
  const start = await call("POST", "/auth/sso/start", null, { email, next: "/new" });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const q = new URL(start.json.url).searchParams;
  const code = randomBytes(8).toString("hex");
  codes.set(code, { nonce: q.get("nonce")!, challenge: q.get("code_challenge")!, token: (nonce) => idToken({ nonce: opts.nonce ?? nonce, email, ...claims }, { key: opts.key, alg: opts.alg }) });
  const res = await call("POST", "/auth/sso/callback", null, { code, state: q.get("state") });
  return { res, body: res.json as Record<string, any>, state: q.get("state")!, code };
}

const verifyDomain = async (org: string, domain: string) => await ctx.db.run("INSERT INTO org_domains (org_id, domain, token, verified_at) VALUES ((SELECT id FROM owners WHERE handle = ?), ?, 't', ?)", org, domain, new Date().toISOString());
const members = async () => ((await call("GET", "/owners/hydrolab", null)).json.members as { handle: string; role: string }[]).map((m) => `${m.handle}:${m.role}`).sort();

test("setting it up needs a verified domain and an owner, and the provider's own answer has to make sense", async () => {
  const input = { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "s3cret" };
  assert.equal((await call("PUT", "/orgs/hydrolab/sso", "owen", input)).status, 400, "no verified domain yet");
  await verifyDomain("hydrolab", "hydrolab.org");
  assert.equal((await call("PUT", "/orgs/hydrolab/sso", "maya", input)).status, 404, "not a member");
  assert.equal((await call("PUT", "/orgs/hydrolab/sso", "owen", { ...input, issuer: "https://not-a-real-provider.invalid" })).json.error.code, "discovery_failed");
  assert.equal((await call("PUT", "/orgs/hydrolab/sso", "owen", { ...input, issuer: `${ISSUER}/` + "other" })).json.error.code, "discovery_failed");
  assert.equal((await call("PUT", "/orgs/hydrolab/sso", "owen", { ...input, clientSecret: "" })).status, 400, "a secret is needed the first time");
  const saved = discoveryBody;
  discoveryBody = (base) => ({ ...(saved(base) as object), issuer: "https://someone-else.example" });
  assert.equal((await call("PUT", "/orgs/hydrolab/sso", "owen", input)).json.error.code, "issuer_mismatch");
  discoveryBody = saved;
  const ok = await call("PUT", "/orgs/hydrolab/sso", "owen", input);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.deepEqual([ok.json.configured, ok.json.issuer, ok.json.clientId, ok.json.hasSecret, ok.json.enforced, ok.json.testedAt], [true, ISSUER, CLIENT_ID, true, false, null]);
  assert.equal(ok.json.redirectUri, `${config.webUrl}/auth/sso/callback`);
  assert.deepEqual(ok.json.domains, ["hydrolab.org"]);
  assert.ok(!JSON.stringify(ok.json).includes("s3cret"), "the secret is never sent back");
  const stored = (await ctx.db.get("SELECT client_secret FROM org_sso") as { client_secret: string }).client_secret;
  assert.ok(stored && !stored.includes("s3cret"), "and it is stored encrypted");
  assert.equal((await call("GET", "/orgs/hydrolab/sso", "maya")).status, 404);
});

test("the sign-in page asks for a work email; only a verified domain with SSO set up gets a URL, with state, PKCE and a nonce", async () => {
  const none = await call("POST", "/auth/sso/start", null, { email: "someone@elsewhere.org" });
  assert.equal(none.status, 404);
  assert.equal(none.json.error.code, "sso_not_configured");
  assert.equal((await call("POST", "/auth/sso/start", null, { email: "not an email" })).status, 400);
  assert.equal((await call("GET", "/auth/providers", null)).json.sso, true);
  const start = await call("POST", "/auth/sso/start", null, { email: "New.Person@Hydrolab.org", next: "/dashboard" });
  const q = new URL(start.json.url).searchParams;
  assert.equal(new URL(start.json.url).origin + new URL(start.json.url).pathname, `${ISSUER}/authorize`);
  assert.equal(q.get("client_id"), CLIENT_ID);
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("scope"), "openid email profile");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.equal(q.get("login_hint"), "New.Person@Hydrolab.org");
  assert.equal(q.get("redirect_uri"), `${config.webUrl}/auth/sso/callback`);
  assert.ok((q.get("state") ?? "").length >= 40 && (q.get("nonce") ?? "").length >= 16);
});

test("a first sign-in asks for a username, creates a verified account, adds it to the organization and proves the setup works", async () => {
  const first = await viaProvider("priya@hydrolab.org", { sub: "idp-1", name: "Priya Menon" });
  assert.equal(first.res.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.needsUsername, true);
  assert.equal(first.body.suggestion, "priya");
  assert.equal(first.body.next, "/new");
  assert.ok(!("token" in first.body));
  assert.equal((await call("POST", "/auth/google/complete", null, { ticket: first.body.ticket, username: "x" })).status, 400, "not usable as another provider's ticket");
  const done = await call("POST", "/auth/sso/complete", null, { ticket: first.body.ticket, username: "priya" });
  assert.equal(done.status, 200, JSON.stringify(done.json));
  tokens.priya = done.json.token;
  const me = (await call("GET", "/user", "priya")).json;
  assert.deepEqual([me.handle, me.emailVerified], ["priya", true]);
  assert.ok((await members()).includes("priya:Member"));
  assert.ok((await call("GET", "/orgs/hydrolab/sso", "owen")).json.testedAt, "the first sign-in marks the setup as tested");
  assert.equal(tokenForms.at(-1)!.form.get("client_secret"), "s3cret", "client_secret_post when the provider allows it");
  // The next time: straight in, matched by the provider's account id, even if the email text differs.
  const again = await viaProvider("Priya@hydrolab.org", { sub: "idp-1" });
  assert.equal(again.res.status, 200);
  assert.ok(typeof again.body.token === "string");
});

test("an existing confirmed account is linked and joins; one whose address was never confirmed is refused", async () => {
  const joined = await viaProvider("maya@hydrolab.org", { sub: "idp-2" });
  assert.equal(joined.res.status, 200, JSON.stringify(joined.body));
  assert.ok((await members()).includes("maya:Member"));
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ines", email: "ines@hydrolab.org", password: "a-very-long-password" }) });
  assert.equal(res.status, 201);
  const refused = await viaProvider("ines@hydrolab.org", { sub: "idp-3" });
  assert.equal(refused.res.status, 409);
  assert.equal(refused.body.error.code, "email_unverified_account");
});

test("the ID token is held to every check: signature, algorithm, issuer, audience, expiry, nonce, address and domain", async () => {
  const cases: [string, Claims, { key?: typeof goodKey; alg?: string; nonce?: string }, number, string][] = [
    ["a signature from another key", { sub: "x1" }, { key: otherKey }, 401, "invalid_id_token"],
    ["alg none", { sub: "x2" }, { alg: "none" }, 401, "invalid_id_token"],
    ["the wrong issuer", { sub: "x3", iss: "https://evil.example" }, {}, 401, "invalid_id_token"],
    ["the wrong audience", { sub: "x4", aud: "someone-elses-client" }, {}, 401, "invalid_id_token"],
    ["several audiences without our azp", { sub: "x5", aud: [CLIENT_ID, "other"] }, {}, 401, "invalid_id_token"],
    ["an expired token", { sub: "x6", exp: Math.floor(Date.now() / 1000) - 3600 }, {}, 401, "invalid_id_token"],
    ["the wrong nonce", { sub: "x7" }, { nonce: "not-the-nonce" }, 401, "invalid_id_token"],
    ["no subject", { sub: "" }, {}, 401, "invalid_id_token"],
    ["an address the provider says is unverified", { sub: "x8", email_verified: false }, {}, 403, "email_not_verified"],
  ];
  for (const [name, claims, opts, status, code] of cases) {
    const r = await viaProvider("check@hydrolab.org", claims, opts);
    assert.equal(r.res.status, status, name);
    assert.equal(r.body.error?.code, code, name);
  }
  // The provider only speaks for the organization's verified domains: it cannot vouch for anybody else's address.
  const outside = await viaProvider("check@hydrolab.org", { sub: "x9", email: "ceo@other-company.com" });
  assert.equal(outside.res.status, 403);
  assert.equal(outside.body.error.code, "domain_not_verified");
  const lookalike = await viaProvider("check@hydrolab.org", { sub: "x10", email: "boss@hydrolab.org.evil.example" });
  assert.equal(lookalike.body.error.code, "domain_not_verified");
  // No email claim: preferred_username (Entra ID) is used when it looks like an address; otherwise it is refused.
  const entra = await viaProvider("check@hydrolab.org", { sub: "x11", email: undefined, preferred_username: "entra.user@hydrolab.org" });
  assert.equal(entra.res.status, 200, JSON.stringify(entra.body));
  assert.equal(entra.body.email, "entra.user@hydrolab.org");
  const none = await viaProvider("check@hydrolab.org", { sub: "x12", email: undefined });
  assert.equal(none.body.error.code, "no_email");
});

test("a state works once, and one provider's state cannot finish another's", async () => {
  const first = await viaProvider("maya@hydrolab.org", { sub: "idp-2" });
  assert.equal((await call("POST", "/auth/sso/callback", null, { code: first.code, state: first.state })).status, 400, "the same state again");
  const start = await call("POST", "/auth/sso/start", null, { email: "maya@hydrolab.org" });
  Object.assign(config.google, { clientId: "g", clientSecret: "g" });
  try {
    assert.equal((await call("POST", "/auth/google/callback", null, { code: "x", state: new URL(start.json.url).searchParams.get("state") })).status, 400);
  } finally {
    Object.assign(config.google, { clientId: "", clientSecret: "" });
  }
});

test("requiring SSO locks out other sign-in methods for members, never for owners, and never for tokens", async () => {
  // Maya has a password; once enforced she must use SSO. Owen (an owner) keeps his password as the way back in.
  const enforced = await call("PATCH", "/orgs/hydrolab/sso", "owen", { enforced: true });
  assert.equal(enforced.status, 200, JSON.stringify(enforced.json));
  const login = (name: string) => call("POST", "/auth/login", null, { login: name, password: "a-very-long-password" });
  const blocked = await login("maya");
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.error.code, "sso_required");
  assert.match(blocked.json.error.message, /hydrolab requires single sign-on for hydrolab\.org addresses/);
  assert.equal((await login("owen")).status, 200, "an owner is exempt");
  assert.equal((await login("rhea")).status, 200, "someone at another domain is unaffected");
  // The person's own access token keeps working: the CLI and CI are not browsers.
  assert.equal((await app.request("/v1/user", { headers: { authorization: `Bearer ${tokens.maya}` } })).status, 200);
  // And SSO itself still signs her in.
  assert.equal((await viaProvider("maya@hydrolab.org", { sub: "idp-2" })).res.status, 200);
  await call("PATCH", "/orgs/hydrolab/sso", "owen", { enforced: false });
  assert.equal((await login("maya")).status, 200, "off again");
});

test("it cannot be required before it has worked once; changing the client resets that; removing it unlinks everyone", async () => {
  // A new client id is a new setup: untested, and so not enforced.
  const changed = await call("PUT", "/orgs/hydrolab/sso", "owen", { issuer: ISSUER, clientId: CLIENT_ID });
  assert.equal(changed.status, 200, "the secret may be left out when only the address changes");
  assert.ok(changed.json.testedAt, "same issuer and client keep their tested mark");
  const different = await call("PUT", "/orgs/hydrolab/sso", "owen", { issuer: ISSUER, clientId: "another-client", clientSecret: "s3cret" });
  assert.equal(different.json.testedAt, null);
  assert.equal((await call("PATCH", "/orgs/hydrolab/sso", "owen", { enforced: true })).status, 400, "untested");
  assert.equal((await call("PATCH", "/orgs/hydrolab/sso", "owen", { enforced: "yes" })).status, 400);
  assert.equal((await call("DELETE", "/orgs/hydrolab/sso", "owen")).status, 204);
  assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM oauth_identities WHERE provider LIKE 'sso:%'") as { n: number }).n, 0);
  assert.equal((await call("POST", "/auth/sso/start", null, { email: "maya@hydrolab.org" })).status, 404);
  assert.equal((await call("GET", "/orgs/hydrolab/sso", "owen")).json.configured, false);
});

test("a provider that only accepts client_secret_basic is sent the secret that way", async () => {
  basicOnly = true;
  try {
    assert.equal((await call("PUT", "/orgs/hydrolab/sso", "owen", { issuer: ISSUER, clientId: CLIENT_ID, clientSecret: "s3cret" })).status, 200);
    const r = await viaProvider("newer@hydrolab.org", { sub: "idp-9" });
    assert.equal(r.res.status, 200, JSON.stringify(r.body));
    assert.ok(tokenForms.at(-1)!.auth?.startsWith("Basic "));
    assert.equal(tokenForms.at(-1)!.form.get("client_secret"), null, "and not in the body");
  } finally {
    basicOnly = false;
  }
});

test("an address that points inside the network is refused when private addresses are not allowed", async () => {
  config.webhooks.allowPrivate = false;
  try {
    const r = await call("PUT", "/orgs/hydrolab/sso", "owen", { issuer: "https://127.0.0.1:9", clientId: "c", clientSecret: "s" });
    assert.equal(r.status, 400);
    assert.match(r.json.error.message, /issuer is the address/);
    const r2 = await call("PUT", "/orgs/hydrolab/sso", "owen", { issuer: "http://example.org", clientId: "c", clientSecret: "s" });
    assert.equal(r2.status, 400, "http is refused");
  } finally {
    config.webhooks.allowPrivate = true;
  }
});
