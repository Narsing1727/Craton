// Routing by session, before anything renders:
// - signed-out visitors on app pages go to sign-in, then back where they were (?next=);
// - signed-in people skip the marketing home and the auth pages.
// Public data (explore, repositories, profiles, docs) stays open to everyone, like GitHub.
// This only checks that a session cookie exists; the API decides whether it's valid.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prefersMarkdown } from "@/lib/negotiate";
import { TWIN_PAGES } from "@/lib/llms";

const SESSION_COOKIE = "craton_session";
const APP_ONLY = ["/dashboard", "/issues", "/pulls", "/new", "/settings", "/orgs/new", "/onboarding", "/stars"];
const GUEST_ONLY = ["/", "/login", "/signup"];

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const signedIn = Boolean(request.cookies.get(SESSION_COOKIE)?.value);
  const isApp =
    APP_ONLY.some((p) => pathname === p || (p === "/settings" && pathname.startsWith("/settings/"))) ||
    /^\/orgs\/[^/]+\/settings$/.test(pathname); // organization settings

  // A tool that asks for Markdown gets the page's Markdown version from the page's own address.
  if (TWIN_PAGES.some((p) => p.path === pathname) && prefersMarkdown(request.headers.get("accept"))) {
    const url = request.nextUrl.clone();
    url.pathname = `${pathname}.md`;
    return NextResponse.rewrite(url);
  }
  if (!signedIn && isApp) {
    const url = new URL("/login", request.url);
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (signedIn && GUEST_ONLY.includes(pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/signup", "/dashboard", "/issues", "/pulls", "/new", "/settings/:path*", "/orgs/new", "/orgs/:org/settings", "/onboarding", "/stars", "/docs", "/api-reference", "/cli", "/pricing", "/security", "/about", "/changelog", "/help"], // the last eight: lib/llms.ts TWIN_PAGES (a matcher has to be written out)
};
