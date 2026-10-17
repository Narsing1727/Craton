"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { CratonLogo } from "@/components/craton-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DotPattern } from "@/components/ui/dot-pattern";
import { completeOAuthSignupAction, type FormResult } from "@/app/auth-actions";
import { PROVIDER_NAME, type OAuthProvider } from "@/lib/oauth-routes-shared";
import { cn } from "@/lib/utils";

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

/** The one step after a first sign-in with a provider: choose the username that goes in every URL. */
export function OAuthUsernameForm({ provider, email, name, suggestion, next }: { provider: OAuthProvider; email: string; name: string; suggestion: string; next?: string }) {
  const label = PROVIDER_NAME[provider];
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(completeOAuthSignupAction, null);
  const [username, setUsername] = useState(suggestion);
  const serverError = state && !state.ok ? state : null;
  const usernameError = (serverError?.field === "username" ? serverError.error : null) ?? (username && !HANDLE.test(username) ? "Lowercase letters, numbers and single dashes." : null);
  const formError = serverError && serverError.field !== "username" ? serverError.error : null;

  return (
    <main id="main" className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      <DotPattern className={cn("text-foreground/20 mask-[radial-gradient(480px_circle_at_center,white,transparent)]")} width={24} height={24} />
      <Link href="/" className="relative mb-8" aria-label="Craton home">
        <CratonLogo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            <h1>Choose your username</h1>
          </CardTitle>
          <CardDescription>
            {label} confirmed <span className="font-mono text-foreground">{email}</span>. One more thing: the username that appears on your profile and commits.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={formAction} noValidate>
            {next && <input type="hidden" name="next" value={next} />}
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="provider" value={provider} />
            <FieldGroup>
              <Field data-invalid={usernameError ? true : undefined}>
                <FieldLabel htmlFor="username">Username</FieldLabel>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                  aria-invalid={!!usernameError}
                  aria-describedby="username-help"
                  required
                  autoFocus
                />
                {usernameError ? (
                  <FieldError id="username-help">{usernameError}</FieldError>
                ) : (
                  <FieldDescription id="username-help">
                    Shown as <span className="font-mono text-foreground">@{username || "username"}</span>. It is part of every link to your work, so choose one you will keep.
                  </FieldDescription>
                )}
              </Field>
              {formError && (
                <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
                  {formError}{" "}
                  {serverError?.restart && (
                    <a href={`/auth/${provider}`} className="underline underline-offset-2">
                      Continue with {label} again
                    </a>
                  )}
                </p>
              )}
              <Button type="submit" className="w-full" loading={pending} disabled={pending || !!usernameError || !username}>
                {pending ? "Creating your account…" : "Create account"}
              </Button>
              <p className="text-center text-xs text-muted-foreground text-pretty">
                By continuing you agree to the <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">Terms</Link> and{" "}
                <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</Link>.
              </p>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
