// Sign in with Google (OpenID Connect) or GitHub (OAuth 2.0): authorization code flow with PKCE.
//
// GitHub has no ID token, so after the code is swapped for an access token the account is read from GitHub's own API
// and only an address GitHub itself lists as verified is accepted.
//
// The browser is sent to Google with a one-time `state`, a PKCE challenge and a `nonce`. Google sends it back with a
// code; this server swaps the code for an ID token (a signed JWT) over a direct request and checks it end to end:
// RS256 signature against Google's published keys, issuer, audience, expiry, nonce, and that Google itself says the
// address is verified. Every in-flight value is stored hashed or short-lived, used once, and expires in ten minutes.

import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest } from "./context.ts";
import { config } from "../config.ts";
import { RESERVED_HANDLES } from "./accounts.ts";

export type Provider = "google" | "github";
export const PROVIDERS: Provider[] = ["google", "github"];
export const providerName = (p: Provider) => (p === "google" ? "Google" : "GitHub");
const FLOW_MINUTES = 10;
const PENDING_MINUTES = 15;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const random = (bytes: number) => randomBytes(bytes).toString("base64url");
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const nowIso = () => new Date().toISOString();

export type GoogleClaims = { sub: string; email: string; name: string };

export const enabled = (p: Provider) => (p === "google" ? Boolean(config.google.clientId && config.google.clientSecret) : Boolean(config.github.clientId && config.github.clientSecret));
export const googleEnabled = () => enabled("google");

/** Where Google sends the browser back to: the web app's callback page. Must be listed in the Google console. */
export const redirectUri = (p: Provider = "google") => `${config.webUrl}/auth/${p}/callback`;

/** Only a same-site path survives a round trip through Google. */
function safeNext(next: string | null | undefined) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.includes("\\") && next.length <= 300 ? next : null;
}

export async function startOAuth(ctx: Ctx, provider: Provider, opts: { next?: string | null; linkUserId?: number | null }) {
  if (!enabled(provider)) throw new ApiError(404, "not_configured", `${providerName(provider)} sign-in isn’t set up on this server.`);
  await ctx.db.run("DELETE FROM oauth_flows WHERE expires_at < ?", nowIso());
  const state = random(32);
  const verifier = random(48);
  const nonce = random(16);
  await ctx.db.run("INSERT INTO oauth_flows (state_hash, verifier, nonce, next, link_user_id, expires_at, provider) VALUES (?, ?, ?, ?, ?, ?, ?)", sha(state), verifier, nonce, safeNext(opts.next), opts.linkUserId ?? null, inMinutes(FLOW_MINUTES), provider);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query =
    provider === "google"
      ? new URLSearchParams({
          client_id: config.google.clientId,
          redirect_uri: redirectUri("google"),
          response_type: "code",
          scope: "openid email profile",
          state,
          nonce,
          code_challenge: challenge,
          code_challenge_method: "S256",
          prompt: "select_account",
        })
      : new URLSearchParams({ client_id: config.github.clientId, redirect_uri: redirectUri("github"), scope: "read:user user:email", state, code_challenge: challenge, code_challenge_method: "S256", allow_signup: "true" });
  return { url: `${provider === "google" ? config.google.authUrl : config.github.authUrl}?${query.toString()}`, state };
}

// ── ID token verification ────────────────────────────────────────────────────

type Jwk = { kid?: string; kty?: string; n?: string; e?: string; alg?: string; use?: string };
let keyCache: { at: number; keys: Jwk[] } | null = null;

async function signingKey(kid: string): Promise<Jwk | null> {
  const fresh = keyCache && Date.now() - keyCache.at < 60 * 60_000;
  if (fresh) {
    const hit = keyCache!.keys.find((k) => k.kid === kid);
    if (hit) return hit;
  }
  // Unknown key id, or the cache is old: Google rotates keys, so look again (at most once per call).
  const res = await fetch(config.google.jwksUrl, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new ApiError(502, "google_error", "Couldn’t reach Google to check the sign-in. Try again.");
  const body = (await res.json()) as { keys?: Jwk[] };
  keyCache = { at: Date.now(), keys: body.keys ?? [] };
  return keyCache.keys.find((k) => k.kid === kid) ?? null;
}

/** Forget cached signing keys (tests that rotate keys). */
export function resetKeyCache() {
  keyCache = null;
}

const invalid = () => new ApiError(401, "invalid_id_token", "Google’s answer couldn’t be verified. Try signing in again.");

export async function verifyIdToken(idToken: string, expectedNonce: string): Promise<GoogleClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw invalid();
  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw invalid();
  }
  // Only RS256: never "none", never a symmetric algorithm that could be forged with a public value.
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw invalid();
  const jwk = await signingKey(header.kid);
  if (!jwk) throw invalid();
  const ok = verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"));
  if (!ok) throw invalid();

  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  const exp = typeof claims.exp === "number" ? claims.exp : 0;
  if (typeof claims.iss !== "string" || !config.google.issuers.includes(claims.iss)) throw invalid();
  if (!audience.includes(config.google.clientId)) throw invalid();
  if (exp * 1000 < Date.now() - 60_000) throw invalid();
  if (claims.nonce !== expectedNonce) throw invalid();
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email) throw invalid();
  if (claims.email_verified !== true && claims.email_verified !== "true") {
    throw new ApiError(403, "email_not_verified", "Google hasn’t verified that email address, so it can’t be used to sign in.");
  }
  return { sub: claims.sub, email: claims.email.trim(), name: typeof claims.name === "string" ? claims.name.slice(0, 80) : "" };
}

/** The verified address and account number GitHub knows this access token by. */
async function githubClaims(accessToken: string): Promise<GoogleClaims> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: "application/vnd.github+json", "user-agent": "Craton", "x-github-api-version": "2022-11-28" };
  const call = async (path: string) => {
    let res: Response;
    try {
      res = await fetch(`${config.github.apiUrl}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    } catch {
      throw new ApiError(502, "github_error", "Couldn’t reach GitHub. Try again in a moment.");
    }
    if (!res.ok) throw new ApiError(502, "github_error", "GitHub didn’t return your account. Start again.");
    return res.json();
  };
  const me = (await call("/user")) as { id?: number; login?: string; name?: string | null };
  if (typeof me.id !== "number") throw new ApiError(502, "github_error", "GitHub didn’t return an identity. Start again.");
  const emails = (await call("/user/emails")) as { email?: string; primary?: boolean; verified?: boolean }[];
  // Only an address GitHub says is verified, and the primary one when there is a choice.
  const usable = (Array.isArray(emails) ? emails : []).filter((e) => e.verified === true && typeof e.email === "string" && e.email && !e.email.endsWith("@users.noreply.github.com"));
  const pick = usable.find((e) => e.primary) ?? usable[0];
  if (!pick) throw new ApiError(403, "email_not_verified", "GitHub has no verified email address on your account, so it can’t be used to sign in. Verify one in your GitHub settings and try again.");
  return { sub: String(me.id), email: pick.email!.trim(), name: (me.name || me.login || "").slice(0, 80) };
}

/** Finish a sign-in: check the one-time state, swap the code, and work out who the provider says this is. */
export async function finishOAuth(ctx: Ctx, provider: Provider, input: { code: string; state: string }) {
  const label = providerName(provider);
  if (!enabled(provider)) throw new ApiError(404, "not_configured", `${label} sign-in isn’t set up on this server.`);
  if (!input.code || !input.state) throw badRequest("The sign-in was cut short. Start again.");
  const stateHash = sha(input.state);
  const flow = await ctx.db.get("SELECT verifier, nonce, next, link_user_id, expires_at, provider FROM oauth_flows WHERE state_hash = ?", stateHash) as
    | { verifier: string; nonce: string; next: string | null; link_user_id: number | null; expires_at: string; provider: string }
    | undefined;
  // Single use: gone as soon as it is looked at, whatever happens next.
  await ctx.db.run("DELETE FROM oauth_flows WHERE state_hash = ?", stateHash);
  if (!flow || flow.expires_at < nowIso() || flow.provider !== provider) throw badRequest("This sign-in expired or was already used. Start again.");

  const cfg = provider === "google" ? config.google : config.github;
  let res: Response;
  try {
    res = await fetch(cfg.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        ...(provider === "google" ? { grant_type: "authorization_code" } : {}),
        code: input.code,
        redirect_uri: redirectUri(provider),
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        code_verifier: flow.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new ApiError(502, `${provider}_error`, `Couldn’t reach ${label}. Try again in a moment.`);
  }
  if (!res.ok) throw new ApiError(502, `${provider}_error`, `${label} didn’t accept the sign-in. Start again.`);
  const token = (await res.json()) as { id_token?: string; access_token?: string; error?: string };
  if (provider === "google") {
    if (!token.id_token) throw new ApiError(502, "google_error", "Google didn’t return an identity. Start again.");
    return { claims: await verifyIdToken(token.id_token, flow.nonce), next: flow.next, linkUserId: flow.link_user_id };
  }
  // GitHub answers 200 with { error } for a bad or reused code.
  if (!token.access_token || token.error) throw new ApiError(502, "github_error", "GitHub didn’t accept the sign-in. Start again.");
  return { claims: await githubClaims(token.access_token), next: flow.next, linkUserId: flow.link_user_id };
}

export const startGoogle = (ctx: Ctx, opts: { next?: string | null; linkUserId?: number | null }) => startOAuth(ctx, "google", opts);
export const finishGoogle = (ctx: Ctx, input: { code: string; state: string }) => finishOAuth(ctx, "google", input);

// ── Who is linked to whom ────────────────────────────────────────────────────

export async function identityOwner(ctx: Ctx, subject: string, provider: string = "google"): Promise<number | null> {
  const row = await ctx.db.get("SELECT user_id FROM oauth_identities WHERE provider = ? AND subject = ?", provider, subject) as { user_id: number } | undefined;
  return row?.user_id ?? null;
}

export async function linkIdentity(ctx: Ctx, userId: number, subject: string, email: string, provider: string = "google") {
  await ctx.db.run("INSERT INTO oauth_identities (provider, subject, user_id, email) VALUES (?, ?, ?, ?) ON CONFLICT (provider, subject) DO UPDATE SET user_id = EXCLUDED.user_id, email = EXCLUDED.email, created_at = now_iso()", provider, subject, userId, email);
}

export async function listIdentities(ctx: Ctx, userId: number) {
  return await ctx.db.all("SELECT provider, email, created_at AS since FROM oauth_identities WHERE user_id = ? ORDER BY created_at", userId) as { provider: string; email: string; since: string }[];
}

export async function unlinkIdentity(ctx: Ctx, userId: number, provider: string = "google") {
  return Number((await ctx.db.run("DELETE FROM oauth_identities WHERE provider = ? AND user_id = ?", provider, userId)).changes) > 0;
}

/** The account holding this address, and whether that address was ever confirmed. Case-insensitive. */
export async function userByEmail(ctx: Ctx, email: string): Promise<{ id: number; verified: boolean } | null> {
  const row = await ctx.db.get("SELECT owner_id, email_verified_at FROM users WHERE lower(email) = lower(?)", email) as { owner_id: number; email_verified_at: string | null } | undefined;
  return row ? { id: row.owner_id, verified: Boolean(row.email_verified_at) } : null;
}

// ── First sign-in: the person still has to pick a username ───────────────────

export async function createPending(ctx: Ctx, input: { subject: string; email: string; name: string }, provider: string = "google") {
  await ctx.db.run("DELETE FROM oauth_pending WHERE expires_at < ?", nowIso());
  const ticket = random(32);
  await ctx.db.run("INSERT INTO oauth_pending (ticket_hash, provider, subject, email, name, expires_at) VALUES (?, ?, ?, ?, ?, ?)", sha(ticket), provider, input.subject, input.email, input.name, inMinutes(PENDING_MINUTES));
  return ticket;
}

/** `provider` "sso" matches a ticket from any organization's single sign-on ("sso:<id>"). */
export async function readPending(ctx: Ctx, ticket: string, provider: Provider | "sso" = "google") {
  const row = await ctx.db.get("SELECT subject, email, name, expires_at, provider FROM oauth_pending WHERE ticket_hash = ?", sha(ticket ?? "")) as
    | { subject: string; email: string; name: string; expires_at: string; provider: string }
    | undefined;
  const matches = row && (provider === "sso" ? row.provider.startsWith("sso:") : row.provider === provider);
  if (!row || row.expires_at < nowIso() || !matches) throw new ApiError(400, "invalid_ticket", `This step expired. Sign in with ${provider === "sso" ? "single sign-on" : providerName(provider)} again.`);
  return row;
}

export async function dropPending(ctx: Ctx, ticket: string) {
  await ctx.db.run("DELETE FROM oauth_pending WHERE ticket_hash = ?", sha(ticket ?? ""));
}

/** A free, valid username derived from the address (or the name), for the form to start from. */
export async function suggestHandle(ctx: Ctx, email: string, name: string): Promise<string> {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
  let base = clean(email.split("@")[0]) || clean(name) || "user";
  if (base.length < 2) base = `${base}user`;
  const taken = async (h: string) => RESERVED_HANDLES.has(h) || Boolean(await ctx.db.get("SELECT 1 FROM owners WHERE handle = ?", h));
  if (!await taken(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!await taken(candidate)) return candidate;
  }
  return `${base}-${random(3).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
}
