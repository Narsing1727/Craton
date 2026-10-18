// SAML single sign-on through the real web app and API, with a stand-in identity provider that signs real responses. Start a THROWAWAY API
// (its own database and data folder) and the web app against it, the API with CRATON_WEB_URL set to the web app's address, then:
//   CRATON_E2E_DATABASE_URL=<that API's postgres address> node scripts/saml-e2e.mjs
// It makes an organization, verifies a domain directly in the database (the real check needs DNS), saves the provider, and signs in
// the way a browser would: /auth/sso -> the provider -> a POST of the signed answer to /auth/saml/acs.

import { createRequire } from "node:module";
import zlib from "node:zlib";
import { randomBytes } from "node:crypto";
import { openE2eDb } from "./e2e-db.mjs";

const backend = createRequire(new URL("../../backend/package.json", import.meta.url));
const { SignedXml } = backend("xml-crypto");
const { IDP_CERT, IDP_KEY } = await import(new URL("../../backend/test/saml-keys.ts", import.meta.url).href);

const API = process.env.CRATON_API ?? "http://localhost:4001/v1";
const WEB = process.env.CRATON_WEB ?? "http://localhost:3101";
const ENTITY = "https://idp.e2e.example/entity";
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};
const j = async (method, path, token, body) => {
  const res = await fetch(`${API}${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
};

const suffix = Date.now().toString(36);
const owner = `samlowner${suffix}`;
const domain = `saml${suffix}.example.org`;
const org = `samlorg${suffix}`;
const signup = await j("POST", "/auth/signup", null, { username: owner, email: `${owner}@gmail.example`, password: "a-very-long-password" });
must(signup.status === 201, "an owner account");
const token = signup.json.token;
must((await j("POST", "/orgs", token, { handle: org, name: org })).status === 201, "an organization");
const db = await openE2eDb();
await db.prepare("INSERT INTO org_domains (org_id, domain, token, verified_at) VALUES ((SELECT id FROM owners WHERE handle = ?), ?, 't', now_iso())").run(org, domain);
await db.close();
const saved = await j("PUT", `/orgs/${org}/saml`, token, { ssoUrl: "https://idp.e2e.example/sso", entityId: ENTITY, certificate: IDP_CERT });
must(saved.status === 200, `the provider is saved (${saved.json?.error?.message ?? "ok"})`);
const { acsUrl, entityId: spEntity } = saved.json.sp;
must(acsUrl === `${WEB}/auth/saml/acs`, `the ACS address is the web app's (${acsUrl})`);

// The browser asks the web app to start; it is sent on to the provider.
const email = `person@${domain}`;
const start = await fetch(`${WEB}/auth/sso?email=${encodeURIComponent(email)}&next=${encodeURIComponent("/dashboard")}`, { redirect: "manual" });
const where = start.headers.get("location") ?? "";
must(start.status >= 300 && start.status < 400 && where.startsWith("https://idp.e2e.example/sso"), `sent to the provider (${where.slice(0, 40)}…)`);
const cookie = (start.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("craton_oauth_state="));
must(Boolean(cookie) && /Path=\/auth\/saml/i.test(cookie), "a state cookie for the SAML return path");

// The provider's signed answer to one request.
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();
function signedAnswer(requestId, who) {
  const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${randomBytes(6).toString("hex")}" Version="2.0" IssueInstant="${iso()}"><saml:Issuer>${ENTITY}</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${who}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(300000)}" Recipient="${acsUrl}" InResponseTo="${requestId}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${iso(-60000)}" NotOnOrAfter="${iso(300000)}"><saml:AudienceRestriction><saml:Audience>${spEntity}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${iso()}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement><saml:AttributeStatement><saml:Attribute Name="email"><saml:AttributeValue>${who}</saml:AttributeValue></saml:Attribute><saml:Attribute Name="displayName"><saml:AttributeValue>Per Son</saml:AttributeValue></saml:Attribute></saml:AttributeStatement></saml:Assertion>`;
  const sig = new SignedXml({ privateKey: IDP_KEY, signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256", canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#" });
  sig.addReference({ xpath: "//*[local-name(.)='Assertion']", transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"], digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256" });
  sig.computeSignature(assertion, { location: { reference: "//*[local-name(.)='Issuer']", action: "after" } });
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${randomBytes(6).toString("hex")}" Version="2.0" IssueInstant="${iso()}" Destination="${acsUrl}" InResponseTo="${requestId}"><saml:Issuer>${ENTITY}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${sig.getSignedXml()}</samlp:Response>`;
}
const post = (SAMLResponse, RelayState) =>
  fetch(acsUrl, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ SAMLResponse: Buffer.from(SAMLResponse).toString("base64"), RelayState }) });
const begin = async () => {
  const s = await fetch(`${WEB}/auth/sso?email=${encodeURIComponent(email)}&next=${encodeURIComponent("/dashboard")}`, { redirect: "manual" });
  const p = new URL(s.headers.get("location")).searchParams;
  return { id: zlib.inflateRawSync(Buffer.from(p.get("SAMLRequest"), "base64")).toString("utf8").match(/ID="([^"]+)"/)[1], relay: p.get("RelayState") };
};

// An answer whose address was changed after signing: nothing is handed out.
const first = await begin();
const forged = await post(signedAnswer(first.id, email).replace(email, "boss@" + domain), first.relay);
must(forged.status === 303 && (forged.headers.get("location") ?? "").includes("/login"), `a forged answer goes back to sign-in (${forged.status} ${forged.headers.get("location")})`);
must(!(forged.headers.getSetCookie?.() ?? []).some((c) => c.startsWith("craton_session=")), "and no session is started");

// The real answer, to a fresh request.
const second = await begin();
const ok = await post(signedAnswer(second.id, email), second.relay);
const target = ok.headers.get("location") ?? "";
must(ok.status === 303, `the real answer is a 303 redirect (${ok.status})`);
must(/\/signup\/sso/.test(target), `a new person is asked to choose a username (${target})`);
must((ok.headers.getSetCookie?.() ?? []).some((c) => /pending/i.test(c)), "with the step remembered in a cookie");
console.log("saml: all checks passed");
