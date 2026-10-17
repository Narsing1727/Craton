// The signed-in user's session: an httpOnly cookie holding the API session token.
// Set by the auth server actions (app/auth-actions.ts), read by lib/api.ts on the server,
// and never visible to browser JavaScript.

import { unstable_rethrow } from "next/navigation";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "craton_session";
/** Matches the API's 30-day session lifetime. */
export const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

export async function getSessionToken(): Promise<string | null> {
  try {
    return (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  } catch (err) {
    unstable_rethrow(err); // let Next.js see dynamic-rendering signals (cookies, no-store) instead of swallowing them
    // Outside a request (build time): nobody is signed in.
    return null;
  }
}

export async function setSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Binds a Google sign-in to the browser that started it: "<in|link>.<state>", checked when Google sends the browser back. */
export const OAUTH_STATE_COOKIE = "craton_oauth_state";
/** The two-step ticket after Google said who it is, read by the sign-in page for the code step (five minutes, like the ticket). */
export const MFA_COOKIE = "craton_mfa_ticket";
/** The ticket for "choose a username" after a first Google sign-in (fifteen minutes, like the API's). */
export const GOOGLE_PENDING_COOKIE = "craton_google_pending";

/** Options for a short-lived httpOnly cookie that only this site's own pages read. */
export function shortCookie(path: string, maxAge: number) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path, maxAge };
}

/** Session cookie options, for route handlers that set it on a redirect response. */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE,
};
