import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AuthForm } from "@/components/auth-form";
import { api } from "@/lib/api";
import { MFA_COOKIE } from "@/lib/session";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to Craton." };

/** What each ?google= answer from the Google sign-in means, in words. */
const GOOGLE_NOTICE: Record<string, string> = {
  denied: "Google sign-in was cancelled. You can try again, or sign in with your password.",
  expired: "That Google sign-in expired or came from another browser. Try again.",
  unverified: "An account with that email exists, but its address was never confirmed. Confirm it from the email we sent (or reset the password), then use Google again.",
  error: "Couldn’t sign in with Google. Try again in a moment.",
  offline: "The Craton API isn’t reachable right now. Your data is safe; try again in a moment.",
  off: "Google sign-in isn’t set up on this server.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string; reset?: string; google?: string; mfa?: string }> }) {
  const params = await searchParams;
  const notice =
    (params.google ? GOOGLE_NOTICE[params.google] : undefined) ??
    (params.reset
      ? "Your password was changed. Sign in with the new one."
      : params.expired
        ? "Your session ended. Sign in again to continue."
        : params.next
          ? "Sign in to continue."
          : undefined);
  const [providers, jar] = await Promise.all([api.providers(), cookies()]);
  // Google said who it is and the account has two-step verification: the code is the only step left.
  const initialMfaTicket = params.mfa ? jar.get(MFA_COOKIE)?.value : undefined;
  return <AuthForm mode="login" next={params.next} notice={notice} demoHint={process.env.NODE_ENV !== "production"} google={Boolean(providers?.google)} passkeys={Boolean(providers?.passkeys)} initialMfaTicket={initialMfaTicket} />;
}
