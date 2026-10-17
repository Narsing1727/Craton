// Single sign-on for an organization: OpenID Connect against the organization's own identity provider (Microsoft Entra ID,
// Okta, Keycloak, Google Workspace, Auth0, a university's Shibboleth gateway with an OIDC front: anything that publishes
// /.well-known/openid-configuration).
//
// Why it is safe to let an organization's provider say who someone is: it only counts for addresses at a domain the
// organization has VERIFIED (domains.ts), so a provider cannot vouch for an address at gmail.com or at another
// organization's domain. Everything else follows the Google flow: a one-time state, PKCE, a nonce, RS256 signature,
// issuer, audience and expiry checked, and an existing account whose address was never confirmed is refused rather than
// merged. An owner can then require SSO for the organization's people; owners themselves are exempt, so a broken provider
// cannot lock everyone out.

import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest, forbidden, notFound } from "./context.ts";
import { config } from "../config.ts";
import { addMember, getOwner, orgRole } from "./accounts.ts";
import { decryptSecret, encryptSecret } from "./secrets.ts";
import { guardedRequest } from "./safeget.ts";
import { verifiedDomains } from "./domains.ts";
import { validateUrl } from "./webhooks.ts";

const FLOW_MINUTES = 10;
export const SSO_PREFIX = "sso:";

const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const random = (n: number) => randomBytes(n).toString("base64url");
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const nowIso = () => new Date().toISOString();
const trimSlash = (s: string) => s.replace(/\/+$/, "");

/** The one address every organization registers with its provider. */
export const redirectUri = () => `${config.webUrl}/auth/sso/callback`;

type Row = {
  org_id: number;
  issuer: string;
  client_id: string;
  client_secret: string;
  auth_url: string;
  token_url: string;
  jwks_url: string;
  auth_method: "post" | "basic";
  enforced: number;
  tested_at: string | null;
  created_at: string;
};

const rowOf = (ctx: Ctx, orgId: number) => ctx.db.prepare("SELECT * FROM org_sso WHERE org_id = ?").get(orgId) as Row | undefined;

function ownedOrg(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = getOwner(ctx, orgHandle);
  if (org.kind !== "org") throw notFound(`Organization ${orgHandle}`);
  const role = orgRole(ctx, org.id, actorId);
  if (!role) throw notFound(`Organization ${orgHandle}`);
  if (role !== "Owner") throw forbidden(`Only owners of ${org.handle} can manage single sign-on.`);
  return org;
}

const view = (ctx: Ctx, orgId: number, r: Row | undefined) =>
  r
    ? { configured: true, issuer: r.issuer, clientId: r.client_id, hasSecret: true, enforced: Boolean(r.enforced), testedAt: r.tested_at, redirectUri: redirectUri(), domains: verifiedDomains(ctx, orgId) }
    : { configured: false, redirectUri: redirectUri(), domains: verifiedDomains(ctx, orgId) };

export function getConfig(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = ownedOrg(ctx, orgHandle, actorId);
  return view(ctx, org.id, rowOf(ctx, org.id));
}

// ── Setting it up ────────────────────────────────────────────────────────────

type Discovery = { issuer?: string; authorization_endpoint?: string; token_endpoint?: string; jwks_uri?: string; token_endpoint_auth_methods_supported?: string[] };

async function discover(issuerInput: string) {
  const issuer = trimSlash(issuerInput.trim());
  let u: URL;
  try {
    u = validateUrl(issuer);
  } catch {
    throw badRequest("The issuer is the address your identity provider publishes, like https://login.microsoftonline.com/<tenant>/v2.0 or https://dev-123.okta.com.");
  }
  if (u.search || u.hash) throw badRequest("The issuer is an address without a query or fragment.");
  let reply;
  try {
    reply = await guardedRequest({ method: "GET", url: `${issuer}/.well-known/openid-configuration`, headers: { accept: "application/json" } });
  } catch (err) {
    if (err instanceof ApiError && err.status === 400) throw err;
    throw new ApiError(422, "discovery_failed", `Couldn’t reach ${issuer}/.well-known/openid-configuration. Check the issuer address.`);
  }
  let doc: Discovery;
  try {
    doc = JSON.parse(reply.text) as Discovery;
  } catch {
    doc = {};
  }
  if (reply.status !== 200 || !doc.issuer) throw new ApiError(422, "discovery_failed", `${issuer}/.well-known/openid-configuration didn’t answer with an OpenID Connect configuration (HTTP ${reply.status}).`);
  if (trimSlash(doc.issuer) !== issuer) throw new ApiError(422, "issuer_mismatch", `The provider says its issuer is ${doc.issuer}, not ${issuer}. Use exactly what it says.`);
  for (const k of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    if (typeof doc[k] !== "string") throw new ApiError(422, "discovery_failed", `The provider’s configuration has no ${k}.`);
    try {
      validateUrl(doc[k]!);
    } catch {
      throw new ApiError(422, "discovery_failed", `The provider’s ${k} isn’t a public https address.`);
    }
  }
  const methods = doc.token_endpoint_auth_methods_supported;
  const basicOnly = Array.isArray(methods) && !methods.includes("client_secret_post") && methods.includes("client_secret_basic");
  return { issuer: doc.issuer, authUrl: doc.authorization_endpoint!, tokenUrl: doc.token_endpoint!, jwksUrl: doc.jwks_uri!, authMethod: (basicOnly ? "basic" : "post") as "post" | "basic" };
}

export async function configure(ctx: Ctx, orgHandle: string, actorId: number, input: { issuer?: unknown; clientId?: unknown; clientSecret?: unknown }) {
  const org = ownedOrg(ctx, orgHandle, actorId);
  if (verifiedDomains(ctx, org.id).length === 0) throw badRequest(`Verify a domain for ${org.handle} first (Settings → Domains): single sign-on only applies to addresses at a domain the organization has proved it controls.`);
  const existing = rowOf(ctx, org.id);
  const clientId = String(input.clientId ?? "").trim();
  const secretGiven = typeof input.clientSecret === "string" && input.clientSecret.length > 0;
  if (!input.issuer || !clientId) throw badRequest("Give the issuer and the client id from your identity provider.");
  if (clientId.length > 300) throw badRequest("That client id is too long.");
  if (!secretGiven && !existing) throw badRequest("Give the client secret from your identity provider.");
  const found = await discover(String(input.issuer));
  const secret = secretGiven ? encryptSecret(String(input.clientSecret)) : existing!.client_secret;
  // A changed provider or client has not been tested, so it cannot stay enforced.
  const same = existing && existing.issuer === found.issuer && existing.client_id === clientId;
  ctx.db
    .prepare(
      `INSERT INTO org_sso (org_id, issuer, client_id, client_secret, auth_url, token_url, jwks_url, auth_method, enforced, tested_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL)
       ON CONFLICT (org_id) DO UPDATE SET issuer = excluded.issuer, client_id = excluded.client_id, client_secret = excluded.client_secret, auth_url = excluded.auth_url,
         token_url = excluded.token_url, jwks_url = excluded.jwks_url, auth_method = excluded.auth_method,
         enforced = CASE WHEN ? THEN enforced ELSE 0 END, tested_at = CASE WHEN ? THEN tested_at ELSE NULL END`,
    )
    .run(org.id, found.issuer, clientId, secret, found.authUrl, found.tokenUrl, found.jwksUrl, found.authMethod, same ? 1 : 0, same ? 1 : 0);
  return view(ctx, org.id, rowOf(ctx, org.id));
}

export function setEnforced(ctx: Ctx, orgHandle: string, actorId: number, on: unknown) {
  const org = ownedOrg(ctx, orgHandle, actorId);
  const row = rowOf(ctx, org.id);
  if (!row) throw notFound("Single sign-on setup");
  if (typeof on !== "boolean") throw badRequest("Send { enforced: true } or { enforced: false }.");
  if (on && !row.tested_at) throw badRequest("Sign in through single sign-on once yourself before requiring it, so you know it works. (Owners are never locked out, but everyone else would be.)");
  ctx.db.prepare("UPDATE org_sso SET enforced = ? WHERE org_id = ?").run(on ? 1 : 0, org.id);
  return view(ctx, org.id, rowOf(ctx, org.id));
}

export function remove(ctx: Ctx, orgHandle: string, actorId: number) {
  const org = ownedOrg(ctx, orgHandle, actorId);
  if (!rowOf(ctx, org.id)) throw notFound("Single sign-on setup");
  ctx.db.prepare("DELETE FROM org_sso WHERE org_id = ?").run(org.id);
  // People who signed in this way keep their accounts; the link just stops being usable.
  ctx.db.prepare("DELETE FROM oauth_identities WHERE provider = ?").run(`${SSO_PREFIX}${org.id}`);
}

// ── Who has single sign-on ───────────────────────────────────────────────────

const emailDomain = (email: string) => email.slice(email.lastIndexOf("@") + 1).toLowerCase();

/** The organization whose verified domain this address is at, if it has single sign-on set up. */
export function orgForEmail(ctx: Ctx, email: string): { orgId: number; handle: string; row: Row } | null {
  const hit = ctx.db
    .prepare("SELECT d.org_id, o.handle FROM org_domains d JOIN owners o ON o.id = d.org_id JOIN org_sso s ON s.org_id = d.org_id WHERE d.domain = ? AND d.verified_at IS NOT NULL")
    .get(emailDomain(email)) as { org_id: number; handle: string } | undefined;
  return hit ? { orgId: hit.org_id, handle: hit.handle, row: rowOf(ctx, hit.org_id)! } : null;
}

/**
 * Refuse a sign-in method that is not single sign-on for someone the organization requires it of: a member (not an owner)
 * whose confirmed address is at a verified domain of an organization that enforces SSO.
 */
export function assertMethodAllowed(ctx: Ctx, userId: number, via: "password" | "google" | "github" | "passkey" | "sso") {
  if (via === "sso") return;
  const u = ctx.db.prepare("SELECT email FROM users WHERE owner_id = ?").get(userId) as { email: string } | undefined;
  if (!u) return;
  const org = orgForEmail(ctx, u.email);
  if (!org || !org.row.enforced) return;
  const role = orgRole(ctx, org.orgId, userId);
  if (!role || role === "Owner") return;
  throw new ApiError(403, "sso_required", `${org.handle} requires single sign-on for ${emailDomain(u.email)} addresses. Choose “Continue with single sign-on” and enter your work email.`, { organization: org.handle });
}

// ── Signing in ───────────────────────────────────────────────────────────────

const safeNext = (n: string | null | undefined) => (n && n.startsWith("/") && !n.startsWith("//") && !n.includes("\\") && n.length <= 300 ? n : null);

export function start(ctx: Ctx, input: { email?: unknown; next?: string | null }) {
  const email = String(input.email ?? "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw badRequest("Enter your work email address.");
  const org = orgForEmail(ctx, email);
  if (!org) throw new ApiError(404, "sso_not_configured", `No organization has single sign-on for ${emailDomain(email)} addresses. Sign in another way, or ask an owner of your organization to set it up.`);
  ctx.db.prepare("DELETE FROM oauth_flows WHERE expires_at < ?").run(nowIso());
  const state = random(32);
  const verifier = random(48);
  const nonce = random(16);
  ctx.db
    .prepare("INSERT INTO oauth_flows (state_hash, verifier, nonce, next, link_user_id, expires_at, provider) VALUES (?, ?, ?, ?, NULL, ?, ?)")
    .run(sha(state), verifier, nonce, safeNext(input.next), inMinutes(FLOW_MINUTES), `${SSO_PREFIX}${org.orgId}`);
  const q = new URLSearchParams({
    client_id: org.row.client_id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    login_hint: email,
  });
  return { url: `${org.row.auth_url}${org.row.auth_url.includes("?") ? "&" : "?"}${q.toString()}`, state };
}

// Signing keys per provider, kept an hour and fetched again when a key id is not in the set.
const keyCache = new Map<string, { at: number; keys: Jwk[] }>();
type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string; use?: string };
export const resetKeyCache = () => keyCache.clear();

async function signingKey(jwksUrl: string, kid: string | undefined): Promise<Jwk | null> {
  const pick = (keys: Jwk[]) => (kid ? keys.find((k) => k.kid === kid) : keys.length === 1 ? keys[0] : undefined) ?? null;
  const cached = keyCache.get(jwksUrl);
  if (cached && Date.now() - cached.at < 3_600_000) {
    const hit = pick(cached.keys);
    if (hit) return hit;
  }
  const reply = await guardedRequest({ method: "GET", url: jwksUrl, headers: { accept: "application/json" } }).catch(() => null);
  if (!reply || reply.status !== 200) throw new ApiError(502, "sso_error", "Couldn’t fetch your identity provider’s signing keys. Try again in a moment.");
  let keys: Jwk[] = [];
  try {
    keys = ((JSON.parse(reply.text) as { keys?: Jwk[] }).keys ?? []).filter((k) => k.kty === "RSA");
  } catch {}
  keyCache.set(jwksUrl, { at: Date.now(), keys });
  return pick(keys);
}

const bad = () => new ApiError(401, "invalid_id_token", "Your identity provider’s answer couldn’t be verified. Try signing in again.");

async function verifyIdToken(row: Row, idToken: string, nonce: string) {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw bad();
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw bad();
  }
  if (header.alg !== "RS256") throw bad(); // never "none", never a symmetric algorithm
  const jwk = await signingKey(row.jwks_url, header.kid);
  if (!jwk) throw bad();
  if (!verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"))) throw bad();
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  const iat = typeof claims.iat === "number" ? claims.iat : 0;
  if (claims.iss !== row.issuer) throw bad();
  if (!aud.includes(row.client_id) || (aud.length > 1 && claims.azp !== row.client_id)) throw bad();
  if (exp * 1000 < Date.now() - 60_000 || iat * 1000 > Date.now() + 5 * 60_000) throw bad();
  if (claims.nonce !== nonce) throw bad();
  if (typeof claims.sub !== "string" || !claims.sub) throw bad();
  // Entra ID and others put the address in `preferred_username` or `upn` when there is no `email` claim.
  const candidate = [claims.email, claims.preferred_username, claims.upn].find((v) => typeof v === "string" && /^[^@\s]+@[^@\s]+$/.test(v)) as string | undefined;
  if (!candidate) throw new ApiError(403, "no_email", "Your identity provider didn’t send an email address. Ask its administrator to include the email scope and claim.");
  if (claims.email_verified === false || claims.email_verified === "false") throw new ApiError(403, "email_not_verified", "Your identity provider says that email address isn’t verified, so it can’t be used to sign in.");
  return { sub: claims.sub, email: candidate.trim(), name: typeof claims.name === "string" ? claims.name.slice(0, 80) : "" };
}

export type SsoClaims = { sub: string; email: string; name: string };

/** Finish a sign-in: the one-time state, the code swapped for tokens, the ID token checked, and the address held to the organization's verified domains. */
export async function finish(ctx: Ctx, input: { code: string; state: string }): Promise<{ claims: SsoClaims; next: string | null; orgId: number; orgHandle: string; provider: string }> {
  if (!input.code || !input.state) throw badRequest("The sign-in was cut short. Start again.");
  const stateHash = sha(input.state);
  const flow = ctx.db.prepare("SELECT verifier, nonce, next, expires_at, provider FROM oauth_flows WHERE state_hash = ?").get(stateHash) as
    | { verifier: string; nonce: string; next: string | null; expires_at: string; provider: string }
    | undefined;
  ctx.db.prepare("DELETE FROM oauth_flows WHERE state_hash = ?").run(stateHash); // single use, whatever happens next
  if (!flow || flow.expires_at < nowIso() || !flow.provider.startsWith(SSO_PREFIX)) throw badRequest("This sign-in expired or was already used. Start again.");
  const orgId = Number(flow.provider.slice(SSO_PREFIX.length));
  const row = rowOf(ctx, orgId);
  if (!row) throw new ApiError(404, "sso_not_configured", "Single sign-on was turned off for this organization.");
  const org = getOwner(ctx, (ctx.db.prepare("SELECT handle FROM owners WHERE id = ?").get(orgId) as { handle: string }).handle);

  const form = new URLSearchParams({ grant_type: "authorization_code", code: input.code, redirect_uri: redirectUri(), code_verifier: flow.verifier });
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  const secret = decryptSecret(row.client_secret);
  if (row.auth_method === "basic") headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(row.client_id)}:${encodeURIComponent(secret)}`).toString("base64")}`;
  else {
    form.set("client_id", row.client_id);
    form.set("client_secret", secret);
  }
  const reply = await guardedRequest({ method: "POST", url: row.token_url, headers, body: form.toString() }).catch(() => null);
  if (!reply) throw new ApiError(502, "sso_error", "Couldn’t reach your identity provider. Try again in a moment.");
  let token: { id_token?: string } = {};
  try {
    token = JSON.parse(reply.text);
  } catch {}
  if (reply.status !== 200 || !token.id_token) throw new ApiError(502, "sso_error", "Your identity provider didn’t accept the sign-in. Start again.");
  const claims = await verifyIdToken(row, token.id_token, flow.nonce);
  // The provider may only speak for the organization's own, verified, domains.
  if (!verifiedDomains(ctx, orgId).includes(emailDomain(claims.email))) {
    throw new ApiError(403, "domain_not_verified", `${claims.email} isn’t at a domain ${org.handle} has verified, so ${org.handle}’s single sign-on can’t vouch for it.`);
  }
  return { claims, next: safeNext(flow.next), orgId, orgHandle: org.handle, provider: flow.provider };
}

/** The first successful sign-in proves the setup works; only then can it be required. */
export function markTested(ctx: Ctx, orgId: number) {
  ctx.db.prepare("UPDATE org_sso SET tested_at = COALESCE(tested_at, ?) WHERE org_id = ?").run(nowIso(), orgId);
}

/** A person who came through the organization's provider belongs to the organization. */
export function joinOrg(ctx: Ctx, orgId: number, userId: number) {
  if (!orgRole(ctx, orgId, userId)) addMember(ctx, orgId, userId, "Member");
}

