import type { Metadata } from "next";
import Link from "next/link";
import { CratonLogo } from "@/components/craton-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = { title: "Stop the weekly email", robots: { index: false, follow: false } };

/**
 * The link in every weekly summary. It does nothing on its own (mail scanners open links): the person presses a button, and
 * that call carries the signed token from the link, so no sign-in is needed.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Craton home">
        <CratonLogo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            <h1>Stop the weekly email?</h1>
          </CardTitle>
          <CardDescription>You can turn it back on any time in Settings → Profile.</CardDescription>
        </CardHeader>
        <CardContent>{token ? <UnsubscribeButton token={token} /> : <p className="text-sm text-muted-foreground">This link is incomplete. Turn the weekly email off in Settings → Profile.</p>}</CardContent>
      </Card>
    </main>
  );
}
