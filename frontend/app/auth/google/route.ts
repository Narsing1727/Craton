// Step 1 of "Continue with Google": ask the API for a one-time state, remember it in a cookie so the answer can only
// complete in this browser, and send the browser to Google. `?link=1` (signed in) adds Google to the account instead.

import { NextResponse } from "next/server";
import { send } from "@/lib/api";
import { redirectUrl } from "@/lib/origin";
import { getSessionToken, OAUTH_STATE_COOKIE, shortCookie } from "@/lib/session";

export async function GET(request: Request) {
  const here = new URL(request.url);
  const link = here.searchParams.get("link") === "1";
  const next = here.searchParams.get("next");
  const token = link ? await getSessionToken() : null;
  if (link && !token) return NextResponse.redirect(redirectUrl(request, "/login?next=/settings/security"));

  const started = await send<{ url: string; state: string }>("POST", "/auth/google/start", { next: next ?? undefined, link }, token);
  if (!started.ok) {
    const why = started.code === "not_configured" ? "off" : started.offline ? "offline" : "error";
    return NextResponse.redirect(redirectUrl(request, link ? `/settings/security?google=${why}` : `/login?google=${why}`));
  }
  const res = NextResponse.redirect(started.data.url);
  res.cookies.set(OAUTH_STATE_COOKIE, `${link ? "link" : "in"}.${started.data.state}`, shortCookie("/auth/google", 600));
  return res;
}
