"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Info, ShieldCheck } from "lucide-react";
import { CratonLogo } from "@/components/craton-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { loginAction, loginMfaAction, signupAction, type FormResult } from "@/app/auth-actions";
import { DotPattern } from "@/components/ui/dot-pattern";
import { cn } from "@/lib/utils";

type AuthFormProps = {
  mode: "login" | "signup";
  /** Where to go after signing in (from ?next=). */
  next?: string;
  /** A one-line notice above the form, e.g. after a session expired. */
  notice?: string;
  /** Local development only: the seeded demo account. */
  demoHint?: boolean;
};

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export function AuthForm({ mode, next, notice, demoHint }: AuthFormProps) {
  const isLogin = mode === "login";
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(isLogin ? loginAction : signupAction, null);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  // Controlled, so a failed attempt (React resets forms after an action) keeps what was typed.
  const [loginValue, setLoginValue] = useState("");
  const [touched, setTouched] = useState(false);
  // After a correct password on an account with two-step verification, the next step is a code.
  const ticket = isLogin && state?.ok ? state.mfaTicket : undefined;
  const [leftTicket, setLeftTicket] = useState<string | null>(null);
  const codeStep = Boolean(ticket && ticket !== leftTicket);

  const serverError = state && !state.ok ? state : null;
  const fieldError = (name: string) => (serverError?.field === name ? serverError.error : null);
  const usernameError = fieldError("username") ?? (!isLogin && username && !HANDLE.test(username) ? "Lowercase letters, numbers and single dashes." : null);
  const passwordError = fieldError("password") ?? (!isLogin && touched && password.length > 0 && password.length < 12 ? "Use at least 12 characters." : null);
  const formError = serverError && !serverError.field ? serverError.error : null;

  return (
    <main id="main" className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      <DotPattern
        className={cn("text-foreground/20 mask-[radial-gradient(480px_circle_at_center,white,transparent)]")}
        width={24}
        height={24}
      />
      <Link href="/" className="relative mb-8" aria-label="Craton home">
        <CratonLogo className="text-xl" />
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="font-serif text-2xl">
            <h1>{codeStep ? "Two-step verification" : isLogin ? "Sign in to Craton" : "Create your account"}</h1>
          </CardTitle>
          <CardDescription>
            {codeStep ? "Enter the 6-digit code from your authenticator app." : isLogin ? "Welcome back. Pick up where your basin left off." : "Free to start. No credit card needed."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {codeStep && ticket ? (
            <CodeStep ticket={ticket} next={next} onBack={() => setLeftTicket(ticket)} />
          ) : (
          <>
          {notice && (
            <p role="status" className="mb-4 flex items-start gap-2 border border-border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              {notice}
            </p>
          )}
          <form action={formAction} noValidate>
            {next && <input type="hidden" name="next" value={next} />}
            <FieldGroup>
              {!isLogin && (
                <Field data-invalid={usernameError ? true : undefined}>
                  <FieldLabel htmlFor="username">Username</FieldLabel>
                  <Input
                    id="username"
                    name="username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="e.g. priya-menon"
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
                      Shown on your profile and commits as <span className="font-mono text-foreground">@{username || "username"}</span>
                    </FieldDescription>
                  )}
                </Field>
              )}
              <Field data-invalid={fieldError("email") ? true : undefined}>
                <FieldLabel htmlFor="login">{isLogin ? "Email or username" : "Work email"}</FieldLabel>
                <Input
                  id="login"
                  name={isLogin ? "login" : "email"}
                  type={isLogin ? "text" : "email"}
                  inputMode="email"
                  autoComplete={isLogin ? "username" : "email"}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@agency.org"
                  value={loginValue}
                  onChange={(e) => setLoginValue(e.target.value)}
                  aria-invalid={!!fieldError("email")}
                  aria-describedby={fieldError("email") ? "login-error" : undefined}
                  required
                  autoFocus={isLogin}
                />
                {fieldError("email") && <FieldError id="login-error">{fieldError("email")}</FieldError>}
              </Field>
              <Field data-invalid={passwordError ? true : undefined}>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="password">Password</FieldLabel>
                  {isLogin && (
                    <Link href="/forgot-password" className="hit-area text-xs text-muted-foreground hover:text-foreground hover:underline">
                      Forgot password?
                    </Link>
                  )}
                </div>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={!!passwordError}
                    aria-describedby={passwordError ? "password-error" : !isLogin ? "password-help" : undefined}
                    placeholder="••••••••••••"
                    className="pr-9"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute right-1 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
                {passwordError ? (
                  <FieldError id="password-error">{passwordError}</FieldError>
                ) : (
                  !isLogin && <FieldDescription id="password-help">At least 12 characters. A passphrase works well.</FieldDescription>
                )}
              </Field>
              {formError && (
                <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
                  {formError}
                </p>
              )}
              <Button type="submit" className="w-full" loading={pending} disabled={pending}>
                {pending ? (isLogin ? "Signing in…" : "Creating your account…") : isLogin ? "Sign in" : "Create account"}
              </Button>
              {!isLogin && (
                <p className="text-center text-xs text-muted-foreground text-pretty">
                  By creating an account you agree to the <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">Terms</Link> and{" "}
                  <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">Privacy policy</Link>.
                </p>
              )}
            </FieldGroup>
          </form>
          {isLogin && demoHint && (
            <p className="mt-4 border-t border-border pt-3 text-center text-[11px] text-muted-foreground">
              Local demo: <span className="font-mono text-foreground">priyam</span> / <span className="font-mono text-foreground">craton-demo-2026</span>
            </p>
          )}
          </>
          )}
        </CardContent>
      </Card>
      <p className="mt-6 text-sm text-muted-foreground">
        {isLogin ? (
          <>
            New to Craton?{" "}
            <Link href="/signup" className="text-accent underline underline-offset-2">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"} className="text-accent underline underline-offset-2">
              Sign in
            </Link>
          </>
        )}
      </p>
    </main>
  );
}

/** The second sign-in step: a code from the authenticator app, or a recovery code if the phone is gone. */
function CodeStep({ ticket, next, onBack }: { ticket: string; next?: string; onBack: () => void }) {
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(loginMfaAction, null);
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState("");
  const error = state && !state.ok ? state : null;

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="ticket" value={ticket} />
      {next && <input type="hidden" name="next" value={next} />}
      <FieldGroup>
        <Field data-invalid={error?.field === "code" ? true : undefined}>
          <FieldLabel htmlFor="code">{recovery ? "Recovery code" : "Authentication code"}</FieldLabel>
          <Input
            id="code"
            name="code"
            value={code}
            onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode={recovery ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            placeholder={recovery ? "xxxxx-xxxxx" : "123456"}
            className="font-mono tracking-widest"
            aria-invalid={error?.field === "code"}
            autoFocus
            required
          />
          {error?.field === "code" ? (
            <FieldError>{error.error}</FieldError>
          ) : (
            <FieldDescription>{recovery ? "Each recovery code works once." : "The code changes every 30 seconds."}</FieldDescription>
          )}
        </Field>
        {error && error.field !== "code" && (
          <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
            {error.error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={pending} disabled={pending || !code}>
          <ShieldCheck data-icon="inline-start" />
          Verify and sign in
        </Button>
        <div className="flex flex-col items-center gap-1.5 text-xs">
          <button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => { setRecovery((v) => !v); setCode(""); }}>
            {recovery ? "Use an authenticator code instead" : "Lost your phone? Use a recovery code"}
          </button>
          <button type="button" className="text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={onBack}>
            Back to password
          </button>
        </div>
      </FieldGroup>
    </form>
  );
}
