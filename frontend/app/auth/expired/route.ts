// A session cookie the API no longer accepts (expired, revoked, or the server was reset):
// drop it and send the person to sign in again, back to where they were going.

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session";

export function GET(request: Request) {
  const from = new URL(request.url).searchParams.get("next");
  const url = new URL("/login", request.url);
  url.searchParams.set("expired", "1");
  if (from && from.startsWith("/") && !from.startsWith("//")) url.searchParams.set("next", from);
  const res = NextResponse.redirect(url);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
