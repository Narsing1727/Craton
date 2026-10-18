// Step 1 of "Continue with single sign-on": the person's work email says which organization's provider to use. The API
// answers with the provider's address and a one-time state; the state goes in a cookie so only this browser can finish.

import { NextResponse } from "next/server";
import { send } from "@/lib/api";
import { redirectUrl } from "@/lib/origin";
import { OAUTH_STATE_COOKIE, shortCookie } from "@/lib/session";

export async function GET(request: Request) {
  const here = new URL(request.url);
  const email = (here.searchParams.get("email") ?? "").trim();
  const next = here.searchParams.get("next") ?? undefined;
  const back = (why: string) => NextResponse.redirect(redirectUrl(request, `/login/sso?error=${why}${email ? `&email=${encodeURIComponent(email)}` : ""}${next ? `&next=${encodeURIComponent(next)}` : ""}`));
  const started = await send<{ url: string; state: string; protocol?: string }>("POST", "/auth/sso/start", { email, next }, null);
  if (!started.ok) return back(started.code === "sso_not_configured" ? "none" : started.offline ? "offline" : /email/i.test(started.error) ? "email" : "error");
  const res = NextResponse.redirect(started.data.url);
  if (started.data.protocol === "saml") {
    // The provider's answer arrives as a cross-site POST, which a SameSite=Lax cookie does not travel on: in production (https) this
    // one is SameSite=None so the answer can be tied to this browser.
    res.cookies.set(OAUTH_STATE_COOKIE, `in.${started.data.state}`, { ...shortCookie("/auth/saml", 600), sameSite: process.env.NODE_ENV === "production" ? ("none" as const) : ("lax" as const) });
  } else res.cookies.set(OAUTH_STATE_COOKIE, `in.${started.data.state}`, shortCookie("/auth/sso", 600));
  return res;
}
