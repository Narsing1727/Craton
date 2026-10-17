import type { Metadata } from "next";
import Link from "next/link";
import { CratonLogo } from "@/components/craton-logo";
import { SsoEmailForm } from "@/components/sso-email-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    <main id="main" className="relative flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Craton home">
        <CratonLogo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            <h1>Single sign-on</h1>
          </CardTitle>
          <CardDescription>Enter your work email. If your organization uses single sign-on, you’ll be sent to its sign-in page.</CardDescription>
        </CardHeader>
        <CardContent>
          <SsoEmailForm email={email} next={safeNext} message={error ? MESSAGES[error] : undefined} />
        </CardContent>
      </Card>
    </main>
  );
}
