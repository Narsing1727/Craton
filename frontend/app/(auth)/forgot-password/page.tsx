"use client";

import { useActionState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { CratonLogo } from "@/components/craton-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { forgotPasswordAction, type FormResult } from "@/app/auth-actions";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(forgotPasswordAction, null);
  const sentTo = state?.ok ? state.message : null;

  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-12">
      <Link href="/" className="mb-8" aria-label="Craton home">
        <CratonLogo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        {sentTo ? (
          <CardHeader className="items-center text-center">
            <MailCheck className="mx-auto size-8 text-chart-1" aria-hidden />
            <CardTitle className="font-serif text-2xl">
              <h1>Check your email</h1>
            </CardTitle>
            <CardDescription className="text-pretty">
              If an account exists for <span className="text-foreground">{sentTo}</span>, a reset link is on its way. It works once and expires in an hour.
            </CardDescription>
            {process.env.NODE_ENV !== "production" && (
              <p className="mt-2 text-[11px] text-muted-foreground">Local development: the link is printed in the API server&apos;s log.</p>
            )}
          </CardHeader>
        ) : (
          <>
            <CardHeader className="text-center">
              <CardTitle className="font-serif text-2xl">
                <h1>Reset your password</h1>
              </CardTitle>
              <CardDescription>We&apos;ll email you a link to choose a new one.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={formAction} noValidate>
                <FieldGroup>
                  <Field data-invalid={state && !state.ok ? true : undefined}>
                    <FieldLabel htmlFor="login">Email or username</FieldLabel>
                    <Input id="login" name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@agency.org" required autoFocus />
                    {state && !state.ok && <FieldError>{state.error}</FieldError>}
                  </Field>
                  <Button type="submit" className="w-full" loading={pending} disabled={pending}>
                    Send reset link
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </>
        )}
      </Card>
      <p className="mt-6 text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link href="/login" className="text-accent underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
