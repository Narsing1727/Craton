import type { Metadata } from "next";
import { cookies } from "next/headers";
import { AuthForm } from "@/components/auth-form";
import { api } from "@/lib/api";
import { MFA_COOKIE } from "@/lib/session";
import { providerNotice } from "@/lib/oauth-routes-shared";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to Craton." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string; reset?: string; google?: string; github?: string; sso?: string; mfa?: string }> }) {
  const params = await searchParams;
  const notice =
    providerNotice("google", params.google, "signin") ??
    providerNotice("github", params.github, "signin") ??
    providerNotice("sso", params.sso, "signin") ??
    (params.reset
      ? "Your password was changed. Sign in with the new one."
      : params.expired
        ? "Your session ended. Sign in again to continue."
        : params.next
          ? "Sign in to continue."
          : undefined);
  const [providers, jar] = await Promise.all([api.providers(), cookies()]);
  // On a development machine the buttons are shown even without credentials, so they can be seen; production shows only what works.
  const dev = process.env.NODE_ENV !== "production";
  const notSetUp = dev && providers ? [...(providers.google ? [] : ["Google"]), ...(providers.github ? [] : ["GitHub"])] : [];
  // Google said who it is and the account has two-step verification: the code is the only step left.
  const initialMfaTicket = params.mfa ? jar.get(MFA_COOKIE)?.value : undefined;
  return <AuthForm mode="login" next={params.next} notice={notice} google={Boolean(providers?.google) || dev} github={Boolean(providers?.github) || dev} notSetUp={notSetUp} sso={Boolean(providers?.sso)} passkeys={Boolean(providers?.passkeys)} initialMfaTicket={initialMfaTicket} />;
}
