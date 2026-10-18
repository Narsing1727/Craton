import type { Metadata } from "next";
import Link from "next/link";
import { AUTH, AuthShell, AuthTitle } from "@/components/auth-shell";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell action={{ label: "Sign in", href: "/login" }}>
      <AuthTitle title="Choose a new password" subtitle={token ? "Then you’re signed straight back in." : "This link is missing its code."} />
      {token ? (
        <ResetForm token={token} />
      ) : (
        <p className="text-[14px]">
          <Link href="/forgot-password" className={AUTH.link}>
            Request a new reset link
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
