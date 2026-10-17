import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AuthForm } from "@/components/auth-form";
import { api } from "@/lib/api";
import { MFA_COOKIE } from "@/lib/session";
import { providerNotice } from "@/lib/oauth-routes-shared";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to Craton." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string; reset?: string; google?: string; github?: string; mfa?: string }> }) {
  const params = await searchParams;
  const notice =
    providerNotice("google", params.google, "signin") ??
    providerNotice("github", params.github, "signin") ??
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
  return <AuthForm mode="login" next={params.next} notice={notice} demoHint={process.env.NODE_ENV !== "production"} google={Boolean(providers?.google)} github={Boolean(providers?.github)} passkeys={Boolean(providers?.passkeys)} initialMfaTicket={initialMfaTicket} />;
}
