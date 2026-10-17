import type { Metadata } from "next";
import Link from "next/link";
import { CratonLogo } from "@/components/craton-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerifyButton } from "./verify-button";

export const metadata: Metadata = { title: "Confirm your email" };

// Confirmation needs a click (a POST), not just opening the link: mail scanners open links too,
// and would otherwise use the code up before the person does.
export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Craton home">
        <CratonLogo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            <h1>Confirm your email</h1>
          </CardTitle>
          <CardDescription>{token ? "One click and you can publish public data and invite people." : "This link is missing its code."}</CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <VerifyButton token={token} />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Open the link from your email again, or send a new one from{" "}
              <Link href="/settings/security" className="text-accent underline underline-offset-2">
                Settings → Security
              </Link>
              .
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
