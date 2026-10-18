import type { Metadata } from "next";
import Link from "next/link";
import { AUTH, AuthShell, AuthTitle } from "@/components/auth-shell";
import { VerifyButton } from "./verify-button";

export const metadata: Metadata = { title: "Confirm your email" };

// Confirmation needs a click (a POST), not just opening the link: mail scanners open links too,
// and would otherwise use the code up before the person does.
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell>
      <AuthTitle title="Confirm your email" subtitle={token ? "One click and you can publish public data and invite people." : "This link is missing its code."} />
      {token ? (
        <VerifyButton token={token} />
      ) : (
        <p className="text-[14px] leading-relaxed text-foreground/50">
          Open the link from your email again, or send a new one from{" "}
          <Link href="/settings/security" className={AUTH.link}>
            Settings → Security
          </Link>
          .
        </p>
      )}
    </AuthShell>
  );
}
