// "Continue with Google" and "Continue with GitHub" share one flow; these are its two browser-facing steps. The route files
// of each provider are one line each, so the two can never drift apart.

import { NextResponse } from "next/server";
import { fetchUser, send } from "@/lib/api";
import { redirectUrl } from "@/lib/origin";
import { getSessionToken, GOOGLE_PENDING_COOKIE, MFA_COOKIE, OAUTH_STATE_COOKIE, SESSION_COOKIE, sessionCookieOptions, shortCookie } from "@/lib/session";

import type { OAuthProvider } from "@/lib/oauth-routes-shared";

type Answer = { token?: string; mfaRequired?: boolean; ticket?: string; needsUsername?: boolean; linked?: boolean; next?: string | null };

/** Only same-site paths survive. */
const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : null);

/**
 * Step 1: ask the API for a one-time state, remember it in a cookie so the answer can only complete in this browser, and
 * send the browser to the provider. `?link=1` (signed in) adds the provider to the account instead.
 */
export async function startRoute(request: Request, provider: OAuthProvider) {
  const here = new URL(request.url);
  const link = here.searchParams.get("link") === "1";
  const next = here.searchParams.get("next");
  const token = link ? await getSessionToken() : null;
  if (link && !token) return NextResponse.redirect(redirectUrl(request, "/login?next=/settings/security"));

  const started = await send<{ url: string; state: string }>("POST", `/auth/${provider}/start`, { next: next ?? undefined, link }, token);
  if (!started.ok) {
    const why = started.code === "not_configured" ? "off" : started.offline ? "offline" : "error";
    return NextResponse.redirect(redirectUrl(request, link ? `/settings/security?${provider}=${why}` : `/login?${provider}=${why}`));
  }
  const res = NextResponse.redirect(started.data.url);
  res.cookies.set(OAUTH_STATE_COOKIE, `${link ? "link" : "in"}.${started.data.state}`, shortCookie(`/auth/${provider}`, 600));
  return res;
}

/**
 * Step 2: the provider sent the browser back here with a code. The state must match the cookie from step 1; then the API
 * does the rest (code exchange, identity checks) and answers with what to do next.
 */
export async function callbackRoute(request: Request, provider: OAuthProvider) {
  const here = new URL(request.url);
  const to = (path: string) => {
    const res = NextResponse.redirect(redirectUrl(request, path));
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: `/auth/${provider}` });
    return res;
  };
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))?.slice(OAUTH_STATE_COOKIE.length + 1) ?? "";
  const dot = cookie.indexOf(".");
  const mode = cookie.slice(0, dot);
  const expected = cookie.slice(dot + 1);
  const code = here.searchParams.get("code");
  const state = here.searchParams.get("state");
  const back = mode === "link" ? "/settings/security" : "/login";

  if (here.searchParams.get("error")) return to(`${back}?${provider}=denied`);
  if (!code || !state || dot < 0 || !expected || expected !== state) return to(`${back}?${provider}=expired`);

  const result = await send<Answer>("POST", `/auth/${provider}/callback`, { code, state }, mode === "link" ? await getSessionToken() : null);
  if (!result.ok) {
    const why = result.code === "email_unverified_account" ? "unverified" : result.code === "identity_taken" ? "taken" : result.code === "email_not_verified" ? "noemail" : result.offline ? "offline" : "error";
    return to(`${back}?${provider}=${why}`);
  }
  const a = result.data;
  if (a.linked) return to(`/settings/security?${provider}=linked`);
  const next = safeNext(a.next);
  const keep = next ? `&next=${encodeURIComponent(next)}` : "";

  if (a.mfaRequired && a.ticket) {
    const res = to(`/login?mfa=1${keep}`);
    res.cookies.set(MFA_COOKIE, a.ticket, shortCookie("/", 300));
    return res;
  }
  if (a.needsUsername && a.ticket) {
    const res = to(`/signup/${provider}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    res.cookies.set(GOOGLE_PENDING_COOKIE, a.ticket, shortCookie("/", 900));
    return res;
  }
  if (a.token) {
    const me = await fetchUser(a.token);
    const res = to(me?.onboardedAt ? (next ?? "/dashboard") : "/onboarding");
    res.cookies.set(SESSION_COOKIE, a.token, sessionCookieOptions);
    return res;
  }
  return to(`${back}?${provider}=error`);
}
