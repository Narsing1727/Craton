"use client";

import { useActionState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { AUTH, AuthShell, AuthTitle } from "@/components/auth-shell";
import { forgotPasswordAction, type FormResult } from "@/app/auth-actions";

export default function ForgotPasswordPage() {
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(forgotPasswordAction, null);
  const sentTo = state?.ok ? state.message : null;

  return (
    <AuthShell action={{ label: "Sign in", href: "/login" }}>
      {sentTo ? (
        <>
          <MailCheck className="mb-5 size-7 text-foreground/80" aria-hidden />
          <AuthTitle
            title="Check your email"
            subtitle={
              <>
                If an account exists for <span className="text-foreground">{sentTo}</span>, a reset link is on its way. It works once and expires in an hour.
              </>
            }
          />
          {process.env.NODE_ENV !== "production" && <p className="text-[11px] text-foreground/35">Local development: the link is printed in the API server&apos;s log.</p>}
        </>
      ) : (
        <>
          <AuthTitle title="Reset your password" subtitle="We’ll email you a link to choose a new one." />
          <form action={formAction} noValidate>
            <div className="flex flex-col gap-5">
              <Field data-invalid={state && !state.ok ? true : undefined}>
                <FieldLabel htmlFor="login" className={AUTH.label}>
                  Email or username
                </FieldLabel>
                <Input id="login" name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="you@your-organization.org" className={AUTH.input} required autoFocus />
                {state && !state.ok && <FieldError className="text-[13px] text-destructive">{state.error}</FieldError>}
              </Field>
              <Button type="submit" className={AUTH.primary} loading={pending} disabled={pending}>
                Send reset link
              </Button>
              <p className="text-center text-[13px] text-foreground/45">
                Remembered it?{" "}
                <Link href="/login" className={AUTH.link}>
                  Back to sign in
                </Link>
              </p>
            </div>
          </form>
        </>
      )}
    </AuthShell>
  );
}
