// SAML, step 2: the organization's identity provider posts its signed answer here (the address given to it as the "ACS URL").
// The API checks everything (signature, audience, times, that it answers a request we made); this only carries the answer
// over and turns the outcome into a redirect. In production the browser's own cookie from step 1 must also match the relay
// state, so an answer someone else started cannot be fed to this browser; the cookie travels on this cross-site POST only
// because it was set with SameSite=None (see app/auth/sso/route.ts), which a plain-http development server cannot do.

import { NextResponse } from "next/server";
import { send } from "@/lib/api";
import { answerResponse } from "@/lib/oauth-routes";
import { redirectUrl } from "@/lib/origin";
import { OAUTH_STATE_COOKIE } from "@/lib/session";

type Answer = { token?: string; mfaRequired?: boolean; ticket?: string; needsUsername?: boolean; next?: string | null };

export async function POST(request: Request) {
  const to = (path: string) => {
    // 303: whatever the identity provider posted, the browser now asks for a page with GET.
    const res = NextResponse.redirect(redirectUrl(request, path), 303);
    res.cookies.delete({ name: OAUTH_STATE_COOKIE, path: "/auth/saml" });
    return res;
  };
  const form = await request.formData().catch(() => null);
  const samlResponse = String(form?.get("SAMLResponse") ?? "");
  const relayState = String(form?.get("RelayState") ?? "");
  if (!samlResponse || !relayState) return to("/login?sso=expired");

  if (process.env.NODE_ENV === "production") {
    const cookie = request.headers.get("cookie")?.split(/;\s*/).find((c) => c.startsWith(`${OAUTH_STATE_COOKIE}=`))?.slice(OAUTH_STATE_COOKIE.length + 1) ?? "";
    if (cookie !== `in.${relayState}`) return to("/login?sso=expired");
  }

  const result = await send<Answer>("POST", "/auth/saml/acs", { samlResponse, relayState }, null);
  if (!result.ok) {
    const why = result.code === "email_unverified_account" ? "unverified" : result.code === "domain_not_verified" ? "domain" : result.code === "no_email" ? "noemail" : result.offline ? "offline" : "error";
    return to(`/login?sso=${why}`);
  }
  return answerResponse(to, "sso", result.data, "/login");
}
