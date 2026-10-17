// Step 2: Google sent the browser back here with a code. The state must match the cookie from step 1; then the API does
// the rest (code exchange, ID token checks) and answers with what to do next.

import { NextResponse } from "next/server";
import { fetchUser, send } from "@/lib/api";
import { redirectUrl } from "@/lib/origin";
import { getSessionToken, GOOGLE_PENDING_COOKIE, MFA_COOKIE, OAUTH_STATE_COOKIE, SESSION_COOKIE, sessionCookieOptions, shortCookie } from "@/lib/session";

type Answer = { token?: string; mfaRequired?: boolean; ticket?: string; needsUsername?: boolean; linked?: boolean; next?: string | null };

/** Only same-site paths survive. */
const safeNext = (next: string | null | undefined) => (next && next.startsWith("/") && !next.startsWith("//") ? next : null);

export async function GET(request: Request) {
  const here = new URL(request.url);
  const to = (path: string) => {
    const res = NextResponse.redirect(redirectUrl(request, path));
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/auth/google" });
    return res;
  };
  const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))?.slice(OAUTH_STATE_COOKIE.length + 1) ?? "";
  const dot = cookie.indexOf(".");
  const mode = cookie.slice(0, dot);
  const expected = cookie.slice(dot + 1);
  const code = here.searchParams.get("code");
  const state = here.searchParams.get("state");
  const back = mode === "link" ? "/settings/security" : "/login";

  if (here.searchParams.get("error")) return to(`${back}?google=denied`);
  if (!code || !state || dot < 0 || !expected || expected !== state) return to(`${back}?google=expired`);

  const result = await send<Answer>("POST", "/auth/google/callback", { code, state }, mode === "link" ? await getSessionToken() : null);
  if (!result.ok) {
    const why = result.code === "email_unverified_account" ? "unverified" : result.code === "identity_taken" ? "taken" : result.offline ? "offline" : "error";
    return to(`${back}?google=${why}`);
  }
  const a = result.data;
  if (a.linked) return to("/settings/security?google=linked");
  const next = safeNext(a.next);
  const keep = next ? `&next=${encodeURIComponent(next)}` : "";

  if (a.mfaRequired && a.ticket) {
    const res = to(`/login?mfa=1${keep}`);
    res.cookies.set(MFA_COOKIE, a.ticket, shortCookie("/", 300));
    return res;
  }
  if (a.needsUsername && a.ticket) {
    const res = to(`/signup/google${next ? `?next=${encodeURIComponent(next)}` : ""}`);
    res.cookies.set(GOOGLE_PENDING_COOKIE, a.ticket, shortCookie("/", 900));
    return res;
  }
  if (a.token) {
    const me = await fetchUser(a.token);
    const res = to(me?.onboardedAt ? (next ?? "/dashboard") : "/onboarding");
    res.cookies.set(SESSION_COOKIE, a.token, sessionCookieOptions);
    return res;
  }
  return to(`${back}?google=error`);
}
