"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { AUTH, AuthShell, AuthTitle } from "@/components/auth-shell";
import { completeOAuthSignupAction, type FormResult } from "@/app/auth-actions";
import { PROVIDER_NAME, type OAuthProvider } from "@/lib/oauth-routes-shared";

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
    <AuthShell>
      <AuthTitle title="Choose your username" subtitle={<>{label} confirmed <span className="font-mono text-foreground/80">{email}</span>. One more thing: the username that appears on your profile and commits.</>} />
      <form action={formAction} noValidate>
        {next && <input type="hidden" name="next" value={next} />}
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="provider" value={provider} />
        <div className="flex flex-col gap-5">
          <Field data-invalid={usernameError ? true : undefined}>
            <FieldLabel htmlFor="username" className={AUTH.label}>
              Username
            </FieldLabel>
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
              className={AUTH.input}
              required
              autoFocus
            />
            {usernameError ? (
              <FieldError id="username-help" className="text-[13px] text-destructive">
                {usernameError}
              </FieldError>
            ) : (
              <FieldDescription id="username-help" className="text-[13px] text-foreground/40">
                Shown as <span className="font-mono text-foreground/70">@{username || "username"}</span>. It is part of every link to your work, so choose one you will keep.
              </FieldDescription>
            )}
          </Field>
          {formError && (
            <p role="alert" className={AUTH.error}>
              {formError}{" "}
              {serverError?.restart && (
                <a href={`/auth/${provider}`} className="underline underline-offset-4">
                  Continue with {label} again
                </a>
              )}
            </p>
          )}
          <Button type="submit" className={AUTH.primary} loading={pending} disabled={pending || !!usernameError || !username}>
            {pending ? "Creating your account…" : "Create account"}
          </Button>
          <p className="text-center text-[12px] leading-relaxed text-foreground/40 text-pretty">
            By continuing you agree to the{" "}
            <Link href="/terms" className={AUTH.link}>
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className={AUTH.link}>
              Privacy policy
            </Link>
            .
          </p>
        </div>
      </form>
    </AuthShell>
  );
}
