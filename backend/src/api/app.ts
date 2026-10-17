// Craton REST API (Hono). Mounted at /v1.

import * as textdiff from "../services/textdiff.ts";
import * as blame from "../services/blame.ts";
import * as codeOwners from "../services/owners.ts";
import { buildOpenApi } from "./openapi.ts";
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { cors } from "hono/cors";
import { compress } from "hono/compress";
import { createHash } from "node:crypto";
import { secureHeaders } from "hono/secure-headers";
import type { Ctx } from "../services/context.ts";
import { ApiError, badRequest, notFound } from "../services/context.ts";
import * as accounts from "../services/accounts.ts";
import * as repos from "../services/repos.ts";
import { datasetJsonLd } from "../services/dataset.ts";
import * as chunks from "../services/chunks.ts";
import * as history from "../services/history.ts";
import * as collab from "../services/collab.ts";
import * as releases from "../services/releases.ts";
import * as stats from "../services/stats.ts";
import * as files from "../services/files.ts";
import { listActivity } from "../services/activity.ts";
import * as onboarding from "../services/onboarding.ts";
import * as social from "../services/social.ts";
import * as email from "../services/email.ts";
import * as plans from "../services/plans.ts";
import * as limits from "./limits.ts";
import * as locks from "../services/locks.ts";
import * as milestones from "../services/milestones.ts";
import * as templates from "../services/templates.ts";
import * as collaborators from "../services/collaborators.ts";
import * as archive from "../services/archive.ts";
import * as webhooks from "../services/webhooks.ts";
import * as tablediff from "../services/tablediff.ts";
import * as twofactor from "../services/twofactor.ts";
import * as securitylog from "../services/securitylog.ts";
import * as cards from "../services/cards.ts";
import * as filters from "../services/filters.ts";
import * as invites from "../services/invites.ts";
import * as oauth from "../services/oauth.ts";
import * as modelreview from "../services/modelreview.ts";
import * as audit from "../services/audit.ts";
import * as secretscan from "../services/secretscan.ts";
import * as domains from "../services/domains.ts";
import * as sso from "../services/sso.ts";
import * as digest from "../services/digest.ts";
import { parseRange } from "../core/range.ts";
import * as passkeys from "../services/passkeys.ts";
import { buildStac } from "../services/stac.ts";
import { checksBadge, licenseBadge, releaseBadge, sizeBadge } from "../services/badge.ts";
import { commitFiles } from "../dev/push.ts";
import * as sharing from "../services/sharing.ts";
import * as ingest from "../services/ingest.ts";
import * as extent from "../services/extent.ts";
import * as inbox from "../services/inbox.ts";
import { notifyOf, wantsEmail } from "../services/notify.ts";
import { parseLatLon, type BBox } from "../core/geo.ts";
import { citationFor } from "../services/citation.ts";
import { LICENSES } from "../services/licenses.ts";
import * as idempotency from "./idempotency.ts";
import * as previews from "../render/previews.ts";
import { latestCheckStatus, listCheckRuns, runChecks } from "../checks/runner.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { config } from "../config.ts";

type Env = { Variables: { user: accounts.AuthedUser | null } };

/** What a personal access token may do. Web sessions can do everything their user can. */
const SCOPES = { repo: "Read and write repositories", "read:repo": "Read repositories", "read:org": "Read organization membership", "admin:org": "Manage organization members" };

/** The most one Range request returns (bigger asks are answered in pieces). */
const MAX_RANGE_BYTES = 64 * 1024 * 1024;

export function createApp(ctx: Ctx) {
  const app = new Hono<Env>();

  app.use("*", cors({ origin: [...config.corsOrigins], allowHeaders: ["Authorization", "Content-Type", "Idempotency-Key"], allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"], exposeHeaders: ["RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset", "Retry-After", "X-Request-Id", "X-Craton-Render", "Idempotency-Replayed"] }));
  // An API never renders pages: no framing, no sniffing, no referrer leaks.
  app.use("*", secureHeaders({ xFrameOptions: "DENY", contentSecurityPolicy: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] }, referrerPolicy: "no-referrer" }));
  // JSON and SVG shrink a lot on the wire; images and chunk bytes are already dense, and
  // compress() skips them by content type. Outermost of the two, so the ETag below is computed on
  // the plain body and a 304 is never compressed.
  app.use("*", compress());
  // Weak ETags for reads, so a client that sends If-None-Match gets a body-less 304. Not for
  // chunk or raw-file bytes (hashing a few hundred KB per request for nothing) or previews
  // (those carry a content-derived ETag of their own, set without reading the body).
  // Anything streamed or large: hashing it would read the whole body first (and a consumed stream
  // can't be sent). Share links are all downloads, so the whole /shared tree is out.
  const noEtag = /\/(chunks|raw|render|blob|archive|shared)(\/|$)/;
  // Hono's etag() hashes a clone() of the response, and under load that sometimes left the original's
  // body locked (a 500 from the compress step after it). Reading the body once and rebuilding the
  // response avoids cloning altogether.
  const keep304 = ["cache-control", "content-location", "date", "etag", "expires", "vary"];
  const textual = /json|text|xml|csv/i;
  const jsonEtag: MiddlewareHandler = async (c, next) => {
    const ifNoneMatch = c.req.header("If-None-Match");
    await next();
    const res = c.res;
    if (!res.ok || res.status === 204 || !res.body) return;
    let tag = res.headers.get("ETag");
    let bytes: Uint8Array | null = null;
    if (!tag) {
      if (!textual.test(res.headers.get("Content-Type") ?? "")) return;
      bytes = new Uint8Array(await res.arrayBuffer());
      tag = `W/"${createHash("sha1").update(bytes).digest("hex")}"`;
    }
    const strip = (t: string) => t.replace(/^W\//, "");
    if (ifNoneMatch && (ifNoneMatch === "*" || ifNoneMatch.split(",").some((t) => strip(t.trim()) === strip(tag!)))) {
      const headers = new Headers();
      for (const k of keep304) {
        const v = res.headers.get(k);
        if (v) headers.set(k, v);
      }
      headers.set("ETag", tag);
      c.res = new Response(null, { status: 304, statusText: "Not Modified", headers });
      return;
    }
    if (bytes) {
      const headers = new Headers(res.headers);
      headers.set("ETag", tag);
      c.res = new Response(bytes, { status: res.status, statusText: res.statusText, headers });
    }
  };
  app.use("*", (c, next) => (c.req.method === "GET" && !noEtag.test(c.req.path) ? jsonEtag(c, next) : next()));
  // The access log (CRATON_ACCESS_LOG=1): after the response is made, so the status and who are known.
  app.use("*", async (c, next) => {
    const started = performance.now();
    await next();
    const route = (c as unknown as { req: { routePath?: string } }).req.routePath;
    // The audit log and each token's recent requests: from the request's shape and outcome, never its body.
    const who = c.get("user");
    if (who) {
      const info = clientInfo(c);
      const matched = Boolean(route) && route !== "/*";
      audit.recordRequest(ctx, {
        method: c.req.method,
        unmatched: !matched,
        route: (matched ? route! : c.req.path).replace(/^\/v1/, "").slice(0, 200),
        params: c.req.param() as Record<string, string>,
        status: c.res.status,
        ms: performance.now() - started,
        ip: info.ip,
        userAgent: info.userAgent,
        actor: { id: who.id, handle: who.handle, tokenId: who.tokenId, tokenKind: who.tokenKind },
      });
    }
    if (!config.accessLog.enabled) return;
    config.accessLog.write(
      JSON.stringify({
        time: new Date().toISOString(),
        method: c.req.method,
        path: route && route !== "/*" ? route : c.req.path,
        status: c.res.status,
        ms: Math.round((performance.now() - started) * 10) / 10,
        requestId: c.res.headers.get("X-Request-Id"),
        user: c.get("user")?.handle ?? null,
      }),
    );
  });
  app.use("*", async (c, next) => {
    c.header("X-Request-Id", crypto.randomUUID());
    const header = c.req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    const user = accounts.authenticate(ctx, token);
    // A token limited to named repositories acts as itself only inside them: anywhere else it is no better than
    // having no token, so public data stays readable and everything else is refused or hidden as usual.
    let effective = user;
    if (user?.repos) {
      const m = c.req.path.match(/^\/v1\/repos\/([^/]+)\/([^/]+)/);
      const inside = m
        ? user.repos.includes(`${decodeURIComponent(m[1])}/${decodeURIComponent(m[2])}`.toLowerCase())
        : ["/v1/user", "/v1/health", "/v1/ready", "/v1/openapi.json", "/v1/scopes", "/v1/licenses", "/v1/plans", "/v1/readme-templates"].includes(c.req.path);
      if (!inside) effective = null;
    }
    c.set("user", effective);
    // One budget per token (or per IP when anonymous) across the whole API.
    const r = limits.take(user ? `tok:${user.tokenId}` : `ip:${clientIp(c)}`, config.limits.api);
    for (const [k, v] of Object.entries(limits.headersFor(r))) c.header(k, v);
    if (!r.allowed) return c.json({ error: { code: "rate_limited", message: "Too many requests. Slow down and try again shortly." } }, 429);
    await next();
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json({ error: { code: err.code, message: err.message, details: err.details } }, err.status as 400);
    console.error(err);
    return c.json({ error: { code: "internal", message: "Something went wrong on our side." } }, 500);
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: `No route for ${c.req.method} ${c.req.path}` } }, 404));

  /**
   * The browser's address when the web app (or another trusted proxy) calls on its behalf, else
   * the socket's. Forwarded headers from anyone else are ignored, or a client could pick its own
   * address and step around rate limits and lockouts.
   */
  const socketOf = (c: Context<Env>) => (c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined)?.incoming?.socket?.remoteAddress;
  const viaTrustedProxy = (c: Context<Env>) => {
    const socket = socketOf(c);
    return socket === undefined || config.trustedProxies.includes(socket); // undefined: in-process (tests)
  };
  function clientIp(c: Context<Env>) {
    const forwarded = viaTrustedProxy(c) ? (c.req.header("x-craton-client-ip") ?? c.req.header("x-forwarded-for")?.split(",")[0]?.trim()) : undefined;
    return forwarded || socketOf(c) || "local";
  }
  const clientInfo = (c: Context<Env>) => ({
    ip: clientIp(c),
    userAgent: (viaTrustedProxy(c) ? c.req.header("x-craton-user-agent") : undefined) ?? c.req.header("user-agent") ?? null,
  });

  // Idempotency-Key: opt-in, so a retried POST/PUT/PATCH/DELETE can't double-apply (see
  // idempotency.ts). Only active when the client sends the header; otherwise this is a no-op.
  const IDEMPOTENT_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  app.use("*", async (c, next) => {
    const idemKey = c.req.header("idempotency-key");
    if (!idemKey || !IDEMPOTENT_METHODS.has(c.req.method)) return next();
    if (idemKey.length > 255) return c.json({ error: { code: "bad_request", message: "Idempotency-Key is at most 255 characters." } }, 400);
    const actor = c.get("user") ? `tok:${c.get("user")!.tokenId}` : `ip:${clientIp(c)}`;
    const key = idempotency.keyFor(actor, c.req.method, new URL(c.req.url).pathname, idemKey);
    const cached = idempotency.get(key);
    if (cached) {
      for (const [k, v] of cached.headers) c.header(k, v);
      c.header("Idempotency-Replayed", "true");
      return c.body(cached.body, cached.status as 200);
    }
    await next();
    // Cache whatever this attempt produced — including an error — so a retry with the same key
    // always sees the same outcome, then hand the client an identical copy (a Response body can
    // only be read once).
    if (c.res) {
      const body = await c.res.clone().text();
      const headers: [string, string][] = [];
      c.res.headers.forEach((v, k) => k.toLowerCase() !== "set-cookie" && headers.push([k, v]));
      idempotency.set(key, c.res.status, headers, body);
    }
  });

  function limit(c: Context<Env>, key: string, w: { max: number; windowMs: number }, message: string) {
    const r = limits.take(key, w);
    if (!r.allowed) {
      for (const [k, v] of Object.entries(limits.headersFor(r))) c.header(k, v);
      throw new ApiError(429, "rate_limited", message);
    }
  }
  /** A token without the scope for this call is treated as if it weren't there. */
  const hasScope = (u: accounts.AuthedUser, ...any: string[]) => u.tokenKind === "session" || any.some((s) => u.scopes.includes(s));
  function requireScope(c: Context<Env>, ...any: string[]) {
    const u = c.get("user");
    if (u && !hasScope(u, ...any)) throw new ApiError(403, "insufficient_scope", `This token needs the ${any.join(" or ")} scope. Create one with it in Settings → Tokens.`);
  }
  /** Account security (sessions, password, deletion) only from a signed-in web session. */
  function requireSession(c: Context<Env>) {
    const u = requireUser(c);
    if (u.tokenKind !== "session") throw new ApiError(403, "session_required", "Do this from the web app while signed in; access tokens can't change account security.");
    return u;
  }
  const userId = (c: Context<Env>) => {
    const u = c.get("user");
    // Repositories read through a token without repo scopes: public data only.
    return u && hasScope(u, "repo", "read:repo") ? u.id : null;
  };
  const requireUser = (c: Context<Env>) => {
    const u = c.get("user");
    if (!u) throw new ApiError(401, "unauthenticated", "Sign in or pass a token: Authorization: Bearer <token>.");
    return u;
  };
  // Request bodies are read with a ceiling, whether or not the client declared a length (a chunked upload has none).
  const readLimited = async (c: Context<Env>, max: number): Promise<Buffer> => {
    const tooLarge = () => new ApiError(413, "too_large", `That request is larger than the ${Math.round(max / 1024 / 1024) || 1} MB this endpoint accepts.`);
    if (Number(c.req.header("content-length") ?? 0) > max) throw tooLarge();
    const stream = c.req.raw.body;
    if (!stream) return Buffer.alloc(0);
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > max) {
        await reader.cancel().catch(() => {});
        throw tooLarge();
      }
      parts.push(value);
    }
    return Buffer.concat(parts);
  };
  /** One batched chunk upload: at most this many bytes and this many chunks (the CLI sends far less per request). */
  const CHUNK_BATCH_MAX_BYTES = 16 * 1024 * 1024;
  const CHUNK_BATCH_MAX_CHUNKS = 1000;
  /** A batched download stops adding chunks once it holds this many bytes. */
  const CHUNK_FETCH_SOFT_BYTES = 8 * 1024 * 1024;
  /** JSON bodies are small (the biggest is a batch of 500 objects); 16 MB is far above any real one. */
  const JSON_BODY_MAX = 16 * 1024 * 1024;
  const body = async <T>(c: Context<Env>): Promise<T> => {
    const raw = await readLimited(c, JSON_BODY_MAX);
    try {
      return JSON.parse(raw.toString("utf8")) as T;
    } catch {
      throw badRequest("Send a JSON body.");
    }
  };
  const repoFor = (c: Context<Env>, needed: "read" | "write" | "admin" = "read") => {
    if (needed !== "read") requireScope(c, "repo");
    return repos.getRepoFor(ctx, c.req.param("owner")!, c.req.param("repo")!, userId(c), needed);
  };

  const v1 = new Hono<Env>();

  /** Who is asking, as the audit log records them. */
  const secretActor = (c: Context<Env>) => {
    const u = requireUser(c);
    return { id: u.id, handle: u.handle, tokenId: u.tokenId, tokenKind: u.tokenKind };
  };
  /** The reason to push past the secret scan, when one was given: only an administrator of the repository may. */
  const secretBypass = (c: Context<Env>, raw: unknown) => {
    const reason = secretscan.cleanReason(raw);
    if (reason) {
      requireScope(c, "repo");
      try {
        repos.getRepoFor(ctx, c.req.param("owner")!, c.req.param("repo")!, userId(c), "admin");
      } catch {
        throw new ApiError(403, "forbidden", "Only an administrator of this repository can push past the secret scan.");
      }
    }
    return reason;
  };

  // Readiness for a load balancer: can this process really use its database and its chunk store right now? Writes and
  // removes one tiny probe chunk; the answer is kept for five seconds so a busy balancer does not hammer an object store.
  let lastReady: { at: number; body: { ready: boolean; checks: Record<string, string>; ms: number } } | null = null;
  v1.get("/ready", async (c) => {
    if (lastReady && Date.now() - lastReady.at < 5000) return c.json(lastReady.body, lastReady.body.ready ? 200 : 503);
    const started = performance.now();
    const checks: Record<string, string> = {};
    try {
      ctx.db.prepare("SELECT 1").get();
      checks.database = "ok";
    } catch (err) {
      checks.database = `failed: ${(err as Error).message}`;
    }
    try {
      const probe = "f".repeat(64);
      const bytes = Buffer.from(`ready ${Date.now()}`);
      await ctx.store.put(probe, bytes);
      const back = await ctx.store.get(probe);
      await ctx.store.delete(probe);
      checks.store = back && back.equals(bytes) ? "ok" : "failed: the probe did not read back";
    } catch (err) {
      checks.store = `failed: ${(err as Error).message}`;
    }
    const body = { ready: Object.values(checks).every((v) => v === "ok"), checks, ms: Math.round(performance.now() - started) };
    lastReady = { at: Date.now(), body };
    return c.json(body, body.ready ? 200 : 503);
  });
  v1.get("/health", (c) => c.json({ ok: true, storage: ctx.store.kind, time: new Date().toISOString(), version: config.version, apiVersion: config.apiVersion, minCliVersion: config.minCliVersion }));
  v1.get("/scopes", (c) => c.json(SCOPES));
  // Plan limits, for the pricing page. null means no limit.
  // Licences a repository can declare (SPDX ids), so the UI offers exactly what the API accepts.
  // What each webhook event carries, for the settings page and the API reference.
  v1.get("/webhook-events", (c) => c.json(webhooks.EVENT_DOCS));
  v1.get("/licenses", (c) => c.json(LICENSES));
  v1.get("/plans", (c) =>
    c.json(Object.fromEntries(Object.entries(config.plans).map(([id, p]) => [id, { storageBytes: p.storageBytes, privateRepos: Number.isFinite(p.privateRepos) ? p.privateRepos : null }]))),
  );

  // ── Accounts ─────────────────────────────────────────────────────────────
  v1.post("/auth/signup", async (c) => {
    limit(c, `signup:${clientIp(c)}`, config.limits.signup, "Too many new accounts from this network. Try again in an hour.");
    const b = await body<{ username: string; email: string; password: string; name?: string }>(c);
    const user = accounts.createUser(ctx, { handle: b.username, email: b.email, password: b.password, name: b.name });
    const session = accounts.issueToken(ctx, user.id, { kind: "session", note: "web session", expiresInDays: 30, client: clientInfo(c) });
    void email.sendVerifyEmail(user.email, user.name, `${config.webUrl}/verify-email?token=${accounts.createVerifyToken(ctx, user.id)}`);
    return c.json({ user: { handle: user.handle, name: user.name }, token: session.token }, 201);
  });
  v1.post("/auth/login", async (c) => {
    const b = await body<{ login: string; password: string }>(c);
    const login = (b.login ?? "").trim().toLowerCase();
    limit(c, `login:${clientIp(c)}`, { ...config.limits.login, max: config.limits.login.max * 5 }, "Too many sign-in attempts from this network. Wait a few minutes.");
    // Lock one account after repeated failures, whoever is trying.
    if (limits.count(`fail:${login}`, config.limits.lockout) >= config.limits.lockout.max) {
      throw new ApiError(429, "account_locked", "Too many failed sign-ins for this account. Wait 15 minutes, or reset your password.");
    }
    let id: number;
    try {
      id = accounts.checkPassword(ctx, login, b.password ?? "");
    } catch (err) {
      limits.take(`fail:${login}`, config.limits.lockout);
      const who = accounts.findUserId(ctx, login);
      if (who) securitylog.record(ctx, who, "sign_in_failed", { detail: "wrong password", ...clientInfo(c) });
      throw err;
    }
    limits.clear(`fail:${login}`);
    sso.assertMethodAllowed(ctx, id, "password");
    // With two-step verification on, the password only earns a short-lived ticket; the session
    // comes after the code (POST /auth/login/2fa).
    if (twofactor.isEnabled(ctx, id)) return c.json({ mfaRequired: true, ...twofactor.startLogin(ctx, id) });
    return signedIn(c, id);
  });

  /** A new session for a user who has proved who they are, plus the new-device notice. */
  function signedIn(c: Context<Env>, id: number, via: "password" | "google" | "github" | "sso" | "passkey" = "password") {
    const session = accounts.startSession(ctx, id);
    const user = accounts.authenticate(ctx, session.token)!;
    // Tell the owner about sign-ins from a device we haven't seen for them.
    const info = clientInfo(c);
    // After the two-step code the first factor is no longer known here; an account with no password can only have used a provider.
    const how = via === "passkey" ? "passkey" : via === "google" ? "Google" : via === "github" ? "GitHub" : via === "sso" ? "single sign-on" : !accounts.hasPassword(ctx, user.id) ? "Google or GitHub" : "password";
    securitylog.record(ctx, user.id, "signed_in", { detail: twofactor.isEnabled(ctx, user.id) ? `${how} and two-step code` : how, ...info });
    const known = ctx.db.prepare("SELECT 1 FROM tokens WHERE user_id = ? AND kind = 'session' AND id <> ? AND ip IS ? AND user_agent IS ? LIMIT 1").get(user.id, user.tokenId, info.ip, info.userAgent);
    ctx.db.prepare("UPDATE tokens SET ip = ?, user_agent = ? WHERE id = ?").run(info.ip, info.userAgent?.slice(0, 300) ?? null, user.tokenId);
    const hadSessions = ctx.db.prepare("SELECT 1 FROM tokens WHERE user_id = ? AND kind = 'session' AND id <> ? LIMIT 1").get(user.id, user.tokenId);
    if (!known && hadSessions) void email.sendNewSignInEmail(user.email, user.handle, describeDevice(info.userAgent, info.ip), `${config.webUrl}/settings/security`);
    return c.json({ token: session.token, expiresAt: session.expiresAt });
  }

  v1.post("/auth/login/2fa", async (c) => {
    const b = await body<{ ticket: string; code: string }>(c);
    limit(c, `mfa-ip:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many attempts from this network. Wait a few minutes.");
    const who = twofactor.ticketUser(ctx, b.ticket);
    const budget = { max: 10, windowMs: 15 * 60_000 };
    // Across tickets, one account only gets so many code guesses.
    if (who && limits.count(`mfa:${who}`, budget) >= budget.max) {
      throw new ApiError(429, "account_locked", "Too many wrong codes for this account. Wait 15 minutes, or sign in with a recovery code later.");
    }
    try {
      const done = twofactor.finishLogin(ctx, b.ticket, b.code);
      limits.clear(`mfa:${done.userId}`);
      return signedIn(c, done.userId);
    } catch (err) {
      if (who && err instanceof ApiError && err.code === "invalid_code") limits.take(`mfa:${who}`, budget);
      throw err;
    }
  });
  // ── Sign in with Google or GitHub ───────────────────────────────────────
  // Which providers this server offers, so the sign-in page shows only buttons that work.
  v1.get("/auth/providers", (c) => c.json({ google: oauth.enabled("google"), github: oauth.enabled("github"), sso: Boolean(ctx.db.prepare("SELECT 1 FROM org_sso LIMIT 1").get()), passkeys: true }));
  const providerOf = (c: Context<Env>) => c.req.param("provider") as oauth.Provider;
  // Step 1: a one-time state and PKCE challenge are stored, and the web app sends the browser to `url`.
  // With a signed-in session and { link: true } the result is added to that account instead of signing anyone in.
  v1.post("/auth/:provider{google|github}/start", async (c) => {
    limit(c, `oauth:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many sign-in attempts from this network. Wait a few minutes.");
    const b = await body<{ next?: string; link?: boolean }>(c);
    const linkUserId = b.link ? requireSession(c).id : null;
    return c.json(oauth.startOAuth(ctx, providerOf(c), { next: b.next, linkUserId }));
  });
  // Step 2: the provider sent the browser back with a code. Answers one of: a session, a two-step ticket, "choose a
  // username" (first time here), or { linked } when the request began in Settings.
  v1.post("/auth/:provider{google|github}/callback", async (c) => {
    limit(c, `oauth:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many sign-in attempts from this network. Wait a few minutes.");
    const provider = providerOf(c);
    const label = oauth.providerName(provider);
    const b = await body<{ code?: string; state?: string }>(c);
    const done = await oauth.finishOAuth(ctx, provider, { code: b.code ?? "", state: b.state ?? "" });
    const g = done.claims;
    const info = clientInfo(c);
    if (done.linkUserId !== null) {
      const me = requireSession(c);
      if (me.id !== done.linkUserId) throw new ApiError(403, "forbidden", "This link request was started by someone else.");
      const owner = oauth.identityOwner(ctx, g.sub, provider);
      if (owner !== null && owner !== me.id) throw new ApiError(409, "identity_taken", `That ${label} account is already connected to another Craton account.`);
      oauth.linkIdentity(ctx, me.id, g.sub, g.email, provider);
      securitylog.record(ctx, me.id, "oauth_linked", { detail: `${label} ${g.email}`, ...info });
      return c.json({ linked: true, email: g.email });
    }
    const after = (id: number) => {
      sso.assertMethodAllowed(ctx, id, provider);
      return twofactor.isEnabled(ctx, id) ? c.json({ mfaRequired: true, ...twofactor.startLogin(ctx, id), next: done.next }) : signedIn(c, id, provider);
    };
    const known = oauth.identityOwner(ctx, g.sub, provider);
    if (known !== null) return after(known);
    const byEmail = oauth.userByEmail(ctx, g.email);
    if (byEmail) {
      // The provider vouches for the address. Joining an account whose address was never confirmed would let whoever
      // registered it first (with a password) keep a way in, so that case is refused rather than merged.
      if (!byEmail.verified) {
        throw new ApiError(409, "email_unverified_account", `An account with this email exists but its address was never confirmed. Confirm it from the email we sent, or reset its password, then use ${label} again.`);
      }
      oauth.linkIdentity(ctx, byEmail.id, g.sub, g.email, provider);
      domains.joinForUser(ctx, byEmail.id);
      securitylog.record(ctx, byEmail.id, "oauth_linked", { detail: `${label} ${g.email} (matched by verified email)`, ...info });
      return after(byEmail.id);
    }
    const ticket = oauth.createPending(ctx, { subject: g.sub, email: g.email, name: g.name }, provider);
    return c.json({ needsUsername: true, ticket, email: g.email, name: g.name, suggestion: oauth.suggestHandle(ctx, g.email, g.name), next: done.next });
  });
  // What the "choose a username" page shows for a ticket.
  v1.post("/auth/:provider{google|github}/pending", async (c) => {
    limit(c, `oauth:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many attempts from this network. Wait a few minutes.");
    const b = await body<{ ticket?: string }>(c);
    const p = oauth.readPending(ctx, b.ticket ?? "", providerOf(c));
    return c.json({ email: p.email, name: p.name, suggestion: oauth.suggestHandle(ctx, p.email, p.name) });
  });
  // Step 3 (first time only): the username chosen, then the account exists and the session starts.
  v1.post("/auth/:provider{google|github}/complete", async (c) => {
    limit(c, `signup:${clientIp(c)}`, config.limits.signup, "Too many new accounts from this network. Try again in an hour.");
    const provider = providerOf(c);
    const b = await body<{ ticket?: string; username?: string; name?: string }>(c);
    const p = oauth.readPending(ctx, b.ticket ?? "", provider);
    const user = accounts.createOAuthUser(ctx, { handle: b.username ?? "", email: p.email, name: b.name || p.name });
    oauth.linkIdentity(ctx, user.id, p.subject, p.email, provider);
    domains.joinForUser(ctx, user.id);
    oauth.dropPending(ctx, b.ticket ?? "");
    securitylog.record(ctx, user.id, "oauth_linked", { detail: `${oauth.providerName(provider)} ${p.email} (account created)`, ...clientInfo(c) });
    return signedIn(c, user.id, provider);
  });
  // ── Single sign-on through an organization's own identity provider ─────────
  // The person types their work email; if an organization has verified that domain and set up SSO, the web app is sent to
  // that organization's provider. The answer comes back to the one callback address every organization registers.
  v1.post("/auth/sso/start", async (c) => {
    limit(c, `oauth:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many sign-in attempts from this network. Wait a few minutes.");
    const b = await body<{ email?: string; next?: string }>(c);
    return c.json(sso.start(ctx, b));
  });
  v1.post("/auth/sso/callback", async (c) => {
    limit(c, `oauth:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many sign-in attempts from this network. Wait a few minutes.");
    const b = await body<{ code?: string; state?: string }>(c);
    const done = await sso.finish(ctx, { code: b.code ?? "", state: b.state ?? "" });
    const g = done.claims;
    const info = clientInfo(c);
    const arrive = (id: number) => {
      // Signing in through the organization's provider makes the person one of its members, and proves the setup works.
      sso.joinOrg(ctx, done.orgId, id);
      sso.markTested(ctx, done.orgId);
      return twofactor.isEnabled(ctx, id) ? c.json({ mfaRequired: true, ...twofactor.startLogin(ctx, id), next: done.next }) : signedIn(c, id, "sso");
    };
    const known = oauth.identityOwner(ctx, g.sub, done.provider);
    if (known !== null) return arrive(known);
    const byEmail = oauth.userByEmail(ctx, g.email);
    if (byEmail) {
      if (!byEmail.verified) {
        throw new ApiError(409, "email_unverified_account", "An account with this email exists but its address was never confirmed. Confirm it from the email we sent, or reset its password, then use single sign-on again.");
      }
      oauth.linkIdentity(ctx, byEmail.id, g.sub, g.email, done.provider);
      securitylog.record(ctx, byEmail.id, "oauth_linked", { detail: `Single sign-on (${done.orgHandle}) ${g.email} (matched by verified email)`, ...info });
      return arrive(byEmail.id);
    }
    const ticket = oauth.createPending(ctx, { subject: g.sub, email: g.email, name: g.name }, done.provider);
    return c.json({ needsUsername: true, ticket, email: g.email, name: g.name, suggestion: oauth.suggestHandle(ctx, g.email, g.name), next: done.next });
  });
  v1.post("/auth/sso/pending", async (c) => {
    limit(c, `oauth:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many attempts from this network. Wait a few minutes.");
    const b = await body<{ ticket?: string }>(c);
    const p = oauth.readPending(ctx, b.ticket ?? "", "sso");
    return c.json({ email: p.email, name: p.name, suggestion: oauth.suggestHandle(ctx, p.email, p.name) });
  });
  v1.post("/auth/sso/complete", async (c) => {
    limit(c, `signup:${clientIp(c)}`, config.limits.signup, "Too many new accounts from this network. Try again in an hour.");
    const b = await body<{ ticket?: string; username?: string; name?: string }>(c);
    const p = oauth.readPending(ctx, b.ticket ?? "", "sso");
    const user = accounts.createOAuthUser(ctx, { handle: b.username ?? "", email: p.email, name: b.name || p.name });
    oauth.linkIdentity(ctx, user.id, p.subject, p.email, p.provider);
    oauth.dropPending(ctx, b.ticket ?? "");
    const orgId = Number(p.provider.slice(sso.SSO_PREFIX.length));
    sso.joinOrg(ctx, orgId, user.id);
    sso.markTested(ctx, orgId);
    securitylog.record(ctx, user.id, "oauth_linked", { detail: `Single sign-on ${p.email} (account created)`, ...clientInfo(c) });
    return signedIn(c, user.id, "sso");
  });
  // Setting it up (owners): the provider's address, and the client id and secret made there.
  v1.get("/orgs/:org/sso", (c) => (requireScope(c, "admin:org"), c.json(sso.getConfig(ctx, c.req.param("org"), requireUser(c).id))));
  v1.put("/orgs/:org/sso", async (c) => {
    requireScope(c, "admin:org");
    limit(c, `sso-config:${requireUser(c).id}`, { max: 20, windowMs: 10 * 60_000 }, "Too many changes. Wait a few minutes.");
    return c.json(await sso.configure(ctx, c.req.param("org"), requireUser(c).id, await body(c)));
  });
  v1.patch("/orgs/:org/sso", async (c) => {
    requireScope(c, "admin:org");
    const b = await body<{ enforced?: boolean }>(c);
    return c.json(sso.setEnforced(ctx, c.req.param("org"), requireUser(c).id, b.enforced));
  });
  v1.delete("/orgs/:org/sso", (c) => {
    requireScope(c, "admin:org");
    sso.remove(ctx, c.req.param("org"), requireUser(c).id);
    return c.body(null, 204);
  });
  // ── Passkeys ───────────────────────────────────────────────────────────
  // Sign in: the browser asks the device for any passkey it holds for this site; no username is needed first.
  v1.post("/auth/passkey/options", (c) => {
    limit(c, `passkey:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many sign-in attempts from this network. Wait a few minutes.");
    return c.json(passkeys.loginOptions(ctx));
  });
  v1.post("/auth/passkey/login", async (c) => {
    limit(c, `passkey:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many sign-in attempts from this network. Wait a few minutes.");
    const proof = passkeys.finishLogin(ctx, await body(c));
    if (proof.rolledBack) {
      securitylog.record(ctx, proof.userId, "passkey_rollback", { detail: "signature counter went backwards", ...clientInfo(c) });
      throw new ApiError(401, "passkey_cloned", "This passkey’s counter went backwards, which can mean it was copied, so it wasn’t accepted. Sign in another way, and remove the passkey if you don’t recognise this.");
    }
    sso.assertMethodAllowed(ctx, proof.userId, "passkey");
    // A passkey the device unlocked with a PIN, fingerprint or face is two factors in one. One that was only touched is one
    // factor, so an account with two-step verification still asks for its code.
    if (!proof.userVerified && twofactor.isEnabled(ctx, proof.userId)) return c.json({ mfaRequired: true, ...twofactor.startLogin(ctx, proof.userId) });
    return signedIn(c, proof.userId, "passkey");
  });
  // Manage: web sessions only.
  v1.post("/user/passkeys/options", (c) => {
    const u = requireSession(c);
    limit(c, `passkey-add:${u.id}`, { max: 20, windowMs: 60 * 60_000 }, "Too many attempts. Try again in an hour.");
    return c.json(passkeys.registrationOptions(ctx, { id: u.id, handle: u.handle, name: u.name }));
  });
  v1.post("/user/passkeys", async (c) => {
    const u = requireSession(c);
    const made = passkeys.finishRegistration(ctx, u, await body(c));
    securitylog.record(ctx, u.id, "passkey_added", { detail: made.name, ...clientInfo(c) });
    return c.json(made, 201);
  });
  v1.get("/user/passkeys", (c) => c.json(passkeys.listPasskeys(ctx, requireSession(c).id)));
  v1.patch("/user/passkeys/:id", async (c) => {
    const u = requireSession(c);
    const b = await body<{ name?: string }>(c);
    passkeys.renamePasskey(ctx, u.id, c.req.param("id"), b.name);
    return c.json(passkeys.listPasskeys(ctx, u.id));
  });
  v1.delete("/user/passkeys/:id", (c) => {
    const u = requireSession(c);
    // Never remove the last way in.
    const others = passkeys.countPasskeys(ctx, u.id) - 1;
    if (others < 1 && !accounts.hasPassword(ctx, u.id) && oauth.listIdentities(ctx, u.id).length === 0) {
      throw new ApiError(409, "last_sign_in_method", "This passkey is the only way into this account. Add a password (use “Forgot password” on the sign-in page) or another passkey first.");
    }
    passkeys.removePasskey(ctx, u.id, c.req.param("id"));
    securitylog.record(ctx, u.id, "passkey_removed", { ...clientInfo(c) });
    return c.body(null, 204);
  });
  v1.post("/auth/logout", (c) => {
    const header = c.req.header("authorization");
    if (header?.startsWith("Bearer ")) accounts.revokeSession(ctx, header.slice(7));
    return c.body(null, 204);
  });
  // Always 202, whether or not the account exists, so this can't be used to find accounts.
  v1.post("/auth/forgot", async (c) => {
    const b = await body<{ login: string }>(c);
    limit(c, `reset:${clientIp(c)}:${(b.login ?? "").toLowerCase()}`, config.limits.reset, "Too many reset requests. Check your inbox, or try again in an hour.");
    const reset = accounts.requestPasswordReset(ctx, b.login ?? "");
    if (reset) {
      const who = accounts.findUserId(ctx, reset.handle);
      if (who) securitylog.record(ctx, who, "password_reset_requested", clientInfo(c));
      void email.sendPasswordResetEmail(reset.email, reset.handle, `${config.webUrl}/reset-password?token=${reset.token}`);
    }
    return c.json({ ok: true }, 202);
  });
  v1.post("/auth/reset", async (c) => {
    const b = await body<{ token: string; password: string }>(c);
    const user = accounts.resetPassword(ctx, b.token, b.password);
    const who = accounts.findUserId(ctx, user.handle);
    if (who) securitylog.record(ctx, who, "password_reset", { detail: "all other sessions signed out", ...clientInfo(c) });
    return c.json({ handle: user.handle });
  });
  const userJson = (u: accounts.User) => ({
    handle: u.handle,
    name: u.name,
    bio: u.bio,
    website: u.website,
    location: u.location,
    company: u.company,
    pronouns: u.pronouns,
    hasAvatar: accounts.hasAvatar(ctx, u.id),
    email: u.email,
    plan: u.plan,
    role: u.role,
    onboardedAt: u.onboarded_at,
    emailVerified: Boolean(u.email_verified_at),
    twoFactor: Boolean(u.totp_enabled_at),
    digest: u.digest,
    notify: notifyOf(u.notify),
    defaultVisibility: u.default_visibility,
    createdAt: u.created_at,
    writableOwners: stats.writableOwners(ctx, u.id),
  });
  v1.get("/user", (c) => c.json(userJson(requireUser(c))));
  // Sign-in methods on this account: the Google identity (if any) and whether a password is set.
  v1.get("/user/identities", (c) => {
    const u = requireSession(c);
    return c.json({ identities: oauth.listIdentities(ctx, u.id), hasPassword: accounts.hasPassword(ctx, u.id), googleAvailable: oauth.enabled("google"), githubAvailable: oauth.enabled("github"), passkeys: passkeys.countPasskeys(ctx, u.id) });
  });
  v1.delete("/user/identities/:provider{google|github}", (c) => {
    const u = requireSession(c);
    const provider = c.req.param("provider") as oauth.Provider;
    const label = oauth.providerName(provider);
    // Never remove the only way in: a password, a passkey or another connected provider has to remain.
    const others = oauth.listIdentities(ctx, u.id).filter((i) => i.provider !== provider).length;
    if (!accounts.hasPassword(ctx, u.id) && passkeys.countPasskeys(ctx, u.id) === 0 && others === 0) {
      throw new ApiError(409, "last_sign_in_method", `${label} is the only way into this account. Add a password first (use “Forgot password” on the sign-in page), then disconnect ${label}.`);
    }
    if (!oauth.unlinkIdentity(ctx, u.id, provider)) throw notFound(`${label} connection`);
    securitylog.record(ctx, u.id, "oauth_unlinked", { detail: label, ...clientInfo(c) });
    return c.body(null, 204);
  });
  // The weekly email's one-click unsubscribe: no sign-in, the link itself is the proof (a keyed signature of the account).
  v1.post("/auth/digest/unsubscribe", async (c) => {
    limit(c, `unsub:${clientIp(c)}`, { max: 30, windowMs: 15 * 60_000 }, "Too many attempts. Try again in a few minutes.");
    const b = await body<{ token?: string }>(c);
    return c.json({ handle: digest.unsubscribe(ctx, b.token), digest: "off" });
  });
  v1.patch("/user", async (c) => {
    const b = await body<{ name?: string; bio?: string; role?: string | null; onboarded?: boolean; digest?: string; notify?: Record<string, boolean>; defaultVisibility?: string; website?: string; location?: string; company?: string; pronouns?: string }>(c);
    return c.json(userJson(accounts.updateProfile(ctx, requireUser(c).id, b)));
  });
  // A profile picture: a small PNG, JPEG or WebP sent as the request body (the web app shrinks it first), shown wherever the person appears.
  v1.put("/user/avatar", async (c) => {
    const u = requireUser(c);
    const data = await readLimited(c, accounts.AVATAR_MAX_BYTES).catch((err) => {
      if (err instanceof ApiError && err.status === 413) throw badRequest(`A profile picture is at most ${accounts.AVATAR_MAX_BYTES / 1024} KB. The web app shrinks it for you.`);
      throw err;
    });
    accounts.setAvatar(ctx, u.id, data);
    return c.json(userJson(accounts.getUserById(ctx, u.id)));
  });
  v1.delete("/user/avatar", (c) => {
    const u = requireUser(c);
    accounts.removeAvatar(ctx, u.id);
    return c.json(userJson(accounts.getUserById(ctx, u.id)));
  });
  // Anyone may see a profile picture, like a name. It is revalidated by its version on every use, so a new picture shows at once (a 304 costs almost nothing).
  v1.get("/avatars/:handle", (c) => {
    const a = accounts.getAvatar(ctx, c.req.param("handle"));
    if (!a) throw new ApiError(404, "not_found", "No profile picture.");
    const etag = `"${a.updatedAt}"`;
    const headers = { etag, "cache-control": "public, no-cache", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" };
    if (c.req.header("if-none-match") === etag) return c.body(null, 304, headers);
    return c.body(new Uint8Array(a.data), 200, { ...headers, "content-type": a.type, "content-length": String(a.data.length) });
  });
  // Email confirmation.
  v1.post("/auth/verify", async (c) => {
    const b = await body<{ token: string }>(c);
    const u = accounts.verifyEmail(ctx, b.token);
    // An address that is now confirmed may belong to a domain an organization has verified and opened to its people.
    const joined = domains.joinForUser(ctx, u.id);
    return c.json({ handle: u.handle, emailVerified: true, ...(joined.length ? { joined } : {}) });
  });
  v1.post("/user/verify/resend", (c) => {
    const u = requireSession(c);
    if (u.email_verified_at) return c.json({ ok: true, alreadyVerified: true });
    limit(c, `verify:${u.id}`, { max: 3, windowMs: 60 * 60_000 }, "We've sent a few already. Check spam, or try again in an hour.");
    void email.sendVerifyEmail(u.email, u.name, `${config.webUrl}/verify-email?token=${accounts.createVerifyToken(ctx, u.id)}`);
    return c.json({ ok: true }, 202);
  });

  // Sessions, password, export and deletion: web sessions only.
  v1.get("/user/sessions", (c) => {
    const u = requireSession(c);
    return c.json(accounts.listSessions(ctx, u.id, u.tokenId));
  });
  v1.delete("/user/sessions/:id", (c) => {
    const u = requireSession(c);
    accounts.revokeSessionById(ctx, u.id, Number(c.req.param("id")));
    securitylog.record(ctx, u.id, "session_revoked", clientInfo(c));
    return c.body(null, 204);
  });
  // Saved issue and pull request filters (private to the person).
  v1.get("/user/filters", (c) => c.json(filters.listFilters(ctx, requireUser(c).id, c.req.query("kind"))));
  v1.post("/user/filters", async (c) => c.json(filters.saveFilter(ctx, requireUser(c).id, await body<Parameters<typeof filters.saveFilter>[2]>(c)), 201));
  v1.delete("/user/filters/:id", (c) => {
    filters.deleteFilter(ctx, requireUser(c).id, Number(c.req.param("id")));
    return c.body(null, 204);
  });
  // The inbox: what needs this person's attention, with read / unread / done kept on the server.
  v1.get("/user/inbox", (c) => {
    const u = requireUser(c);
    const view = c.req.query("view");
    return c.json(inbox.listInbox(ctx, u, { view: view === "done" || view === "all" ? view : "inbox", limit: Number(c.req.query("limit") ?? 100) }));
  });
  v1.get("/user/inbox/count", (c) => c.json({ unread: inbox.unreadCount(ctx, requireUser(c)) }));
  const inboxMark = (fn: (ctx: Ctx, userId: number, keys: unknown) => number) => async (c: Context<Env>) => {
    const u = requireUser(c);
    const b = await body<{ keys: unknown }>(c);
    fn(ctx, u.id, b.keys);
    return c.json({ unread: inbox.unreadCount(ctx, u) });
  };
  v1.post("/user/inbox/read", inboxMark(inbox.markRead));
  v1.post("/user/inbox/unread", inboxMark(inbox.markUnread));
  v1.post("/user/inbox/done", inboxMark(inbox.markDone));
  v1.post("/user/inbox/restore", inboxMark(inbox.restore));
  v1.post("/user/inbox/read-all", (c) => {
    const u = requireUser(c);
    inbox.markAllRead(ctx, u.id);
    return c.json({ unread: inbox.unreadCount(ctx, u) });
  });

  // Two-step verification. Session-only (an access token can't weaken account security) and every
  // change needs the password again.
  const mfaBudget = (c: Context<Env>, id: number) => limit(c, `2fa:${id}`, { max: 10, windowMs: 15 * 60_000 }, "Too many attempts. Wait a few minutes and try again.");
  v1.get("/user/2fa", (c) => c.json(twofactor.status(ctx, requireSession(c).id)));
  // This person's own recent security activity, newest first.
  v1.get("/user/security-log", (c) => c.json(securitylog.list(ctx, requireSession(c).id, Number(c.req.query("limit") ?? 50) || 50)));
  v1.post("/user/2fa/setup", async (c) => {
    const u = requireSession(c);
    mfaBudget(c, u.id);
    return c.json(twofactor.beginSetup(ctx, u, (await body<{ password: string }>(c)).password));
  });
  v1.post("/user/2fa/enable", async (c) => {
    const u = requireSession(c);
    mfaBudget(c, u.id);
    const done = twofactor.enable(ctx, u, (await body<{ code: string }>(c)).code);
    securitylog.record(ctx, u.id, "two_factor_enabled", clientInfo(c));
    void email.sendTwoFactorChangedEmail(u.email, u.handle, true, `${config.webUrl}/settings/security`);
    return c.json(done, 201);
  });
  v1.post("/user/2fa/disable", async (c) => {
    const u = requireSession(c);
    mfaBudget(c, u.id);
    const b = await body<{ password: string; code: string }>(c);
    twofactor.disable(ctx, u, b.password, b.code);
    securitylog.record(ctx, u.id, "two_factor_disabled", clientInfo(c));
    void email.sendTwoFactorChangedEmail(u.email, u.handle, false, `${config.webUrl}/settings/security`);
    return c.json({ ok: true });
  });
  v1.post("/user/2fa/recovery-codes", async (c) => {
    const u = requireSession(c);
    mfaBudget(c, u.id);
    const b = await body<{ password: string; code: string }>(c);
    const codes = twofactor.regenerateRecoveryCodes(ctx, u, b.password, b.code);
    securitylog.record(ctx, u.id, "recovery_codes_regenerated", clientInfo(c));
    return c.json(codes, 201);
  });
  v1.post("/user/password", async (c) => {
    const u = requireSession(c);
    const b = await body<{ current: string; next: string }>(c);
    accounts.changePassword(ctx, u.id, u.tokenId, b.current, b.next);
    securitylog.record(ctx, u.id, "password_changed", { detail: "other sessions signed out", ...clientInfo(c) });
    return c.json({ ok: true });
  });
  v1.get("/user/export", (c) => c.json(accounts.exportAccount(ctx, requireSession(c).id)));
  // The data export's other half: the files themselves, the default branch of every repository the person owns, as one ZIP.
  v1.get("/user/export/repositories", (c) => {
    const me = requireSession(c);
    limit(c, `export-bundle:${me.id}`, { max: 5, windowMs: 60 * 60_000 }, "That export was requested a few times just now. Try again in an hour.");
    const mine = repos.listRepos(ctx, me.id, { owner: me.handle }).filter((r) => r.owner === me.handle);
    const plan = archive.planAccountBundle(ctx, mine, me.handle);
    return c.body(archive.archiveStream(ctx, plan), 200, {
      "content-type": "application/zip",
      "content-length": String(plan.length),
      "content-disposition": `attachment; filename="${plan.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store",
    });
  });
  v1.delete("/user", async (c) => {
    const u = requireSession(c);
    const b = await body<{ handle: string; password: string }>(c);
    // The address is read first: after deletion there is nothing left to look it up from.
    const to = ctx.db.prepare("SELECT email FROM users WHERE owner_id = ?").get(u.id) as { email: string } | undefined;
    accounts.deleteAccount(ctx, u.id, b);
    if (to) void email.sendAccountDeletedEmail(to.email, u.handle);
    return c.body(null, 204);
  });

  // Stars.
  v1.get("/trending", (c) => {
    const period = (["day", "week", "month"] as const).find((p) => p === c.req.query("period")) ?? "week";
    return c.json(social.trending(ctx, period, userId(c)));
  });
  v1.get("/user/starred", (c) => c.json(social.starredBy(ctx, requireUser(c).id, userId(c))));
  v1.get("/owners/:handle/starred", (c) => c.json(social.starredBy(ctx, accounts.getOwner(ctx, c.req.param("handle")).id, userId(c))));
  v1.put("/repos/:owner/:repo/star", (c) => {
    const u = requireUser(c);
    const repo = repoFor(c);
    social.star(ctx, repo, u.id);
    return c.json({ starred: true, stars: repos.repoJson(repos.getRepoFor(ctx, repo.owner, repo.name, userId(c), "read")).stars });
  });
  v1.delete("/repos/:owner/:repo/star", (c) => {
    const u = requireUser(c);
    const repo = repoFor(c);
    social.unstar(ctx, repo, u.id);
    return c.json({ starred: false, stars: repos.repoJson(repos.getRepoFor(ctx, repo.owner, repo.name, userId(c), "read")).stars });
  });

  // Development only: messages that would have been emailed.
  if (!config.email.apiKey && process.env.NODE_ENV !== "production") v1.get("/dev/outbox", (c) => c.json([...email.sentEmails].reverse()));

  // Getting-started checklist: which activation steps this user has done.
  v1.get("/user/onboarding", (c) => c.json(onboarding.checklist(ctx, requireUser(c))));
  v1.get("/user/usage", (c) => {
    const u = requireUser(c);
    return c.json(stats.usage(ctx, u.id, u.plan as keyof typeof config.plans));
  });
  // The last requests one of your access tokens made (method, route, status, time, where from): for debugging a script.
  v1.get("/user/tokens/:id/requests", (c) => {
    const u = requireSession(c);
    const id = Number(c.req.param("id"));
    const own = ctx.db.prepare("SELECT 1 FROM tokens WHERE id = ? AND user_id = ? AND kind = 'pat'").get(id, u.id);
    if (!own) throw notFound("Token");
    return c.json(audit.tokenRequests(ctx, id));
  });
  // Audit log. Owners of an organization see what happened under it; admins of a repository see what happened to it;
  // a person sees what others did on their personal repositories. ?format=csv downloads up to 5,000 entries.
  const auditAnswer = (c: Context<Env>, ownerId: number, repo?: string) => {
    const q = (k: string) => c.req.query(k) || undefined;
    const csv = q("format") === "csv";
    const out = audit.listEvents(ctx, ownerId, { repo, actor: q("actor"), outcome: q("outcome"), before: q("before") ? Number(q("before")) : undefined, limit: csv ? 5000 : Number(q("limit") ?? 50), max: csv ? 5000 : 500 });
    if (!csv) return c.json(out);
    return c.body(audit.eventsCsv(out.events), 200, { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="audit-log.csv"' });
  };
  v1.get("/orgs/:org/audit-log", (c) => {
    const u = requireSession(c);
    const org = accounts.getOwner(ctx, c.req.param("org"));
    if (org.kind !== "org") throw notFound("Organization");
    if (accounts.orgRole(ctx, org.id, u.id) !== "Owner") throw new ApiError(403, "forbidden", `Only owners of ${org.handle} can read its audit log.`);
    return auditAnswer(c, org.id);
  });
  v1.get("/repos/:owner/:repo/audit-log", (c) => {
    const repo = repoFor(c, "admin");
    return auditAnswer(c, repo.owner_id, repo.name);
  });
  v1.get("/user/audit-log", (c) => auditAnswer(c, requireSession(c).id));
  v1.get("/user/tokens", (c) => {
    const header = c.req.header("authorization");
    return c.json(accounts.listTokens(ctx, requireUser(c).id, header?.startsWith("Bearer ") ? header.slice(7) : null));
  });
  v1.post("/user/tokens", async (c) => {
    const b = await body<{ note: string; scopes?: string[]; expiresInDays?: number | null; repos?: string[] }>(c);
    const u = requireSession(c);
    // Optional: limit the token to named repositories ("owner/name"), each one the person can see.
    const limitedTo = [...new Set((b.repos ?? []).map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
    if (limitedTo.length > 20) throw badRequest("Limit a token to at most 20 repositories.");
    for (const r of limitedTo) {
      const m = r.match(/^([a-z0-9][a-z0-9._-]*)\/([a-z0-9][a-z0-9._-]*)$/);
      if (!m) throw badRequest(`“${r.slice(0, 60)}” isn’t a repository. Use owner/name.`);
      repos.getRepoFor(ctx, m[1], m[2], u.id, "read");
    }
    if (!b.note?.trim()) throw badRequest("Add a note so you know what the token is for.");
    const unknown = (b.scopes ?? []).filter((s) => !(s in SCOPES));
    if (unknown.length) throw badRequest(`Unknown scopes: ${unknown.join(", ")}. Use ${Object.keys(SCOPES).join(", ")}.`);
    const t = accounts.issueToken(ctx, u.id, { kind: "pat", note: b.note.trim(), scopes: b.scopes?.length ? b.scopes : ["repo"], expiresInDays: b.expiresInDays ?? 90, repos: limitedTo });
    securitylog.record(ctx, u.id, "token_created", { detail: `${b.note.trim().slice(0, 60)} (${(b.scopes?.length ? b.scopes : ["repo"]).join(", ")}${limitedTo.length ? `; only ${limitedTo.join(", ")}` : ""})`, ...clientInfo(c) });
    return c.json(t, 201);
  });
  v1.delete("/user/tokens/:id", (c) => {
    const u = requireSession(c);
    accounts.revokeToken(ctx, u.id, Number(c.req.param("id")));
    securitylog.record(ctx, u.id, "token_revoked", clientInfo(c));
    return c.body(null, 204);
  });

  v1.post("/orgs", async (c) => {
    const b = await body<{ handle: string; name?: string; bio?: string }>(c);
    requireScope(c, "admin:org");
    const org = accounts.createOrg(ctx, { handle: b.handle ?? "", name: b.name, bio: b.bio }, requireUser(c).id);
    return c.json({ handle: org.handle, kind: org.kind, name: org.name, bio: org.bio }, 201);
  });
  v1.patch("/orgs/:org", async (c) => {
    requireScope(c, "admin:org");
    const b = await body<{ name?: string; bio?: string }>(c);
    const o = accounts.updateOrg(ctx, c.req.param("org"), requireUser(c).id, b);
    return c.json({ handle: o.handle, kind: o.kind, name: o.name, bio: o.bio });
  });
  // Everything in the organization's repositories (default branches) as one ZIP, for its owners.
  v1.get("/orgs/:org/export/repositories", (c) => {
    const u = requireSession(c);
    const org = ctx.db.prepare("SELECT id, handle FROM owners WHERE handle = ? AND kind = 'org'").get(c.req.param("org").toLowerCase()) as { id: number; handle: string } | undefined;
    if (!org) throw new ApiError(404, "not_found", "Organization not found");
    if (accounts.orgRole(ctx, org.id, u.id) !== "Owner") throw new ApiError(403, "forbidden", `Only owners of ${org.handle} can download all of its repositories.`);
    limit(c, `export-bundle:${org.id}`, { max: 5, windowMs: 60 * 60_000 }, "That export was requested a few times just now. Try again in an hour.");
    const plan = archive.planAccountBundle(ctx, repos.listRepos(ctx, u.id, { owner: org.handle }).filter((r) => r.owner === org.handle), org.handle);
    return c.body(archive.archiveStream(ctx, plan), 200, {
      "content-type": "application/zip",
      "content-length": String(plan.length),
      "content-disposition": `attachment; filename="${plan.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "cache-control": "private, no-store",
    });
  });
  v1.delete("/orgs/:org", async (c) => {
    const u = requireSession(c); // like deleting an account: a signed-in browser, not a token
    const b = await body<{ confirm: string }>(c);
    accounts.deleteOrg(ctx, c.req.param("org"), u.id, b.confirm);
    return c.body(null, 204);
  });
  // Organization members (see accounts.ts for who may do what).
  v1.post("/orgs/:org/members", async (c) => {
    requireScope(c, "admin:org");
    const u = requireUser(c);
    accounts.requireVerified(u, "invite people");
    const b = await body<{ handle: string; role?: string }>(c);
    const members = accounts.inviteMember(ctx, c.req.param("org"), u.id, b);
    const invited = ctx.db.prepare("SELECT u.email, o.handle FROM owners o JOIN users u ON u.owner_id = o.id WHERE o.handle = ?").get((b.handle ?? "").replace(/^@/, "").toLowerCase()) as { email: string; handle: string } | undefined;
    const org = c.req.param("org");
    if (invited) void email.sendInviteEmail(invited.email, org, u.name, b.role ?? "Member", `${config.webUrl}/orgs/${org}`);
    return c.json(members, 201);
  });
  v1.patch("/orgs/:org/members/:handle", async (c) => {
    requireScope(c, "admin:org");
    const b = await body<{ role: string }>(c);
    return c.json(accounts.setMemberRole(ctx, c.req.param("org"), requireUser(c).id, c.req.param("handle"), b.role));
  });
  v1.delete("/orgs/:org/members/:handle", (c) => (requireScope(c, "admin:org"), c.json(accounts.removeMember(ctx, c.req.param("org"), requireUser(c).id, c.req.param("handle")))));

  // Organization domains (owners only): prove control with a DNS TXT record; optionally let people with a confirmed address there join.
  v1.get("/orgs/:org/domains", (c) => (requireScope(c, "admin:org"), c.json({ domains: domains.listDomains(ctx, c.req.param("org"), requireUser(c).id) })));
  v1.post("/orgs/:org/domains", async (c) => {
    requireScope(c, "admin:org");
    const b = await body<{ domain?: string }>(c);
    return c.json(domains.addDomain(ctx, c.req.param("org"), requireUser(c).id, b.domain), 201);
  });
  v1.post("/orgs/:org/domains/:domain/verify", async (c) => {
    requireScope(c, "admin:org");
    limit(c, `domain-verify:${requireUser(c).id}`, { max: 30, windowMs: 10 * 60_000 }, "Too many checks. DNS changes take a few minutes: wait, then try again.");
    return c.json(await domains.verifyDomain(ctx, c.req.param("org"), requireUser(c).id, c.req.param("domain")));
  });
  v1.patch("/orgs/:org/domains/:domain", async (c) => {
    requireScope(c, "admin:org");
    const b = await body<{ autoJoin?: boolean }>(c);
    return c.json(domains.setAutoJoin(ctx, c.req.param("org"), requireUser(c).id, c.req.param("domain"), b.autoJoin));
  });
  v1.delete("/orgs/:org/domains/:domain", (c) => {
    requireScope(c, "admin:org");
    domains.removeDomain(ctx, c.req.param("org"), requireUser(c).id, c.req.param("domain"));
    return c.body(null, 204);
  });

  // Storage used by one account or org. Only the account itself and org members can see it.
  v1.get("/owners/:handle/usage", (c) => {
    const u = requireUser(c);
    const o = accounts.getOwner(ctx, c.req.param("handle"));
    const allowed = o.kind === "user" ? o.id === u.id : accounts.orgRole(ctx, o.id, u.id) !== null;
    if (!allowed) throw new ApiError(404, "not_found", `${o.handle} not found`);
    return c.json(stats.ownerUsage(ctx, u.id, o.handle, o.kind === "org" ? "team" : (u.plan as keyof typeof config.plans)));
  });
  v1.get("/owners/:handle", (c) => {
    const o = accounts.getOwner(ctx, c.req.param("handle"));
    return c.json({
      handle: o.handle,
      kind: o.kind,
      name: o.name,
      bio: o.bio,
      ...(o.kind === "user" ? { website: o.website, location: o.location, company: o.company, pronouns: o.pronouns } : {}),
      hasAvatar: accounts.hasAvatar(ctx, o.id),
      createdAt: o.created_at,
      members: o.kind === "org" ? accounts.listMembers(ctx, o.id) : undefined,
      verifiedDomains: o.kind === "org" ? domains.verifiedDomains(ctx, o.id) : undefined,
      // For people: the orgs they belong to and how many commits they authored in repositories the viewer can see.
      orgs: o.kind === "user" ? (ctx.db.prepare("SELECT g.handle FROM memberships m JOIN owners g ON g.id = m.org_id WHERE m.user_id = ? ORDER BY g.handle").all(o.id) as { handle: string }[]).map((r) => r.handle) : undefined,
      commitCount:
        o.kind === "user"
          ? repos.listRepos(ctx, userId(c)).reduce((n, r) => n + (ctx.db.prepare("SELECT COUNT(*) AS n FROM commits WHERE repo_id = ? AND author = ?").get(r.id, o.handle) as { n: number }).n, 0)
          : undefined,
      repositories: repos.listRepos(ctx, userId(c), { owner: o.handle }).map(repos.repoJson),
    });
  });

  // ── Repositories ─────────────────────────────────────────────────────────
  /** `?covers=lat,lon` (repositories whose data includes that place) and `?bbox=west,south,east,north` (any that overlap that box). */
  function spatialFilters(c: Context<Env>): { covers?: { lat: number; lon: number }; bbox?: BBox } {
    const out: { covers?: { lat: number; lon: number }; bbox?: BBox } = {};
    const covers = c.req.query("covers");
    if (covers) {
      const p = parseLatLon(covers);
      if (!p) throw badRequest("`covers` is a place as latitude,longitude, like 10.3,76.3.");
      out.covers = p;
    }
    const box = c.req.query("bbox");
    if (box) {
      const v = box.split(",").map(Number);
      if (v.length !== 4 || v.some((n) => !Number.isFinite(n)) || v[0] > v[2] || v[1] > v[3] || v[1] < -90 || v[3] > 90 || v[0] < -180 || v[2] > 180) throw badRequest("`bbox` is west,south,east,north in degrees, like 76,10,77,11.");
      out.bbox = v as BBox;
    }
    return out;
  }
  // README starters for the kinds of data people keep here (used by the new-repository form).
  v1.get("/readme-templates", (c) => c.json(cards.listCards()));
  v1.get("/repos", (c) => c.json(repos.listRepos(ctx, userId(c), { owner: c.req.query("owner"), q: c.req.query("q"), topic: c.req.query("topic"), ...spatialFilters(c) }).map(repos.repoJson)));
  v1.post("/repos", async (c) => {
    const u = requireUser(c);
    requireScope(c, "repo");
    const b = await body<Parameters<typeof repos.createRepo>[2] & { sample?: boolean; card?: string }>(c);
    const card = b.card ? cards.findCard(b.card) : null;
    if (b.card && !card) throw badRequest(`Unknown README template “${String(b.card).slice(0, 40)}”.`);
    const ownerHandle = b.owner ?? u.handle;
    const ownerRow = accounts.getOwner(ctx, ownerHandle);
    // A request that does not say starts with what the person chose in Settings → Preferences.
    b.visibility ??= u.default_visibility;
    if (b.visibility === "public") accounts.requireVerified(u, "publish a public repository");
    else plans.assertPrivateRepoAllowed(ctx, ownerRow.id);
    const repo = repos.createRepo(ctx, u.id, b);
    // { sample: true } fills it with the sample project (files, checks, a branch and a pull request).
    if (b.sample) {
      await onboarding.importSample(ctx, repo, u);
      setImmediate(() => void extent.refreshFootprint(ctx, repo));
    } else if (card) {
      // A README starter for the kind of data this is, as the repository's first commit.
      const fresh = repos.getRepoFor(ctx, repo.owner, repo.name, u.id, "write");
      await commitFiles(ctx, fresh, { branch: fresh.default_branch, author: u.handle, via: "import", message: `Add README from the ${card.name} template`, timestamp: new Date(), changes: { "README.md": Buffer.from(cards.cardReadme(card, fresh)) } });
    }
    return c.json(repos.repoJson(repos.getRepoFor(ctx, repo.owner, repo.name, u.id, "read")), 201);
  });
  v1.get("/repos/:owner/:repo", async (c) => {
    const repo = repoFor(c);
    const branches = history.listRefs(ctx, repo, "branch");
    let head: ReturnType<typeof history.commitJson> | null = null;
    let commitCount = 0;
    let readme: string | null = null;
    const tip = branches.find((b) => b.name === repo.default_branch)?.commit_id;
    if (tip) {
      const log = history.listCommits(ctx, repo, tip, 10_000);
      commitCount = log.length;
      head = history.commitJson(log[0]);
      readme = await files.readmeAt(ctx, repo, tip);
    }
    return c.json({ ...repos.repoJson(repo), access: accounts.repoAccess(ctx, repo, c.get("user")?.id ?? null), starred: social.hasStarred(ctx, repo, c.get("user")?.id ?? null), branchCount: branches.length, commitCount, head, readme, openIssues: collab.listIssues(ctx, repo, { state: "open" }).length, openPulls: collab.listPulls(ctx, repo, { state: "open" }).length });
  });
  v1.patch("/repos/:owner/:repo", async (c) => {
    const repo = repoFor(c, "admin");
    const b = await body<Parameters<typeof repos.updateRepo>[2]>(c);
    if (b.visibility && b.visibility !== repo.visibility) {
      if (b.visibility === "public") accounts.requireVerified(requireUser(c), "make a repository public");
      else plans.assertPrivateRepoAllowed(ctx, repo.owner_id);
    }
    return c.json(repos.repoJson(repos.updateRepo(ctx, repo, b)));
  });
  v1.delete("/repos/:owner/:repo", (c) => {
    repos.deleteRepo(ctx, repoFor(c, "admin"));
    return c.body(null, 204);
  });

  // ── Transfer: chunks and objects ─────────────────────────────────────────
  v1.post("/repos/:owner/:repo/chunks/missing", async (c) => {
    const b = await body<{ hashes: string[] }>(c);
    if (!Array.isArray(b.hashes) || b.hashes.length > 100_000) throw badRequest("Send up to 100,000 hashes.");
    return c.json({ missing: chunks.missingChunks(ctx, repoFor(c, "write"), b.hashes) });
  });
  v1.put("/repos/:owner/:repo/chunks/:hash", async (c) => {
    const repo = repoFor(c, "write");
    const declared = Number(c.req.header("content-length") ?? 0);
    if (declared > config.chunking.max) throw badRequest(`Chunks are at most ${config.chunking.max} bytes.`);
    // Without a declared length the stream is cut off at the limit rather than read to the end.
    const data = await readLimited(c, config.chunking.max).catch((err) => {
      if (err instanceof ApiError && err.status === 413) throw badRequest(`Chunks are at most ${config.chunking.max} bytes.`);
      throw err;
    });
    // Bytes this repository can already reference are free; only new chunks count toward the plan.
    // (Judged by what it can see, not what exists anywhere, so a limit error can't reveal whether
    // someone else's private repository holds these bytes.)
    if (!chunks.visibleToRepo(ctx, repo, c.req.param("hash"))) plans.assertStorageAvailable(ctx, repo, data.length);
    return c.json(await chunks.putChunk(ctx, repo, c.req.param("hash"), data), 201);
  });
  // Many chunks in one request, for a push of thousands of small files. The body is frames back to back, each a 64
  // character hash, a 4-byte big-endian length, one encoding byte and that many bytes of payload. The payload is the
  // chunk as stored (encoding 0 raw, 1 zstd, 2-4 byte-shuffled then zstd), so the client compresses what it sends and
  // the server verifies it without recompressing. Every chunk goes through the same checks as the single upload; an
  // invalid frame fails the request, and chunks stored before it stay (a retry finds them present).
  v1.post("/repos/:owner/:repo/chunks", async (c) => {
    const repo = repoFor(c, "write");
    const data = await readLimited(c, CHUNK_BATCH_MAX_BYTES);
    const items: { hash: string; stored: Buffer }[] = [];
    let at = 0;
    while (at < data.length) {
      if (items.length >= CHUNK_BATCH_MAX_CHUNKS) throw badRequest(`Send at most ${CHUNK_BATCH_MAX_CHUNKS} chunks per request.`);
      if (at + 69 > data.length) throw badRequest("The batch ends inside a chunk header.");
      const hash = data.subarray(at, at + 64).toString("latin1");
      const length = data.readUInt32BE(at + 64);
      const encoding = data[at + 68];
      at += 69;
      // An encoded chunk can be a little larger than the chunk (one byte of header); anything beyond that is not a chunk.
      if (length > config.chunking.max + 64) throw badRequest(`Chunks are at most ${config.chunking.max} bytes.`);
      if (at + length > data.length) throw badRequest(`Chunk ${hash.slice(0, 12)} is cut off.`);
      const payload = data.subarray(at, at + length);
      at += length;
      items.push({ hash, stored: Buffer.concat([Buffer.from([encoding]), payload]) });
    }
    // The plan limit is judged over the whole batch before anything is written, counting what is new by its stored size.
    let incoming = 0;
    for (const it of items) {
      if (chunks.visibleToRepo(ctx, repo, it.hash)) continue;
      incoming += it.stored.length;
      plans.assertStorageAvailable(ctx, repo, incoming);
    }
    // Stored a few at a time: against an object store each put is a round trip, and they do not depend on each other.
    const results = await chunks.mapLimit(items, chunks.storeConcurrency(ctx), (it) => chunks.putStored(ctx, repo, it.hash, it.stored));
    return c.json({ stored: results.length, chunks: results }, 201);
  });
  // The other direction: POST the hashes wanted (JSON, up to 500) and receive frames, in the same layout as the batched
  // upload, for as many as fit in about 8 MB (always at least the first). The client asks again for the rest. Each
  // chunk must be one this repository may reference, exactly as for a single download.
  v1.post("/repos/:owner/:repo/chunks/fetch", async (c) => {
    const repo = repoFor(c);
    const b = await body<{ hashes: string[] }>(c);
    if (!Array.isArray(b.hashes) || b.hashes.length === 0 || b.hashes.length > 500) throw badRequest("Send between 1 and 500 hashes.");
    const frames: Buffer[] = [];
    let total = 0;
    let count = 0;
    for (const hash of b.hashes) {
      if (typeof hash !== "string") throw badRequest("Hashes are strings.");
      // Chunks go out as stored (hash, payload length, encoding byte, payload): what travels is the compressed form,
      // and the client decodes and re-hashes it.
      const stored = await chunks.getStoredChunk(ctx, repo, hash);
      const header = Buffer.alloc(69);
      header.write(hash, 0, 64, "latin1");
      header.writeUInt32BE(stored.length - 1, 64);
      header[68] = stored[0];
      frames.push(header, stored.subarray(1));
      total += stored.length;
      count++;
      if (total >= CHUNK_FETCH_SOFT_BYTES) break;
    }
    return new Response(new Uint8Array(Buffer.concat(frames)), { status: 200, headers: { "content-type": "application/octet-stream", "x-craton-chunks": String(count) } });
  });
  v1.get("/repos/:owner/:repo/chunks/:hash", async (c) => {
    const data = await chunks.getChunk(ctx, repoFor(c), c.req.param("hash"));
    return c.body(new Uint8Array(data), 200, { "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" });
  });
  v1.post("/repos/:owner/:repo/objects/missing", async (c) => {
    const b = await body<{ ids: string[] }>(c);
    return c.json({ missing: history.missingObjects(ctx, repoFor(c, "write"), b.ids ?? []) });
  });
  v1.post("/repos/:owner/:repo/objects", async (c) => {
    const b = await body<{ objects: unknown[] }>(c);
    if (!Array.isArray(b.objects)) throw badRequest("Send { objects: [...] }.");
    return c.json(history.registerObjects(ctx, repoFor(c, "write"), b.objects), 201);
  });
  v1.get("/repos/:owner/:repo/objects/:id", (c) => c.json(history.getObject(ctx, repoFor(c), c.req.param("id"))));

  // Everything needed to clone a ref in one request: commit, tree and every blob manifest.
  v1.get("/repos/:owner/:repo/manifest/:ref{.+}", (c) => {
    const repo = repoFor(c);
    const commitId = history.resolveRef(ctx, repo, c.req.param("ref"));
    const commit = history.getObject<CommitObject>(ctx, repo, commitId, "commit");
    const tree = history.getObject<TreeObject>(ctx, repo, commit.tree, "tree");
    const blobs: Record<string, BlobObject> = {};
    for (const e of tree.entries) blobs[e.blob] = history.getObject<BlobObject>(ctx, repo, e.blob, "blob");
    return c.json({ commitId, commit, tree, blobs });
  });

  /** What follows a branch moving: draw the new previews off the request, and tell webhooks. */
  /** Tell the person who pushed when checks fail on it (they are at their desk, not watching the checks page). */
  function announceChecks(repo: repos.RepoRow, branch: string, commit: string, run: { status: string; steps: { name: string; status: string; detail: string }[] } | null, userId: number) {
    if (!run || run.status !== "failed") return;
    const to = ctx.db.prepare("SELECT email FROM users WHERE owner_id = ?").get(userId) as { email: string } | undefined;
    if (!to || !wantsEmail(ctx, to.email, "checks_failed")) return;
    const failed = run.steps.filter((s) => s.status === "failed");
    void email.sendChecksFailedEmail(to.email, `${repo.owner}/${repo.name}`, branch, commit, failed, `${config.webUrl}/${repo.owner}/${repo.name}/checks`);
  }
  function announcePush(repo: repos.RepoRow, branch: string, before: string | null, after: string, pusher: string) {
    if (config.prewarmPreviews) setImmediate(() => void previews.warmCommit(ctx, repo, after));
    // The default branch decides where a repository says its data is; work that out in the background.
    if (branch === repo.default_branch) setImmediate(() => void extent.refreshFootprint(ctx, repo));
    let commits: { sha: string; message: string; author: string }[] = [];
    if (before) {
      try {
        commits = history.compareRefs(ctx, repo, before, after).commits.slice(0, 20).map((k) => ({ sha: k.sha, message: k.message, author: k.author }));
      } catch {}
    }
    webhooks.emit(ctx, repo, "push", { branch, before, after, pusher, commits });
  }

  // Add files from the browser: multipart with `file` parts and a matching JSON `paths` list, plus
  // branch, folder, message and (optionally) the commit the person was looking at. Server-side
  // chunking, so no CLI is needed; bigger uploads go through `craton push`.
  v1.post("/repos/:owner/:repo/upload", async (c) => {
    const repo = repoFor(c, "write");
    const user = requireUser(c);
    const declared = Number(c.req.header("content-length") ?? 0);
    const tooBig = new ApiError(413, "too_large", `Uploads from the browser are limited to ${Math.round(config.upload.maxBytes / 1048576)} MB at a time. Use the CLI for more: craton push.`);
    if (declared > config.upload.maxBytes + 1_048_576) throw tooBig;
    if (!(c.req.header("content-type") ?? "").startsWith("multipart/form-data")) throw badRequest("Send the files as multipart/form-data.");
    const form = await c.req.formData();
    const parts = form.getAll("file").filter((v): v is File => typeof v !== "string");
    let names: unknown;
    try {
      names = JSON.parse(String(form.get("paths") ?? "[]"));
    } catch {
      throw badRequest("`paths` must be a JSON list of file paths.");
    }
    if (!Array.isArray(names) || names.length !== parts.length) throw badRequest("Send one entry in `paths` for each file.");
    const folder = String(form.get("folder") ?? "");
    let total = 0;
    const files: ingest.UploadFile[] = [];
    for (let i = 0; i < parts.length; i++) {
      total += parts[i].size;
      if (total > config.upload.maxBytes) throw tooBig;
      files.push({ path: ingest.cleanUploadPath(folder, String(names[i] ?? parts[i].name)), data: Buffer.from(await parts[i].arrayBuffer()) });
    }
    const branch = String(form.get("branch") || repo.default_branch);
    const result = await ingest.commitUpload(ctx, repo, user.handle, {
      secrets: { who: secretActor(c), bypass: secretBypass(c, form.get("allowSecrets")) },
      branch,
      from: String(form.get("from") ?? "") || null,
      expected: String(form.get("expected") ?? "") || null,
      message: String(form.get("message") ?? ""),
      files,
    });
    const checks = await runChecks(ctx, repo, result.commit, branch);
    announceChecks(repo, branch, result.commit, checks, user.id);
    announcePush(repo, branch, result.before, result.commit, user.handle);
    return c.json({ ...result, checks }, 201);
  });

  // Put one file back to an earlier version as a new commit. History is never rewritten.
  v1.post("/repos/:owner/:repo/restore", async (c) => {
    const repo = repoFor(c, "write");
    const b = await body<{ path: string; from: string; branch?: string; message?: string }>(c);
    if (!b.path || !b.from) throw badRequest("Say which file and which version: { path, from }.");
    const user = requireUser(c);
    const branch = b.branch || repo.default_branch;
    const done = history.restoreFile(ctx, repo, branch, b.path, b.from, user.handle, b.message);
    const checks = await runChecks(ctx, repo, done.commit, branch);
    announceChecks(repo, branch, done.commit, checks, user.id);
    announcePush(repo, branch, done.before, done.commit, user.handle);
    return c.json({ ...done, checks }, 201);
  });

  // ── Refs ─────────────────────────────────────────────────────────────────
  v1.get("/repos/:owner/:repo/refs", (c) => {
    const repo = repoFor(c);
    return c.json({ branches: history.listRefs(ctx, repo, "branch"), tags: history.listRefs(ctx, repo, "tag"), defaultBranch: repo.default_branch });
  });
  v1.post("/repos/:owner/:repo/refs/heads/:branch{.+}", async (c) => {
    const repo = repoFor(c, "write");
    const b = await body<{ commit: string; expected: string | null; allowSecrets?: string }>(c);
    const branch = c.req.param("branch");
    // Nothing moves until the new commits have been read for credentials: history can't be edited afterwards.
    const bypass = secretBypass(c, b.allowSecrets);
    const scan = await secretscan.scanBranchUpdate(ctx, repo, branch, b.commit);
    secretscan.enforce(ctx, repo, secretActor(c), scan.findings, bypass, "/repos/:owner/:repo/refs/heads/:branch");
    const result = history.updateBranch(ctx, repo, branch, b.commit, b.expected ?? null, requireUser(c).handle);
    const checks = result.updated ? await runChecks(ctx, repo, b.commit, branch) : null;
    announceChecks(repo, branch, b.commit, checks, requireUser(c).id);
    if (result.updated) announcePush(repo, branch, result.old, b.commit, requireUser(c).handle);
    return c.json({ ...result, checks });
  });

  // APA, BibTeX and CITATION.cff from the repository's real metadata (or its own CITATION.cff).
  v1.get("/repos/:owner/:repo/citation", async (c) => c.json(await citationFor(ctx, repoFor(c))));
  // schema.org Dataset markup for search engines. Only for a public repository: a private one is not described to anyone.
  v1.get("/repos/:owner/:repo/dataset.jsonld", async (c) => {
    const repo = repoFor(c);
    if (repo.visibility !== "public") throw notFound("Repository");
    return c.json(await datasetJsonLd(ctx, repo));
  });

  // ── Share links (repository admins make them; anyone holding one can read that snapshot) ──
  v1.get("/repos/:owner/:repo/share-links", (c) => c.json({ expiryChoices: sharing.EXPIRY_CHOICES, links: sharing.listLinks(ctx, repoFor(c, "admin")) }));
  v1.post("/repos/:owner/:repo/share-links", async (c) => {
    const repo = repoFor(c, "admin");
    return c.json(sharing.createLink(ctx, repo, requireUser(c).id, await body(c)), 201);
  });
  v1.delete("/repos/:owner/:repo/share-links/:id", (c) => {
    sharing.revokeLink(ctx, repoFor(c, "admin"), Number(c.req.param("id")));
    return c.body(null, 204);
  });

  // What a link opens. No sign-in; the token is the credential, so these never cache it, never
  // leak it in a Referer, and slow down anyone guessing tokens.
  const sharedHeaders = { "cache-control": "private, no-store", "x-robots-tag": "noindex, nofollow" };
  const guessing = { max: 30, windowMs: 10 * 60_000 };
  async function shared<T>(c: Context<Env>, work: () => T | Promise<T>): Promise<T> {
    const key = `share-miss:${clientIp(c)}`;
    if (limits.count(key, guessing) >= guessing.max) throw new ApiError(429, "rate_limited", "Too many links tried from this network. Wait a few minutes.");
    try {
      return await work();
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) limits.take(key, guessing);
      throw err;
    }
  }
  v1.get("/shared/:token", async (c) => c.json(await shared(c, () => sharing.overview(ctx, c.req.param("token"))), 200, sharedHeaders));
  v1.get("/shared/:token/file/:path{.+}", async (c) => {
    const f = await shared(c, () => sharing.fileOf(ctx, c.req.param("token"), c.req.param("path")));
    const name = f.path.split("/").pop()!.replace(/[^A-Za-z0-9._-]/g, "_");
    return c.body(archive.blobStream(ctx, f.blob), 200, {
      ...sharedHeaders,
      "content-type": "application/octet-stream",
      "content-length": String(f.blob.size),
      "content-disposition": `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(f.path.split("/").pop()!)}`,
      "x-craton-sha256": f.blob.sha256,
    });
  });
  v1.get("/shared/:token/archive", async (c) => {
    const plan = await shared(c, () => {
      const { link, repo } = sharing.resolveToken(ctx, c.req.param("token"));
      return { plan: archive.planArchive(ctx, repo, link.commit_id, c.req.query("path") ?? ""), repo };
    });
    const safe = plan.plan.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    return c.body(archive.archiveStream(ctx, plan.plan), 200, {
      ...sharedHeaders,
      "content-type": "application/zip",
      "content-length": String(plan.plan.length),
      "content-disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(plan.plan.filename)}`,
    });
  });
  v1.get("/shared/:token/render/:path{.+}", async (c) => {
    const size = Math.min(1024, Math.max(64, Number(c.req.query("size") ?? 512) || 512));
    const path = c.req.param("path");
    const { link, repo } = await shared(c, () => sharing.resolveToken(ctx, c.req.param("token")));
    const cache = { "cache-control": "private, max-age=300", "x-robots-tag": "noindex, nofollow" };
    try {
      if (/\.tiff?$/i.test(path)) return c.body(new Uint8Array((await previews.rasterThumbnail(ctx, repo, link.commit_id, path, size)).png), 200, { ...cache, "content-type": "image/png" });
      if (/\.shp$/i.test(path)) return c.body((await previews.vectorSvg(ctx, repo, link.commit_id, path)).svg, 200, { ...cache, "content-type": "image/svg+xml" });
    } catch (err) {
      if (previews.isUnsupported(err)) throw new ApiError(415, "no_preview", (err as Error).message);
      throw err;
    }
    throw new ApiError(415, "no_preview", "Previews are drawn for GeoTIFF rasters and shapefiles.");
  });

  // ── Webhooks (repository admins only: they expose URLs and signing secrets) ──
  v1.get("/repos/:owner/:repo/webhooks", (c) => c.json({ events: webhooks.EVENTS, webhooks: webhooks.listHooks(ctx, repoFor(c, "admin")) }));
  v1.post("/repos/:owner/:repo/webhooks", async (c) => {
    const repo = repoFor(c, "admin");
    const b = await body<{ url: string; events: string[]; format?: string }>(c);
    const hook = webhooks.createHook(ctx, repo, requireUser(c).id, b);
    webhooks.ping(ctx, repo, hook.id);
    return c.json(hook, 201);
  });
  v1.patch("/repos/:owner/:repo/webhooks/:id", async (c) => c.json(webhooks.updateHook(ctx, repoFor(c, "admin"), Number(c.req.param("id")), await body(c))));
  v1.delete("/repos/:owner/:repo/webhooks/:id", (c) => {
    webhooks.deleteHook(ctx, repoFor(c, "admin"), Number(c.req.param("id")));
    return c.body(null, 204);
  });
  v1.get("/repos/:owner/:repo/webhooks/:id/deliveries", (c) => c.json(webhooks.listDeliveries(ctx, repoFor(c, "admin"), Number(c.req.param("id")))));
  v1.post("/repos/:owner/:repo/webhooks/:id/ping", (c) => {
    webhooks.ping(ctx, repoFor(c, "admin"), Number(c.req.param("id")));
    return c.body(null, 202);
  });
  v1.post("/repos/:owner/:repo/webhooks/:id/deliveries/:delivery/redeliver", (c) => {
    webhooks.redeliver(ctx, repoFor(c, "admin"), Number(c.req.param("id")), Number(c.req.param("delivery")));
    return c.body(null, 202);
  });

  // ── File locks ───────────────────────────────────────────────────────────
  v1.get("/repos/:owner/:repo/locks", (c) => c.json(locks.listLocks(ctx, repoFor(c))));
  v1.post("/repos/:owner/:repo/locks", async (c) => {
    const repo = repoFor(c, "write");
    const b = await body<{ path: string; reason?: string }>(c);
    const me = requireUser(c);
    const lock = locks.lockPath(ctx, repo, me.id, b.path, b.reason ?? "");
    webhooks.emit(ctx, repo, "lock", { action: "locked", path: lock.path, reason: lock.reason, holder: me.handle });
    return c.json(lock, 201);
  });
  v1.delete("/repos/:owner/:repo/locks/:path{.+}", (c) => {
    const force = c.req.query("force") === "true";
    const repo = repoFor(c, force ? "admin" : "write");
    const me = requireUser(c);
    locks.unlockPath(ctx, repo, me.id, c.req.param("path"), force);
    webhooks.emit(ctx, repo, "lock", { action: "unlocked", path: c.req.param("path"), by: me.handle, forced: force });
    return c.body(null, 204);
  });

  v1.get("/repos/:owner/:repo/branches", (c) => {
    const repo = repoFor(c);
    const refs = history.listRefs(ctx, repo, "branch");
    const defaultTip = refs.find((r) => r.name === repo.default_branch)?.commit_id;
    const defaultSet = defaultTip ? history.ancestors(ctx, repo, defaultTip) : new Set<string>();
    return c.json(
      refs.map((r) => {
        const set = history.ancestors(ctx, repo, r.commit_id);
        const head = history.listCommits(ctx, repo, r.commit_id, 1)[0];
        return {
          name: r.name,
          isDefault: r.name === repo.default_branch,
          commit: history.commitJson(head),
          ahead: [...set].filter((id) => !defaultSet.has(id)).length,
          behind: [...defaultSet].filter((id) => !set.has(id)).length,
          updatedAt: r.updated_at,
        };
      }),
    );
  });
  v1.post("/repos/:owner/:repo/branches", async (c) => {
    const repo = repoFor(c, "write");
    const b = await body<{ name: string; from?: string }>(c);
    return c.json(history.createBranch(ctx, repo, b.name, b.from ?? repo.default_branch, requireUser(c).handle), 201);
  });
  v1.delete("/repos/:owner/:repo/branches/:name{.+}", (c) => {
    history.deleteBranch(ctx, repoFor(c, "write"), c.req.param("name"), requireUser(c).handle);
    return c.body(null, 204);
  });

  // ── Browsing ─────────────────────────────────────────────────────────────
  v1.get("/repos/:owner/:repo/tree/:ref{[^/]+}", (c) => c.json(history.listTree(ctx, repoFor(c), c.req.param("ref"), c.req.query("path") ?? "")));
  v1.get("/repos/:owner/:repo/commits", (c) => {
    const repo = repoFor(c);
    const limit = Math.min(Math.max(Number(c.req.query("limit") ?? 50) || 50, 1), 500);
    const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
    // ?since= and ?until= (ISO dates or times) and ?author= narrow the list; ?offset= pages through it.
    const since = c.req.query("since"), until = c.req.query("until"), author = c.req.query("author");
    for (const [name, v] of [["since", since], ["until", until]] as const) {
      if (v && Number.isNaN(Date.parse(v))) throw badRequest(`${name} must be a date like 2026-10-01 or 2026-10-01T12:00:00Z.`);
    }
    const all = history.listCommits(ctx, repo, c.req.query("ref") ?? repo.default_branch, since || until || author || offset ? 10_000 : limit);
    const rows = all
      .filter((r) => (!since || Date.parse(r.timestamp) >= Date.parse(since)) && (!until || Date.parse(r.timestamp) <= Date.parse(until)) && (!author || r.author === author))
      .slice(offset, offset + limit);
    // ?changes=1 adds each commit's changed files with chunk counts (the commit list shows them).
    if (c.req.query("changes") !== "1") return c.json(rows.map(history.commitJson));
    return c.json(rows.map((r) => ({ ...history.commitJson(r), changes: history.commitChanges(ctx, repo, history.getObject<CommitObject>(ctx, repo, r.id, "commit")) })));
  });
  // Full commit objects reachable from a ref (for `craton clone` / `pull`).
  v1.get("/repos/:owner/:repo/commit-objects", (c) => {
    const repo = repoFor(c);
    const limit = Math.min(Number(c.req.query("limit") ?? 1000), 10_000);
    const rows = history.listCommits(ctx, repo, c.req.query("ref") ?? repo.default_branch, limit);
    return c.json(rows.map((r) => ({ id: r.id, commit: history.getObject<CommitObject>(ctx, repo, r.id, "commit") })));
  });
  v1.get("/repos/:owner/:repo/commits/:sha", (c) => {
    const repo = repoFor(c);
    const id = history.resolveRef(ctx, repo, c.req.param("sha"));
    const row = history.listCommits(ctx, repo, id, 1)[0];
    const commit = history.getObject<CommitObject>(ctx, repo, id, "commit");
    return c.json({ ...history.commitJson(row), changes: history.commitChanges(ctx, repo, commit), checks: listCheckRuns(ctx, repo, { commit: id, limit: 1 })[0] ?? null });
  });
  // A file's bytes. Supports `Range: bytes=…` (one range), so a client can read the middle of a large raster without
  // downloading it (the Python filesystem and anything that speaks HTTP ranges rely on this). Without a Range the whole
  // file is streamed chunk by chunk, so the size is not limited by memory.
  v1.get("/repos/:owner/:repo/raw/:ref/:path{.+}", async (c) => {
    const repo = repoFor(c);
    const commit = history.getObject<CommitObject>(ctx, repo, history.resolveRef(ctx, repo, c.req.param("ref")), "commit");
    const tree = history.getObject<TreeObject>(ctx, repo, commit.tree, "tree");
    const entry = tree.entries.find((e) => e.path === c.req.param("path"));
    if (!entry) throw new ApiError(404, "not_found", "File not found");
    const blob = history.getObject<BlobObject>(ctx, repo, entry.blob, "blob");
    const headers = { "content-type": "application/octet-stream", "x-craton-sha256": blob.sha256, "accept-ranges": "bytes", "cache-control": "private, no-cache" };
    const range = parseRange(c.req.header("range"), blob.size);
    if (range === "unsatisfiable") return c.body(null, 416, { ...headers, "content-range": `bytes */${blob.size}` });
    if (range) {
      // At most 64 MB per request; a client that wants more asks again from where this one stopped (the answer says how far it got).
      const end = Math.min(range.end, range.start + MAX_RANGE_BYTES - 1);
      const data = await new chunks.BlobReader(ctx, blob).read(range.start, end - range.start + 1);
      return c.body(new Uint8Array(data), 206, { ...headers, "content-range": `bytes ${range.start}-${end}/${blob.size}`, "content-length": String(data.length) });
    }
    let next = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (next >= blob.chunks.length) return controller.close();
        controller.enqueue(new Uint8Array(await chunks.readChunk(ctx, blob.chunks[next++].hash)));
      },
    });
    return c.body(body, 200, { ...headers, "content-length": String(blob.size) });
  });

  // Every file path at a ref, with sizes: all "Go to file" needs, without the manifest's blobs.
  v1.get("/repos/:owner/:repo/paths/:ref{.+}", (c) => {
    const repo = repoFor(c);
    const commitId = history.resolveRef(ctx, repo, c.req.param("ref"));
    const tree = history.getObject<TreeObject>(ctx, repo, history.getObject<CommitObject>(ctx, repo, commitId, "commit").tree, "tree");
    return c.json({ commit: commitId, files: tree.entries.map((e) => ({ path: e.path, size: e.size })) });
  });

  // The repository (or ?path=<folder>) at a ref as a ZIP, streamed from the chunk store. Unlike
  // /raw, there is no 16 MB cap: memory use is one chunk. Past 4 GB it points to the CLI.
  v1.get("/repos/:owner/:repo/archive/:ref{.+}", (c) => {
    const repo = repoFor(c);
    const plan = archive.planArchive(ctx, repo, c.req.param("ref"), c.req.query("path") ?? "");
    const safe = plan.filename.replace(/[^A-Za-z0-9._-]/g, "_");
    return c.body(archive.archiveStream(ctx, plan), 200, {
      "content-type": "application/zip",
      "content-length": String(plan.length),
      "content-disposition": `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(plan.filename)}`,
      "cache-control": "private, no-cache",
      "x-craton-commit": plan.commitId,
    });
  });

  // Merging head into base: commits ahead, file changes since the merge base, conflicting paths.
  v1.get("/repos/:owner/:repo/compare/:spec{.+}", (c) => {
    const spec = c.req.param("spec");
    const [base, head] = spec.includes("...") ? spec.split("...") : [null, spec];
    const repo = repoFor(c);
    return c.json(history.compareRefs(ctx, repo, base || repo.default_branch, head));
  });

  // Which commit introduced each part of a file (by chunk, so exact): "rows 600 to 680 came from the re-survey".
  v1.get("/repos/:owner/:repo/blame/:ref/:path{.+}", (c) => c.json(blame.blameFile(ctx, repoFor(c), c.req.param("ref"), c.req.param("path"))));

  // What a file is and how it's stored: GeoTIFF tags, shapefile header, table shape, chunks, history.
  v1.get("/repos/:owner/:repo/file/:ref/:path{.+}", async (c) => c.json(await files.fileInfo(ctx, repoFor(c), c.req.param("ref"), c.req.param("path"))));

  // Previews drawn from the stored bytes: GeoTIFFs as hillshade PNGs, shapefiles as SVG. With
  // ?base=<ref>, the difference from that version (elevation change, or changed features).
  // Summary numbers ride along in X-Craton-Render so the page can show them without a second call.
  v1.get("/repos/:owner/:repo/render/:ref/:path{.+}", async (c) => {
    const repo = repoFor(c);
    const ref = c.req.param("ref"), path = c.req.param("path"), base = c.req.query("base");
    const size = Math.min(1024, Math.max(64, Number(c.req.query("size") ?? 512) || 512));
    // A preview is a pure function of the blobs it is drawn from, so that is its ETag: a client
    // that already holds it gets a 304 without anything being decoded or drawn. Pinned to full
    // commit ids it can never change at all; behind a branch name it can, after the next push.
    const pinned = (r: string) => /^[0-9a-f]{64}$/.test(r) && (() => { try { return history.resolveRef(ctx, repo, r) === r; } catch { return false; } })();
    const key = previews.previewKey(ctx, repo, ref, path, { base: base || undefined, size });
    const tag = key ? `"${createHash("sha256").update(key).digest("hex").slice(0, 32)}"` : null;
    const cache = { "cache-control": pinned(ref) && (!base || pinned(base)) ? "private, max-age=31536000, immutable" : "private, max-age=300", ...(tag ? { etag: tag } : {}) };
    if (tag && c.req.header("if-none-match")?.split(",").some((t) => t.trim().replace(/^W\//, "") === tag)) return c.body(null, 304, cache);
    try {
      if (/\.tiff?$/i.test(path)) {
        if (base) {
          const d = await previews.rasterDiff(ctx, repo, base, ref, path, size);
          return c.body(new Uint8Array(d.png), 200, { ...cache, "content-type": "image/png", "x-craton-render": JSON.stringify({ width: d.width, height: d.height, ...d.stats }) });
        }
        const t = await previews.rasterThumbnail(ctx, repo, ref, path, size);
        return c.body(new Uint8Array(t.png), 200, { ...cache, "content-type": "image/png", "x-craton-render": JSON.stringify({ width: t.width, height: t.height, min: t.min, max: t.max, sourceWidth: t.sourceWidth, sourceHeight: t.sourceHeight }) });
      }
      if (/\.shp$/i.test(path)) {
        const v = await previews.vectorSvg(ctx, repo, ref, path, base);
        return c.body(v.svg, 200, { ...cache, "content-type": "image/svg+xml", "x-craton-render": JSON.stringify({ features: v.features, diff: v.diff }) });
      }
    } catch (err) {
      if (previews.isUnsupported(err)) throw new ApiError(415, "no_preview", (err as Error).message);
      throw err;
    }
    throw new ApiError(415, "no_preview", "Previews are drawn for GeoTIFF rasters and shapefiles.");
  });

  // Numbers behind a raster change (?base=<ref>): summary of each version, a shared histogram and the
  // cell-by-cell change. Same sampled grids as the heatmap, cached by blob id.
  v1.get("/repos/:owner/:repo/raster-stats/:ref/:path{.+}", async (c) => {
    const repo = repoFor(c);
    const ref = c.req.param("ref"), path = c.req.param("path"), base = c.req.query("base");
    if (!base) throw badRequest("Say which version to compare against: ?base=<ref>.");
    if (!/\.tiff?$/i.test(path)) throw new ApiError(415, "no_stats", "Statistics are computed for GeoTIFF rasters.");
    const size = Math.min(1024, Math.max(64, Number(c.req.query("size") ?? 512) || 512));
    try {
      return c.json(await previews.rasterStats(ctx, repo, base, ref, path, size));
    } catch (err) {
      if (previews.isUnsupported(err)) throw new ApiError(415, "no_stats", (err as Error).message);
      throw err;
    }
  });

  // A line diff of a text file (a HEC-RAS plan or geometry file, an .inp, a README) between two versions (?base=<ref>).
  v1.get("/repos/:owner/:repo/text-diff/:ref/:path{.+}", async (c) => {
    const repo = repoFor(c);
    const base = c.req.query("base");
    if (!base) throw badRequest("Say which version to compare against: ?base=<ref>.");
    return c.json(await textdiff.textDiff(ctx, repo, base, c.req.param("ref"), c.req.param("path")));
  });

  // Row-by-row, cell-by-cell comparison of a CSV between two versions (?base=<ref>), matched by key.
  v1.get("/repos/:owner/:repo/table-diff/:ref/:path{.+}", async (c) => {
    const repo = repoFor(c);
    const ref = c.req.param("ref"), path = c.req.param("path"), base = c.req.query("base");
    if (!base) throw badRequest("Say which version to compare against: ?base=<ref>.");
    const key = tablediff.tableDiffKey(ctx, repo, base, ref, path);
    const tag = key ? `"${createHash("sha256").update(key).digest("hex").slice(0, 32)}"` : null;
    const cache = { "cache-control": "private, max-age=300", ...(tag ? { etag: tag } : {}) };
    if (tag && c.req.header("if-none-match")?.split(",").some((t) => t.trim().replace(/^W\//, "") === tag)) return c.body(null, 304, cache);
    const diff = await tablediff.tableDiff(ctx, repo, base, ref, path);
    for (const [k, v] of Object.entries(cache)) c.header(k, v);
    return c.json(diff);
  });

  // A status badge for README files: the default branch's latest check result. Public repositories only, so
  // a private repository's state is not readable by an anonymous image request.
  v1.get("/repos/:owner/:repo/badge/checks.svg", (c) => {
    const repo = repoFor(c);
    if (repo.visibility !== "public") throw notFound("Badge");
    const tip = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, repo.default_branch) as { commit_id: string } | undefined;
    const status = tip ? latestCheckStatus(ctx, repo, tip.commit_id) : null;
    return c.body(checksBadge(status), 200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" });
  });
  // The same for the latest release, the size and the licence. All public-only and cacheable.
  const svgHeaders = { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" };
  v1.get("/repos/:owner/:repo/badge/release.svg", (c) => {
    const repo = repoFor(c);
    if (repo.visibility !== "public") throw notFound("Badge");
    const latest = releases.listReleases(ctx, repo).find((r) => !r.prerelease);
    return c.body(releaseBadge(latest?.tag ?? null), 200, svgHeaders);
  });
  v1.get("/repos/:owner/:repo/badge/size.svg", (c) => {
    const repo = repoFor(c);
    if (repo.visibility !== "public") throw notFound("Badge");
    return c.body(sizeBadge(repos.repoJson(repo).sizeBytes), 200, svgHeaders);
  });
  v1.get("/repos/:owner/:repo/badge/license.svg", (c) => {
    const repo = repoFor(c);
    if (repo.visibility !== "public") throw notFound("Badge");
    return c.body(licenseBadge(repos.repoJson(repo).license || null), 200, svgHeaders);
  });
  v1.get("/repos/:owner/:repo/checks", (c) => c.json(listCheckRuns(ctx, repoFor(c), { limit: Number(c.req.query("limit") ?? 50) })));
  v1.get("/repos/:owner/:repo/storage", (c) => c.json(stats.storageStats(ctx, repoFor(c))));
  v1.get("/repos/:owner/:repo/audit", (c) => c.json(stats.auditPackage(ctx, repoFor(c))));

  // ── Issues and pull requests ─────────────────────────────────────────────
  v1.get("/repos/:owner/:repo/issues", (c) => c.json(collab.listIssues(ctx, repoFor(c), { state: c.req.query("state"), label: c.req.query("label") })));
  v1.post("/repos/:owner/:repo/issues", async (c) => {
    const user = requireUser(c);
    const input = await body<Parameters<typeof collab.createIssue>[3]>(c);
    // Anyone who can see the repository may open an issue; choosing its milestone is for writers.
    const repo = input.milestone ? repoFor(c, "write") : repoFor(c);
    const issue = collab.createIssue(ctx, repo, user.id, input);
    webhooks.emit(ctx, repo, "issue", { action: "opened", number: issue.number, title: issue.title, label: issue.label, author: user.handle });
    return c.json(issue, 201);
  });

  v1.get("/repos/:owner/:repo/templates", async (c) => {
    const repo = repoFor(c);
    return c.json({ issues: await templates.issueTemplates(ctx, repo), pull: await templates.pullTemplate(ctx, repo) });
  });

  // ── Collaborators (people invited to one repository) ─────────────────────
  v1.get("/user/shared", (c) => c.json(collaborators.sharedWith(ctx, requireUser(c).id)));
  v1.get("/repos/:owner/:repo/collaborators", (c) => c.json(collaborators.listCollaborators(ctx, repoFor(c, "write"))));
  v1.put("/repos/:owner/:repo/collaborators/:handle", async (c) => {
    const me = requireUser(c);
    accounts.requireVerified(me, "share a repository");
    const repo = repoFor(c, "admin");
    const b = await body<{ role?: string }>(c);
    const done = collaborators.setCollaborator(ctx, repo, { handle: c.req.param("handle"), role: b.role });
    if (done.added) {
      const to = ctx.db.prepare("SELECT u.email FROM users u JOIN owners o ON o.id = u.owner_id WHERE o.handle = ?").get(done.handle) as { email: string } | undefined;
      if (to && wantsEmail(ctx, to.email, "repo_access")) void email.sendRepoAccessEmail(to.email, `${repo.owner}/${repo.name}`, me.name || me.handle, done.role, `${config.webUrl}/${repo.owner}/${repo.name}`);
    }
    return c.json(done.collaborators, done.added ? 201 : 200);
  });
  // Invite by email address: someone without an account gets a one-time link; someone with one is added at once.
  v1.get("/repos/:owner/:repo/invites", (c) => c.json(invites.listInvites(ctx, repoFor(c, "admin"))));
  v1.post("/repos/:owner/:repo/invites", async (c) => {
    const me = requireUser(c);
    accounts.requireVerified(me, "invite people");
    limit(c, `invite:${me.id}`, { max: 20, windowMs: 60 * 60_000 }, "You have sent a lot of invitations this hour. Try again later.");
    const repo = repoFor(c, "admin");
    const b = await body<{ email?: string; role?: string }>(c);
    const known = invites.accountWithEmail(ctx, String(b.email ?? "").trim());
    if (known) {
      // They already have an account: share directly, exactly as inviting by handle does.
      const done = collaborators.setCollaborator(ctx, repo, { handle: known.handle, role: b.role });
      if (done.added) void email.sendRepoAccessEmail(String(b.email).trim(), `${repo.owner}/${repo.name}`, me.name || me.handle, done.role, `${config.webUrl}/${repo.owner}/${repo.name}`);
      return c.json({ added: true, handle: known.handle, role: done.role }, done.added ? 201 : 200);
    }
    const made = invites.createInvite(ctx, repo, me.id, b);
    void email.sendRepoInviteEmail(made.email, `${repo.owner}/${repo.name}`, me.name || me.handle, made.role, `${config.webUrl}/invite?token=${made.token}`);
    return c.json({ added: false, invite: { id: made.id, email: made.email, role: made.role, expiresAt: made.expiresAt } }, 201);
  });
  v1.delete("/repos/:owner/:repo/invites/:id", (c) => {
    invites.revokeInvite(ctx, repoFor(c, "admin"), Number(c.req.param("id")));
    return c.body(null, 204);
  });
  v1.get("/invites/:token", (c) => {
    limit(c, `invite-peek:${clientIp(c)}`, { max: 60, windowMs: 15 * 60_000 }, "Too many attempts from this network. Wait a few minutes.");
    return c.json(invites.previewInvite(ctx, c.req.param("token")));
  });
  v1.post("/invites/accept", async (c) => {
    const me = requireSession(c);
    limit(c, `invite-accept:${me.id}`, { max: 20, windowMs: 15 * 60_000 }, "Too many attempts. Wait a few minutes.");
    return c.json(invites.acceptInvite(ctx, (await body<{ token?: string }>(c)).token, me));
  });
  // Ask a specific person to review a pull request (and take the request back).
  v1.post("/repos/:owner/:repo/pulls/:number/review-requests", async (c) => {
    const me = requireUser(c);
    const repo = repoFor(c, "write");
    const b = await body<{ handle?: string }>(c);
    const done = collab.requestReview(ctx, repo, Number(c.req.param("number")), me.id, b.handle);
    const to = ctx.db.prepare("SELECT u.email FROM users u WHERE u.owner_id = ?").get(done.id) as { email: string } | undefined;
    if (to && wantsEmail(ctx, to.email, "review_requests")) void email.sendReviewRequestEmail(to.email, `${repo.owner}/${repo.name}`, Number(c.req.param("number")), done.pull.title, me.name || me.handle, `${config.webUrl}/${repo.owner}/${repo.name}/pull/${c.req.param("number")}`);
    return c.json(done.pull, 201);
  });
  v1.delete("/repos/:owner/:repo/pulls/:number/review-requests/:handle", (c) =>
    c.json(collab.withdrawReviewRequest(ctx, repoFor(c, "write"), Number(c.req.param("number")), c.req.param("handle"))),
  );
  v1.delete("/repos/:owner/:repo/collaborators/:handle", (c) => {
    const me = requireUser(c);
    const handle = c.req.param("handle").replace(/^@/, "").toLowerCase();
    if (handle === me.handle.toLowerCase()) {
      collaborators.leave(ctx, repoFor(c), me.id);
      return c.json([]);
    }
    return c.json(collaborators.removeCollaborator(ctx, repoFor(c, "admin"), handle));
  });

  // ── Milestones ───────────────────────────────────────────────────────────
  v1.get("/repos/:owner/:repo/milestones", (c) => c.json(milestones.listMilestones(ctx, repoFor(c))));
  v1.post("/repos/:owner/:repo/milestones", async (c) => {
    requireUser(c);
    return c.json(milestones.createMilestone(ctx, repoFor(c, "write"), await body(c)), 201);
  });
  v1.patch("/repos/:owner/:repo/milestones/:id", async (c) => {
    requireUser(c);
    return c.json(milestones.updateMilestone(ctx, repoFor(c, "write"), Number(c.req.param("id")), await body(c)));
  });
  v1.delete("/repos/:owner/:repo/milestones/:id", (c) => {
    requireUser(c);
    return c.json({ unassigned: milestones.deleteMilestone(ctx, repoFor(c, "write"), Number(c.req.param("id"))) });
  });
  // ── Model reviews: checklist, modelling log and sign-off pinned to one commit ─────────────────────
  v1.get("/model-review-template", (c) => c.json({ id: modelreview.TEMPLATE_ID, items: modelreview.TEMPLATE }));
  v1.get("/repos/:owner/:repo/model-reviews", (c) => c.json(modelreview.listReviews(ctx, repoFor(c))));
  v1.post("/repos/:owner/:repo/model-reviews", async (c) => {
    const user = requireUser(c);
    const b = await body<{ title?: string; ref?: string }>(c);
    return c.json(await modelreview.createReview(ctx, repoFor(c, "write"), user.id, b), 201);
  });
  v1.get("/repos/:owner/:repo/model-reviews/:n", (c) => c.json(modelreview.getReview(ctx, repoFor(c), Number(c.req.param("n")))));
  v1.put("/repos/:owner/:repo/model-reviews/:n/items/:key", async (c) => {
    const user = requireUser(c);
    const b = await body<{ status?: string; note?: string }>(c);
    return c.json(modelreview.setItem(ctx, repoFor(c, "write"), Number(c.req.param("n")), user.id, c.req.param("key"), b));
  });
  v1.post("/repos/:owner/:repo/model-reviews/:n/log", async (c) => {
    const user = requireUser(c);
    const b = await body<{ body?: string }>(c);
    return c.json(modelreview.addLog(ctx, repoFor(c, "write"), Number(c.req.param("n")), user.id, b.body), 201);
  });
  v1.post("/repos/:owner/:repo/model-reviews/:n/evidence", async (c) => {
    const user = requireUser(c);
    const b = await body<{ ref?: string }>(c);
    return c.json(await modelreview.refreshEvidence(ctx, repoFor(c, "write"), Number(c.req.param("n")), user.id, b));
  });
  v1.post("/repos/:owner/:repo/model-reviews/:n/submit", (c) => {
    const user = requireUser(c);
    return c.json(modelreview.submit(ctx, repoFor(c, "write"), Number(c.req.param("n")), user.id));
  });
  v1.post("/repos/:owner/:repo/model-reviews/:n/decision", async (c) => {
    const user = requireUser(c);
    const b = await body<{ decision?: string; comment?: string }>(c);
    return c.json(modelreview.decide(ctx, repoFor(c, "write"), Number(c.req.param("n")), user.id, b));
  });
  v1.post("/repos/:owner/:repo/model-reviews/:n/reopen", async (c) => {
    const user = requireUser(c);
    const b = await body<{ reason?: string }>(c);
    return c.json(modelreview.reopen(ctx, repoFor(c, "write"), Number(c.req.param("n")), user.id, b.reason));
  });
  v1.delete("/repos/:owner/:repo/model-reviews/:n", (c) => {
    requireUser(c);
    modelreview.deleteReview(ctx, repoFor(c, "admin"), Number(c.req.param("n")));
    return c.body(null, 204);
  });
  v1.get("/repos/:owner/:repo/model-reviews/:n/export", (c) => {
    const repo = repoFor(c);
    const n = Number(c.req.param("n"));
    const headers: Record<string, string> = { "content-type": "text/markdown; charset=utf-8" };
    if (c.req.query("download") === "1") headers["content-disposition"] = `attachment; filename="model-review-${n}.md"`;
    return c.body(modelreview.exportMarkdown(ctx, repo, n), 200, headers);
  });

  v1.get("/repos/:owner/:repo/issues/:n", (c) => {
    const repo = repoFor(c);
    const n = Number(c.req.param("n"));
    return c.json({ ...collab.getIssue(ctx, repo, n), thread: collab.listComments(ctx, repo, "issue", n) });
  });
  v1.patch("/repos/:owner/:repo/issues/:n", async (c) => {
    const user = requireUser(c);
    const repo = repoFor(c, "write");
    const n = Number(c.req.param("n"));
    const before = collab.getIssue(ctx, repo, n).state;
    const updated = collab.updateIssue(ctx, repo, n, await body(c));
    // Opening and closing are what a receiver cares about; edits to the text or the label are not events.
    if (updated.state !== before) webhooks.emit(ctx, repo, "issue", { action: updated.state === "closed" ? "closed" : "reopened", number: updated.number, title: updated.title, label: updated.label, by: user.handle });
    return c.json(updated);
  });
  v1.post("/repos/:owner/:repo/issues/:n/comments", async (c) => {
    const b = await body<{ body: string }>(c);
    return c.json(collab.addComment(ctx, repoFor(c), "issue", Number(c.req.param("n")), requireUser(c).id, b.body), 201);
  });

  v1.get("/repos/:owner/:repo/pulls", (c) => c.json(collab.listPulls(ctx, repoFor(c), { state: c.req.query("state") })));
  v1.post("/repos/:owner/:repo/pulls", async (c) => {
    const repo = repoFor(c, "write");
    const me = requireUser(c);
    const created = collab.createPull(ctx, repo, me.id, await body(c));
    webhooks.emit(ctx, repo, "pull_request", { action: "opened", number: created.number, title: created.title, source: created.source, target: created.target, author: me.handle });
    // The people named in CODEOWNERS for the files this changes are asked to review, and told the way any request is.
    const asked = await codeOwners.requestOwnerReviews(ctx, repo, created.number, me.id);
    for (const handle of asked) {
      const to = ctx.db.prepare("SELECT u.email FROM users u JOIN owners o ON o.id = u.owner_id WHERE o.handle = ?").get(handle) as { email: string } | undefined;
      if (to && wantsEmail(ctx, to.email, "review_requests")) void email.sendReviewRequestEmail(to.email, `${repo.owner}/${repo.name}`, created.number, created.title, me.name || me.handle, `${config.webUrl}/${repo.owner}/${repo.name}/pull/${created.number}`);
    }
    return c.json({ ...collab.getPull(ctx, repo, created.number), ownersAsked: asked }, 201);
  });
  // What a CODEOWNERS text would do against the repository's files (nothing is saved).
  v1.post("/repos/:owner/:repo/owners/preview", async (c) => {
    const repo = repoFor(c, "write");
    const b = await body<{ text?: string; ref?: string }>(c);
    if (typeof b.text !== "string" || b.text.length > 64 * 1024) throw badRequest("Send the CODEOWNERS text (up to 64 KB) as `text`.");
    return c.json(codeOwners.previewOwners(ctx, repo, b.text, b.ref));
  });
  // Who owns the files a pull request changes (from CODEOWNERS on its target branch) and where each of them stands.
  v1.get("/repos/:owner/:repo/pulls/:n/owners", async (c) => c.json(await codeOwners.ownersOfPull(ctx, repoFor(c), Number(c.req.param("n")))));
  v1.get("/repos/:owner/:repo/pulls/:n", (c) => {
    const repo = repoFor(c);
    const n = Number(c.req.param("n"));
    return c.json({ ...collab.getPull(ctx, repo, n), thread: collab.listComments(ctx, repo, "pull", n) });
  });
  v1.post("/repos/:owner/:repo/pulls/:n/comments", async (c) => {
    const b = await body<{ body: string }>(c);
    return c.json(collab.addComment(ctx, repoFor(c), "pull", Number(c.req.param("n")), requireUser(c).id, b.body), 201);
  });
  v1.post("/repos/:owner/:repo/pulls/:n/reviews", async (c) => c.json(collab.reviewPull(ctx, repoFor(c, "write"), Number(c.req.param("n")), requireUser(c).id, await body(c))));
  v1.post("/repos/:owner/:repo/pulls/:n/merge", async (c) => {
    const repo = repoFor(c, "write");
    const n = Number(c.req.param("n"));
    const pull = await collab.mergePull(ctx, repo, n, requireUser(c).handle);
    if (pull.target === repo.default_branch) setImmediate(() => void extent.refreshFootprint(ctx, repo));
    webhooks.emit(ctx, repo, "pull_request", { action: "merged", number: n, title: pull.title, source: pull.source, target: pull.target, mergedBy: requireUser(c).handle });
    return c.json(pull);
  });
  v1.post("/repos/:owner/:repo/pulls/:n/close", (c) => {
    requireUser(c);
    const repo = repoFor(c, "write");
    const n = Number(c.req.param("n"));
    const pull = collab.closePull(ctx, repo, n);
    webhooks.emit(ctx, repo, "pull_request", { action: "closed", number: n, title: pull.title, source: pull.source, target: pull.target, closedBy: requireUser(c).handle });
    return c.json(pull);
  });

  // ── Releases ─────────────────────────────────────────────────────────────
  v1.get("/repos/:owner/:repo/releases", (c) => c.json(releases.listReleases(ctx, repoFor(c))));
  v1.post("/repos/:owner/:repo/releases", async (c) => {
    const repo = repoFor(c, "write");
    const rel = await releases.createRelease(ctx, repo, requireUser(c).id, await body(c));
    webhooks.emit(ctx, repo, "release", { tag: rel.tag, title: rel.title, prerelease: rel.prerelease, commit: rel.commit, merkleRoot: rel.merkleRoot, author: requireUser(c).handle });
    return c.json(rel, 201);
  });
  // The release as a STAC Collection and its files as Items (https://stacspec.org), for catalogues and GIS tools.
  v1.get("/repos/:owner/:repo/releases/:tag/stac/:part{collection\.json|items\.json}", async (c) => {
    const repo = repoFor(c);
    const rel = releases.listReleases(ctx, repo).find((r) => r.tag === c.req.param("tag"));
    if (!rel) throw notFound(`Release ${c.req.param("tag")}`);
    const stac = await buildStac(ctx, repo, rel, new URL(c.req.url).origin);
    return c.body(JSON.stringify(c.req.param("part") === "collection.json" ? stac.collection : stac.items, null, 2), 200, { "content-type": "application/json; charset=utf-8" });
  });
  v1.get("/repos/:owner/:repo/releases/:tag/SHA256SUMS", (c) => {
    const rel = releases.listReleases(ctx, repoFor(c)).find((r) => r.tag === c.req.param("tag"));
    if (!rel) throw new ApiError(404, "not_found", "Release not found");
    return c.text(releases.checksumFile(rel));
  });

  v1.get("/search", (c) => c.json(stats.search(ctx, userId(c), c.req.query("q") ?? "")));

  // ── Across repositories ──────────────────────────────────────────────────
  // Everything below only covers repositories the caller can read.
  v1.get("/activity", (c) => c.json(listActivity(ctx, userId(c), { actor: c.req.query("actor"), limit: Number(c.req.query("limit") ?? 30) })));
  v1.get("/repos/:owner/:repo/activity", (c) => c.json(listActivity(ctx, userId(c), { repo: repoFor(c), limit: Number(c.req.query("limit") ?? 30) })));
  v1.get("/issues", (c) =>
    c.json(repos.listRepos(ctx, userId(c)).flatMap((r) => collab.listIssues(ctx, r, { state: c.req.query("state") }).map((i) => ({ ...i, repo: `${r.owner}/${r.name}` })))),
  );
  v1.get("/pulls", (c) =>
    c.json(repos.listRepos(ctx, userId(c)).flatMap((r) => collab.listPulls(ctx, r, { state: c.req.query("state") }).map((p) => ({ ...p, repo: `${r.owner}/${r.name}` })))),
  );

  // The API described by its own route table, so the document can't drift from the code.
  v1.get("/openapi.json", (c) => c.json(buildOpenApi(v1.routes.map((r) => ({ method: r.method, path: r.path })), { version: "1", server: new URL(c.req.url).origin })));

  app.route("/v1", v1);
  return app;
}

/** "Chrome on Windows (203.0.113.7)" from a user agent, for sign-in alerts. */
function describeDevice(ua: string | null, ip: string | null) {
  const browser = ua ? (/Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : /craton-cli|node/i.test(ua) ? "the Craton CLI" : "a browser") : "an unknown device";
  const os = ua ? (/Windows/.test(ua) ? " on Windows" : /Mac OS X/.test(ua) ? " on macOS" : /Android/.test(ua) ? " on Android" : /iPhone|iPad/.test(ua) ? " on iOS" : /Linux/.test(ua) ? " on Linux" : "") : "";
  return `${browser}${os}${ip && ip !== "local" ? ` (${ip})` : ""}`;
}
