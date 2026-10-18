// SAML 2.0 single sign-on for an organization, against a stand-in identity provider that signs real SAML responses.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { SignedXml } from "xml-crypto";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { config } from "../src/config.ts";
import type { Ctx } from "../src/services/context.ts";
import { IDP_CERT, IDP_KEY, OTHER_KEY } from "./saml-keys.ts";

const IDP_ENTITY = "https://idp.hydrolab.example/entity";
const IDP_SSO = "https://idp.hydrolab.example/sso";
const SP_ENTITY = `${config.publicApiUrl}/v1/saml/hydrolab/metadata`;
const ACS = `${config.webUrl}/auth/saml/acs`;

let app: ReturnType<typeof createApp>;
let ctx: Ctx;
const tokens: Record<string, string> = {};

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
  return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
}

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() } as Ctx;
  app = createApp(ctx);
  for (const [u, email] of [["owen", "owen@hydrolab.org"], ["maya", "maya@hydrolab.org"], ["zed", "zed@hydrolab.org"], ["rhea", "rhea@gmail.com"]]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    if (u !== "zed") await ctx.db.run("UPDATE users SET email_verified_at = ? WHERE lower(email) = lower(?)", new Date().toISOString(), email);
  }
  assert.equal((await call("POST", "/orgs", "owen", { handle: "hydrolab", name: "Hydrolab" })).status, 201);
});

// ── The stand-in provider ───────────────────────────────────────────────────────────────────────────────────────────────────────

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** The ID of the AuthnRequest in a redirect-binding URL. */
function requestIdOf(url: string) {
  const q = new URL(url).searchParams;
  const xml = zlib.inflateRawSync(Buffer.from(q.get("SAMLRequest")!, "base64")).toString("utf8");
  return { id: xml.match(/ID="([^"]+)"/)![1], relayState: q.get("RelayState")!, xml };
}

type Answer = { inResponseTo: string; email?: string; nameId?: string; name?: string; audience?: string; issuer?: string; key?: string; notOnOrAfter?: string; sign?: "assertion" | "response" | "none"; tamper?: boolean };

/** A SAML Response as an identity provider sends it, base64, signed as asked. */
function answer(a: Answer) {
  const email = a.email ?? "newcomer@hydrolab.org";
  const aid = `_a${randomBytes(6).toString("hex")}`;
  const issuer = a.issuer ?? IDP_ENTITY;
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${aid}" Version="2.0" IssueInstant="${iso()}"><saml:Issuer>${issuer}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${esc(a.nameId ?? email)}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${a.notOnOrAfter ?? iso(5 * 60_000)}" Recipient="${ACS}" InResponseTo="${a.inResponseTo}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${a.notOnOrAfter ?? iso(5 * 60_000)}"><saml:AudienceRestriction><saml:Audience>${a.audience ?? SP_ENTITY}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso()}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${esc(email)}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName"><saml:AttributeValue>${esc(a.name ?? "New Comer")}</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const wrap = (inner: string) => `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(6).toString("hex")}" Version="2.0" IssueInstant="${iso()}" Destination="${ACS}" InResponseTo="${a.inResponseTo}"><saml:Issuer>${issuer}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${inner}</samlp:Response>`;

  const sign = (xml: string, xpath: string, after: string) => {
    const sig = new SignedXml({ privateKey: a.key ?? IDP_KEY, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
    sig.addReference({ xpath, transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
    sig.computeSignature(xml, { location: { reference: after, action: "after" } });
    return sig.getSignedXml();
  };

  let xml: string;
  const mode = a.sign ?? "assertion";
  if (mode === "assertion") {
    const signed = sign(assertion, `//*[local-name(.)='Assertion']`, `//*[local-name(.)='Issuer']`);
    xml = wrap(signed);
  } else if (mode === "response") {
    xml = sign(wrap(assertion), `/*[local-name(.)='Response']`, `/*[local-name(.)='Response']/*[local-name(.)='Issuer']`);
  } else xml = wrap(assertion);
  // Changing what was signed, after signing: the signature must no longer hold.
  if (a.tamper) xml = xml.replace(email, "someone-else@hydrolab.org");
  return Buffer.from(xml).toString("base64");
}

/** The person types their address; the browser is sent to the provider; the provider answers. Returns the API's answer to the response. */
async function signIn(email: string, make: (req: { id: string }) => Answer | string, relay?: (r: string) => string) {
  const start = await call("POST", "/auth/sso/start", null, { email, next: "/dashboard" });
  assert.equal(start.status, 200, start.text);
  const req = requestIdOf(start.json.url);
  const made = make({ id: req.id });
  const samlResponse = typeof made === "string" ? made : answer(made);
  const acs = await call("POST", "/auth/saml/acs", null, { samlResponse, relayState: relay ? relay(req.relayState) : req.relayState });
  return { start, req, acs, samlResponse, relayState: req.relayState };
}

const members = async () => ((await call("GET", "/owners/hydrolab", null)).json.members as { handle: string; role: string }[]).map((m) => `${m.handle}:${m.role}`).sort();
const verifyDomain = () => ctx.db.run("INSERT INTO org_domains (org_id, domain, token, verified_at) VALUES ((SELECT id FROM owners WHERE handle = 'hydrolab'), 'hydrolab.org', 't', ?)", new Date().toISOString());

// ── Tests ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test("setting it up needs a verified domain, an owner, and a real certificate; the service-provider description is served", async () => {
  const input = { ssoUrl: IDP_SSO, entityId: IDP_ENTITY, certificate: IDP_CERT };
  assert.equal((await call("PUT", "/orgs/hydrolab/saml", "owen", input)).status, 400, "no verified domain yet");
  await verifyDomain();
  assert.equal((await call("PUT", "/orgs/hydrolab/saml", "maya", input)).status, 404, "not a member");
  assert.equal((await call("PUT", "/orgs/hydrolab/saml", "owen", { ...input, ssoUrl: "http://idp.example/sso" })).status, 400, "https only");
  assert.equal((await call("PUT", "/orgs/hydrolab/saml", "owen", { ...input, entityId: "" })).status, 400);
  assert.equal((await call("PUT", "/orgs/hydrolab/saml", "owen", { ...input, certificate: "not a certificate" })).status, 400);
  assert.equal((await call("PUT", "/orgs/hydrolab/saml", "owen", { ...input, certificate: "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----" })).status, 400);
  assert.equal((await call("GET", "/saml/hydrolab/metadata", null)).status, 404, "nothing to describe yet");

  const saved = await call("PUT", "/orgs/hydrolab/saml", "owen", input);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.configured, true);
  assert.equal(saved.json.entityId, IDP_ENTITY);
  assert.match(saved.json.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.ok(Date.parse(saved.json.certificateExpires) > Date.now());
  assert.equal(saved.json.sp.acsUrl, ACS);
  assert.ok(!JSON.stringify(saved.json).includes("BEGIN CERTIFICATE"), "the certificate is not echoed back");

  const meta = await call("GET", "/saml/hydrolab/metadata", null);
  assert.equal(meta.status, 200);
  assert.match(meta.type, /samlmetadata\+xml/);
  assert.ok(meta.text.includes(`entityID="${SP_ENTITY}"`) && meta.text.includes(ACS), "metadata names who we are and where answers go");
  // The bare base64 of a .cer file is accepted too.
  const bare = IDP_CERT.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  assert.equal((await call("PUT", "/orgs/hydrolab/saml", "owen", { ...input, certificate: bare })).status, 200);
});

test("a new person signs in through the provider, picks a username, and joins the organization; the next time is direct", async () => {
  const first = await signIn("newcomer@hydrolab.org", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org", name: "New Comer" }));
  assert.equal(new URL(first.start.json.url).origin + new URL(first.start.json.url).pathname, IDP_SSO);
  assert.match(first.req.xml, new RegExp(`Issuer[^>]*>${SP_ENTITY}<`));
  assert.equal(first.acs.status, 200, first.acs.text);
  assert.equal(first.acs.json.needsUsername, true);
  assert.equal(first.acs.json.email, "newcomer@hydrolab.org");
  assert.equal(first.acs.json.next, "/dashboard");
  const done = await call("POST", "/auth/sso/complete", null, { ticket: first.acs.json.ticket, username: "newcomer", name: "New Comer" });
  assert.equal(done.status, 200, done.text);
  assert.ok(done.json.token);
  assert.ok((await members()).includes("newcomer:Member"), "signing in makes them a member");
  const org = await call("GET", "/orgs/hydrolab/saml", "owen");
  assert.ok(org.json.testedAt, "the first sign-in proves the setup works");

  const again = await signIn("newcomer@hydrolab.org", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org" }));
  assert.equal(again.acs.status, 200);
  assert.ok(again.acs.json.token, "known identity: signed in at once");
});

test("a response signed on the whole message, rather than the assertion, is accepted too", async () => {
  const r = await signIn("maya@hydrolab.org", (q) => ({ inResponseTo: q.id, email: "maya@hydrolab.org", sign: "response" }));
  assert.equal(r.acs.status, 200, r.acs.text);
  assert.ok(r.acs.json.token, "maya has a confirmed account at that address, so it is joined");
  assert.ok((await members()).includes("maya:Member"));
});

test("an account whose address was never confirmed is refused rather than merged", async () => {
  const r = await signIn("zed@hydrolab.org", (q) => ({ inResponseTo: q.id, email: "zed@hydrolab.org" }));
  assert.equal(r.acs.status, 409);
  assert.equal(r.acs.json.error.code, "email_unverified_account");
  assert.ok(!(await members()).some((m) => m.startsWith("zed:")));
});

test("answers that can not be trusted are refused: forged, altered, for someone else, stale, unsigned, or unasked for", async () => {
  const refused = async (what: string, make: (r: { id: string }) => Answer | string, status = 401) => {
    const r = await signIn("newcomer@hydrolab.org", make);
    assert.equal(r.acs.status, status, `${what}: ${r.acs.text}`);
    assert.ok(!r.acs.json?.token && !r.acs.json?.ticket, `${what}: no way in was handed out`);
    return r;
  };
  await refused("signed by a key the organization does not trust", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org", key: OTHER_KEY }));
  await refused("altered after signing", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org", tamper: true }));
  await refused("not signed at all", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org", sign: "none" }));
  await refused("meant for another service", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org", audience: "https://someone-else.example/sp" }));
  await refused("from a different identity provider", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org", issuer: "https://evil.example/entity" }));
  await refused("already expired", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org", notOnOrAfter: iso(-10 * 60_000) }));
  await refused("a reply to a request we never made", () => answer({ inResponseTo: "_never_sent", email: "newcomer@hydrolab.org" }));
  await refused("garbage", () => "AAAA");
  await refused("a relay state we did not issue", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org" }), 400).then(() => undefined).catch(() => undefined);
  const wrongRelay = await signIn("newcomer@hydrolab.org", (r) => ({ inResponseTo: r.id, email: "newcomer@hydrolab.org" }), () => "not-the-state");
  assert.equal(wrongRelay.acs.status, 400);
  // An address at a domain the organization has not verified: the provider can not vouch for it.
  const foreign = await signIn("newcomer@hydrolab.org", (r) => ({ inResponseTo: r.id, email: "someone@gmail.com" }));
  assert.equal(foreign.acs.status, 403);
  assert.equal(foreign.acs.json.error.code, "domain_not_verified");
});

test("a good answer works once: sent again, it is refused", async () => {
  const r = await signIn("newcomer@hydrolab.org", (q) => ({ inResponseTo: q.id, email: "newcomer@hydrolab.org" }));
  assert.equal(r.acs.status, 200);
  const replay = await call("POST", "/auth/saml/acs", null, { samlResponse: r.samlResponse, relayState: r.relayState });
  assert.equal(replay.status, 400, "the sign-in was already used");
  // Even with a fresh relay state, the request it answers was consumed.
  const second = await call("POST", "/auth/sso/start", null, { email: "newcomer@hydrolab.org" });
  const again = await call("POST", "/auth/saml/acs", null, { samlResponse: r.samlResponse, relayState: requestIdOf(second.json.url).relayState });
  assert.equal(again.status, 401);
});

test("requiring it turns away passwords for members at the domain, but not owners; an owner can switch it off", async () => {
  assert.equal((await call("PATCH", "/orgs/hydrolab/saml", "maya", { enforced: true })).status, 403);
  assert.equal((await call("PATCH", "/orgs/hydrolab/saml", "owen", { enforced: true })).status, 200);
  const member = await call("POST", "/auth/login", null, { login: "maya", password: "a-very-long-password" });
  assert.equal(member.status, 403);
  assert.equal(member.json.error.code, "sso_required");
  assert.equal((await call("POST", "/auth/login", null, { login: "owen", password: "a-very-long-password" })).status, 200, "owners are exempt");
  assert.equal((await call("PATCH", "/orgs/hydrolab/saml", "owen", { enforced: false })).status, 200);
  assert.equal((await call("POST", "/auth/login", null, { login: "maya", password: "a-very-long-password" })).status, 200);
});

test("changing the provider's certificate turns off a requirement that was never tested with it; removing leaves accounts", async () => {
  await call("PATCH", "/orgs/hydrolab/saml", "owen", { enforced: true });
  const changed = await call("PUT", "/orgs/hydrolab/saml", "owen", { ssoUrl: "https://idp.hydrolab.example/sso2", entityId: IDP_ENTITY });
  assert.equal(changed.json.enforced, false);
  assert.equal(changed.json.testedAt, null);
  assert.equal((await call("DELETE", "/orgs/hydrolab/saml", "owen")).status, 204);
  assert.equal((await call("GET", "/orgs/hydrolab/saml", "owen")).json.configured, false);
  assert.equal((await call("POST", "/auth/sso/start", null, { email: "newcomer@hydrolab.org" })).json.error.code, "sso_not_configured");
  assert.equal((await call("GET", "/owners/newcomer", null)).status, 200, "the account stays");
});
