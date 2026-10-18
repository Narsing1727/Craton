import type { Metadata } from "next";
import { AuthShell, AuthTitle } from "@/components/auth-shell";
import { SsoEmailForm } from "@/components/sso-email-form";

export const metadata: Metadata = { title: "Single sign-on", description: "Sign in with your organization’s identity provider." };

const MESSAGES: Record<string, string> = {
  none: "No organization has single sign-on for that address. Check it, or sign in another way.",
  email: "Enter your work email address.",
  offline: "The Craton API isn’t reachable right now. Try again in a moment.",
  error: "Couldn’t start single sign-on. Try again in a moment.",
};

export default async function SsoLoginPage({ searchParams }: { searchParams: Promise<{ error?: string; email?: string; next?: string }> }) {
  const { error, email, next } = await searchParams;
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return (
    <AuthShell action={{ label: "Sign in", href: "/login" }}>
      <AuthTitle title="Single sign-on" subtitle="Enter your work email. If your organization uses single sign-on, you’ll be sent to its sign-in page." />
      <SsoEmailForm email={email} next={safeNext} message={error ? MESSAGES[error] : undefined} />
    </AuthShell>
  );
}
