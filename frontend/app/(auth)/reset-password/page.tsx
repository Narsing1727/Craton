import type { Metadata } from "next";
import Link from "next/link";
import { CratonLogo } from "@/components/craton-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Craton home">
        <CratonLogo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            <h1>Choose a new password</h1>
          </CardTitle>
          <CardDescription>{token ? "Then you're signed straight back in." : "This link is missing its code."}</CardDescription>
        </CardHeader>
        <CardContent>
          {token ? (
            <ResetForm token={token} />
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              <Link href="/forgot-password" className="text-accent underline underline-offset-2">
                Request a new reset link
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
