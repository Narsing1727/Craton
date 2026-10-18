// SAML 2.0 single sign-on for an organization: the other way an organization's own identity provider (Okta, Microsoft Entra ID,
// OneLogin, ADFS, Shibboleth, Google Workspace) can say who someone is, beside OpenID Connect (sso.ts). It follows the same rules:
//
//   - the provider may only vouch for addresses at a domain the organization has VERIFIED, so it cannot speak for gmail.com or for
//     another organization's domain;
//   - an existing account whose address was never confirmed is refused rather than merged;
//   - an owner can then require it of the organization's members (owners exempt, so a broken provider cannot lock everyone out);
//   - the person who signs in joins the organization.
//
// The cryptography is not written here. XML signatures, certificates, audience, issuer, validity window and clock skew are checked by
// node-saml (the library behind passport-saml). What this file adds: signatures are mandatory (the response or the assertion must be
// signed by the certificate the owner saved), only the service-provider-initiated flow is accepted (every answer must reply to a
// request we made, once: IdP-initiated answers and replays are refused), and that request is remembered in the database so any of
// several servers can receive the answer.

import { X509Certificate } from "node:crypto";
import { createHash, randomBytes } from "node:crypto";
import { generateServiceProviderMetadata, SAML, ValidateInResponseTo, type CacheItem, type CacheProvider, type Profile } from "@node-saml/node-saml";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest, forbidden, notFound } from "./context.ts";
import { config } from "../config.ts";
import { getOwner, orgRole } from "./accounts.ts";
import { verifiedDomains } from "./domains.ts";
import { SSO_PREFIX } from "./sso.ts";

const FLOW_MINUTES = 10;
export const SUBJECT_PREFIX = "saml:";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const random = (n: number) => randomBytes(n).toString("base64url");
const nowIso = () => new Date().toISOString();
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const emailDomain = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();
const safeNext = (n: string | null | undefined) => (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") && n.length <= 300 ? n : null);

type Row = { org_id: number; idp_entity_id: string; sso_url: string; idp_cert: string; enforced: number; tested_at: string | null; created_at: string };
const rowOf = async (ctx: Ctx, orgId: number) => await ctx.db.get("SELECT * FROM org_saml WHERE org_id = ?", orgId) as Row | undefined;

/** What the identity provider's administrator is asked to enter: where to send the answer, and who we are. */
export const serviceProvider = (orgHandle: string) => ({
  entityId: `${config.publicApiUrl}/v1/saml/${orgHandle}/metadata`,
  acsUrl: `${config.webUrl}/auth/saml/acs`,
  metadataUrl: `${config.publicApiUrl}/v1/saml/${orgHandle}/metadata`,
});

async function ownedOrg(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = await getOwner(ctx, orgHandle);
  if (org.kind !== "org") throw notFound(`Organization ${orgHandle}`);
  const role = await orgRole(ctx, org.id, actorId);
  if (!role) throw notFound(`Organization ${orgHandle}`);
  if (role !== "Owner") throw forbidden(`Only owners of ${org.handle} can manage single sign-on.`);
  return org;
}

/** Certificates as providers hand them over: PEM, or the bare base64 of a .cer file. Returns PEM, checked to be real and not expired. */
export function normalizeCertificates(input: unknown): { pem: string; expires: string; fingerprint: string } {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) throw badRequest("Paste the identity provider's signing certificate.");
  const blocks = text.includes("BEGIN CERTIFICATE")
    ? [...text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((m) => m[1])
    : [text];
  if (!blocks.length || blocks.length > 4) throw badRequest("Paste one certificate, or up to four (the old and the new during a rollover).");
  const pems: string[] = [];
  let soonest = Infinity;
  let first: X509Certificate | null = null;
  for (const block of blocks) {
    const body = block.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/=]{100,}$/.test(body)) throw badRequest("That doesn't look like a certificate. It should be PEM (-----BEGIN CERTIFICATE-----) or its base64 text.");
    const pem = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----`;
    let cert: X509Certificate;
    try {
      cert = new X509Certificate(pem);
    } catch {
      throw badRequest("That isn't a readable X.509 certificate.");
    }
    if (Date.parse(cert.validTo) < Date.now()) throw badRequest(`That certificate expired on ${new Date(cert.validTo).toISOString().slice(0, 10)}. Download the current one from your identity provider.`);
    soonest = Math.min(soonest, Date.parse(cert.validTo));
    first ??= cert;
    pems.push(pem);
  }
  return { pem: pems.join("\n"), expires: new Date(soonest).toISOString(), fingerprint: first!.fingerprint256 };
}

const view = async (ctx: Ctx, org: { id: number; handle: string }, r: Row | undefined) => {
  const base = { sp: serviceProvider(org.handle), domains: await verifiedDomains(ctx, org.id) };
  if (!r) return { configured: false as const, ...base };
  const cert = normalizeCertificates(r.idp_cert);
  return { configured: true as const, entityId: r.idp_entity_id, ssoUrl: r.sso_url, certificateExpires: cert.expires, fingerprint: cert.fingerprint, enforced: Boolean(r.enforced), testedAt: r.tested_at, ...base };
};

export async function getConfig(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  return view(ctx, org, await rowOf(ctx, org.id));
}

function validUrl(value: unknown, what: string) {
  let u: URL;
  try {
    u = new URL(String(value ?? "").trim());
  } catch {
    throw badRequest(`${what} must be a web address.`);
  }
  // Plain http is for a provider on a development machine only.
  if (u.protocol !== "https:" && !(u.protocol === "http:" && config.webhooks.allowPrivate)) throw badRequest(`${what} must start with https://.`);
  return u.toString();
}

export async function configure(ctx: Ctx, orgHandle: string, actorId: number, input: { ssoUrl?: unknown; entityId?: unknown; certificate?: unknown }) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  if (!(await verifiedDomains(ctx, org.id)).length) throw badRequest(`Verify a domain for ${org.handle} first: single sign-on only applies to addresses at a domain it has proved it controls.`);
  const ssoUrl = validUrl(input.ssoUrl, "The sign-in URL");
  const entityId = String(input.entityId ?? "").trim().slice(0, 500);
  if (!entityId) throw badRequest("Enter the identity provider's entity ID (its issuer).");
  const existing = await rowOf(ctx, org.id);
  const certificate = input.certificate === undefined || input.certificate === "" ? (existing ? { pem: existing.idp_cert } : null) : normalizeCertificates(input.certificate);
  if (!certificate) throw badRequest("Paste the identity provider's signing certificate.");
  // A changed provider has not been tested, so it cannot stay required.
  const same = Boolean(existing && existing.idp_entity_id === entityId && existing.sso_url === ssoUrl && existing.idp_cert === certificate.pem);
  await ctx.db.run(
    `INSERT INTO org_saml (org_id, idp_entity_id, sso_url, idp_cert) VALUES (?, ?, ?, ?)
     ON CONFLICT (org_id) DO UPDATE SET idp_entity_id = excluded.idp_entity_id, sso_url = excluded.sso_url, idp_cert = excluded.idp_cert,
       enforced = CASE WHEN (?::int) = 1 THEN org_saml.enforced ELSE 0 END, tested_at = CASE WHEN (?::int) = 1 THEN org_saml.tested_at ELSE NULL END`,
    org.id, entityId, ssoUrl, certificate.pem, same ? 1 : 0, same ? 1 : 0,
  );
  return view(ctx, org, await rowOf(ctx, org.id));
}

export async function setEnforced(ctx: Ctx, orgHandle: string, actorId: number, on: unknown) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  const row = await rowOf(ctx, org.id);
  if (!row) throw notFound("SAML setup");
  if (typeof on !== "boolean") throw badRequest("Send { enforced: true } or { enforced: false }.");
  if (on && !row.tested_at) throw badRequest("Sign in through single sign-on once yourself before requiring it, so you know it works. (Owners are never locked out, but everyone else would be.)");
  await ctx.db.run("UPDATE org_saml SET enforced = ? WHERE org_id = ?", on ? 1 : 0, org.id);
  return view(ctx, org, await rowOf(ctx, org.id));
}

export async function remove(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = await ownedOrg(ctx, orgHandle, actorId);
  if (!await rowOf(ctx, org.id)) throw notFound("SAML setup");
  await ctx.db.run("DELETE FROM org_saml WHERE org_id = ?", org.id);
  // People who signed in this way keep their accounts; the link just stops being usable.
  await ctx.db.run("DELETE FROM oauth_identities WHERE provider = ? AND subject LIKE ?", `${SSO_PREFIX}${org.id}`, `${SUBJECT_PREFIX}%`);
}

/** The first successful sign-in proves the setup works; only then can it be required. */
export async function markTested(ctx: Ctx, orgId: number) {
  await ctx.db.run("UPDATE org_saml SET tested_at = COALESCE(tested_at, ?) WHERE org_id = ?", nowIso(), orgId);
}

/** The organization whose verified domain this address is at, if it has SAML set up. */
export async function orgForEmail(ctx: Ctx, email: string) {
  const hit = await ctx.db.get("SELECT d.org_id, o.handle FROM org_domains d JOIN owners o ON o.id = d.org_id JOIN org_saml s ON s.org_id = d.org_id WHERE d.domain = ? AND d.verified_at IS NOT NULL", emailDomain(email)) as
    | { org_id: number; handle: string }
    | undefined;
  return hit ? { orgId: hit.org_id, handle: hit.handle } : null;
}

// ── The protocol ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Requests we made and have not had answered, in the database: single use, and valid on whichever server the answer reaches. */
class RequestStore implements CacheProvider {
  private readonly ctx: Ctx;
  constructor(ctx: Ctx) {
    this.ctx = ctx;
  }
  // The library stores the instant the request was made, and reads it back to check the answer is not too old.
  async saveAsync(key: string, value: string): Promise<CacheItem | null> {
    await this.ctx.db.run("DELETE FROM saml_requests WHERE expires_at < ?", nowIso());
    await this.ctx.db.run("INSERT INTO saml_requests (id, issued_at, expires_at) VALUES (?, ?, ?) ON CONFLICT (id) DO NOTHING", key, value, inMinutes(FLOW_MINUTES));
    return { value, createdAt: Date.now() };
  }
  async getAsync(key: string): Promise<string | null> {
    const row = await this.ctx.db.get("SELECT issued_at FROM saml_requests WHERE id = ? AND expires_at >= ?", key, nowIso()) as { issued_at: string } | undefined;
    return row?.issued_at ?? null;
  }
  async removeAsync(key: string | null): Promise<string | null> {
    if (key === null) return null;
    const row = await this.ctx.db.get("DELETE FROM saml_requests WHERE id = ? RETURNING issued_at", key) as { issued_at: string } | undefined;
    return row?.issued_at ?? null;
  }
}

function samlFor(ctx: Ctx, org: { id: number; handle: string }, r: Row) {
  const sp = serviceProvider(org.handle);
  return new SAML({
    issuer: sp.entityId,
    callbackUrl: sp.acsUrl,
    audience: sp.entityId,
    entryPoint: r.sso_url,
    idpIssuer: r.idp_entity_id,
    idpCert: r.idp_cert.split(/(?=-----BEGIN CERTIFICATE-----)/).map((c) => c.trim()),
    identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
    // Either the whole response or the assertion must carry a valid signature (providers differ in which they sign); never neither.
    wantAuthnResponseSigned: false,
    wantAssertionsSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: FLOW_MINUTES * 60_000,
    cacheProvider: new RequestStore(ctx),
    acceptedClockSkewMs: 2 * 60_000,
    maxAssertionAgeMs: 10 * 60_000,
    disableRequestedAuthnContext: true,
    signatureAlgorithm: "sha256",
  });
}

/** Service-provider metadata an administrator can upload instead of typing the two addresses. */
export async function metadata(ctx: Ctx, orgHandle: string) {
  const org = await getOwner(ctx, orgHandle).catch(() => null);
  if (!org || org.kind !== "org" || !await rowOf(ctx, org.id)) throw notFound("SAML setup");
  const sp = serviceProvider(org.handle);
  return generateServiceProviderMetadata({ issuer: sp.entityId, callbackUrl: sp.acsUrl, identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress", wantAssertionsSigned: true });
}

/** Step 1: the address says which organization's provider to use; the browser is sent there with a request we will recognise. */
export async function start(ctx: Ctx, org: { orgId: number; handle: string }, input: { email: string; next?: string | null }) {
  const row = await rowOf(ctx, org.orgId);
  if (!row) throw new ApiError(404, "sso_not_configured", "Single sign-on was turned off for this organization.");
  await ctx.db.run("DELETE FROM oauth_flows WHERE expires_at < ?", nowIso());
  const state = random(32);
  await ctx.db.run("INSERT INTO oauth_flows (state_hash, verifier, nonce, next, link_user_id, expires_at, provider) VALUES (?, ?, ?, ?, NULL, ?, ?)", sha(state), "saml", "saml", safeNext(input.next), inMinutes(FLOW_MINUTES), `${SSO_PREFIX}${org.orgId}`);
  const url = await samlFor(ctx, { id: org.orgId, handle: org.handle }, row).getAuthorizeUrlAsync(state, undefined, {});
  return { url, state, protocol: "saml" as const };
}

const first = (v: unknown): string => (Array.isArray(v) ? first(v[0]) : typeof v === "string" ? v : typeof v === "object" && v && "_" in v ? String((v as { _: unknown })._) : "");
const attr = (p: Profile, ...names: string[]) => names.map((n) => first(p[n]).trim()).find(Boolean) ?? "";

export type SamlClaims = { sub: string; email: string; name: string };

/** Step 2: the provider's answer. Verified by node-saml; then the address is held to the organization's verified domains. */
export async function finish(ctx: Ctx, input: { samlResponse: string; relayState: string }): Promise<{ claims: SamlClaims; next: string | null; orgId: number; orgHandle: string; provider: string }> {
  if (!input.samlResponse || !input.relayState) throw badRequest("The sign-in was cut short. Start again.");
  const stateHash = sha(input.relayState);
  const flow = await ctx.db.get("SELECT next, expires_at, provider FROM oauth_flows WHERE state_hash = ?", stateHash) as { next: string | null; expires_at: string; provider: string } | undefined;
  await ctx.db.run("DELETE FROM oauth_flows WHERE state_hash = ?", stateHash); // single use, whatever happens next
  if (!flow || flow.expires_at < nowIso() || !flow.provider.startsWith(SSO_PREFIX)) throw badRequest("This sign-in expired or was already used. Start again.");
  const orgId = Number(flow.provider.slice(SSO_PREFIX.length));
  const row = await rowOf(ctx, orgId);
  if (!row) throw new ApiError(404, "sso_not_configured", "Single sign-on was turned off for this organization.");
  const org = await getOwner(ctx, (await ctx.db.get("SELECT handle FROM owners WHERE id = ?", orgId) as { handle: string }).handle);

  let profile: Profile | null;
  try {
    ({ profile } = await samlFor(ctx, org, row).validatePostResponseAsync({ SAMLResponse: input.samlResponse, RelayState: input.relayState }));
  } catch (err) {
    // Why exactly (a bad signature, the wrong audience, an old assertion) goes to the log, not to whoever sent it.
    console.warn(`SAML response for ${org.handle} refused: ${(err as Error).message}`);
    throw new ApiError(401, "sso_error", "Your identity provider's answer couldn't be verified. Start again, and if it keeps happening ask an owner to check the SAML setup.");
  }
  if (!profile?.nameID) throw new ApiError(401, "sso_error", "Your identity provider didn't say who you are. Ask an owner to check the SAML setup.");
  // node-saml checks the signature, audience and times; the assertion's own issuer must also be the provider the owner named
  // (a signing certificate can be shared by several entities at one provider).
  if (profile.issuer !== row.idp_entity_id) {
    console.warn(`SAML response for ${org.handle} refused: issuer ${String(profile.issuer)} is not ${row.idp_entity_id}`);
    throw new ApiError(401, "sso_error", "Your identity provider's answer couldn't be verified. Start again, and if it keeps happening ask an owner to check the SAML setup.");
  }

  const email = (attr(profile, "email", "mail", "urn:oid:0.9.2342.19200300.100.1.3", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn") || (profile.nameID.includes("@") ? profile.nameID : "")).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(403, "no_email", "Your identity provider didn't send an email address. Ask an owner to map the email attribute.");
  // The provider may only speak for the organization's own, verified, domains.
  if (!(await verifiedDomains(ctx, orgId)).includes(emailDomain(email))) {
    throw new ApiError(403, "domain_not_verified", `${email} isn’t at a domain ${org.handle} has verified, so ${org.handle}’s single sign-on can’t vouch for it.`);
  }
  const given = attr(profile, "givenName", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname");
  const family = attr(profile, "sn", "surname", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname");
  const name = (attr(profile, "displayName", "name", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name") || `${given} ${family}`.trim() || email.split("@")[0]).slice(0, 80);
  return { claims: { sub: `${SUBJECT_PREFIX}${profile.nameID}`, email, name }, next: safeNext(flow.next), orgId, orgHandle: org.handle, provider: flow.provider };
}
