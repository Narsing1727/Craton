"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, EyeOff, Info, Building2, KeyRound, ShieldCheck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { AUTH, AuthDivider, AuthShell, AuthTitle } from "@/components/auth-shell";
import { loginAction, loginMfaAction, passkeyLoginAction, passkeyLoginOptionsAction, signupAction, type FormResult } from "@/app/auth-actions";
import { conditionalSupported, getPasskey, passkeyErrorMessage, passkeysSupported } from "@/lib/webauthn";
import { cn } from "@/lib/utils";

type AuthFormProps = {
  mode: "login" | "signup";
  /** Where to go after signing in (from ?next=). */
  next?: string;
  /** A one-line notice above the form, e.g. after a session expired. */
  notice?: string;
  /** Local development only: the seeded demo account. */
  demoHint?: boolean;
  /** This server offers "Continue with Google" (the API says so; the button is not drawn otherwise). */
  google?: boolean;
  /** This server offers "Continue with GitHub". */
  github?: boolean;
  /** At least one organization on this server has set up single sign-on. */
  sso?: boolean;
  /** Development only: providers whose buttons are shown although the server has no credentials for them yet, so they can be seen and tried. */
  notSetUp?: string[];
  /** This server accepts passkeys (the API says so). The button also needs a browser that can use them. */
  passkeys?: boolean;
  /** A two-step ticket from a Google sign-in on an account with two-step verification: go straight to the code. */
  initialMfaTicket?: string;
};

function GitHubMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.79.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export function AuthForm({ mode, next, notice, demoHint, google, github, sso, notSetUp, passkeys, initialMfaTicket }: AuthFormProps) {
  const isLogin = mode === "login";
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(isLogin ? loginAction : signupAction, null);
  const [showPassword, setShowPassword] = useState(false);
  // Passkeys: a button, and the browser's own autofill list in the username field where it has one.
  const [canPasskey, setCanPasskey] = useState(false);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyTicket, setPasskeyTicket] = useState<string | null>(null);
  const autofill = useRef<AbortController | null>(null);
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  // Controlled, so a failed attempt (React resets forms after an action) keeps what was typed.
  const [loginValue, setLoginValue] = useState("");
  const [touched, setTouched] = useState(false);
  // After a correct password on an account with two-step verification, the next step is a code.
  const ticket = (isLogin && state?.ok ? state.mfaTicket : undefined) ?? passkeyTicket ?? (isLogin ? initialMfaTicket : undefined);
  const [leftTicket, setLeftTicket] = useState<string | null>(null);
  const codeStep = Boolean(ticket && ticket !== leftTicket);

  const serverError = state && !state.ok ? state : null;
  const fieldError = (name: string) => (serverError?.field === name ? serverError.error : null);
  const usernameError = fieldError("username") ?? (!isLogin && username && !HANDLE.test(username) ? "Lowercase letters, numbers and single dashes." : null);
  const passwordError = fieldError("password") ?? (!isLogin && touched && password.length > 0 && password.length < 12 ? "Use at least 12 characters." : null);
  const formError = (serverError && !serverError.field ? serverError.error : null) ?? passkeyError;

  /** A passkey answer goes to the server; success redirects, so only a failure or a two-step code request comes back. */
  async function finishWithPasskey(credential: Awaited<ReturnType<typeof getPasskey>>) {
    const r = await passkeyLoginAction(credential, next ?? "");
    if (r && !r.ok) setPasskeyError(r.error);
    else if (r && r.ok && r.mfaTicket) setPasskeyTicket(r.mfaTicket);
  }

  async function signInWithPasskey() {
    setPasskeyError(null);
    setPasskeyBusy(true);
    autofill.current?.abort(); // the browser allows one passkey request at a time
    try {
      const o = await passkeyLoginOptionsAction();
      if (!o.ok) return void setPasskeyError(o.error);
      await finishWithPasskey(await getPasskey(o.options));
    } catch (err) {
      const message = passkeyErrorMessage(err);
      if (message) setPasskeyError(message);
    } finally {
      setPasskeyBusy(false);
    }
  }

  useEffect(() => {
    if (!isLogin || !passkeys) return;
    setCanPasskey(passkeysSupported());
    let cancelled = false;
    const controller = new AbortController();
    autofill.current = controller;
    (async () => {
      if (!(await conditionalSupported()) || cancelled) return;
      try {
        const o = await passkeyLoginOptionsAction();
        if (!o.ok || cancelled) return;
        const credential = await getPasskey(o.options, { conditional: true, signal: controller.signal });
        if (!cancelled) await finishWithPasskey(credential);
      } catch {
        // Cancelled by us, or dismissed by the person: nothing to say.
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLogin, passkeys]);

  const passkeyButton = isLogin && passkeys && canPasskey;

  const social = [
    google && { key: "google", href: `/auth/google${next ? `?next=${encodeURIComponent(next)}` : ""}`, label: "Google", mark: <GoogleMark /> },
    github && { key: "github", href: `/auth/github${next ? `?next=${encodeURIComponent(next)}` : ""}`, label: "GitHub", mark: <GitHubMark /> },
  ].filter(Boolean) as { key: string; href: string; label: string; mark: React.ReactNode }[];
  const hasAlternatives = social.length > 0 || sso || passkeyButton;
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <AuthShell action={isLogin ? { lead: "New to Craton?", label: "Create account", href: "/signup" } : { lead: "Already have an account?", label: "Sign in", href: `/login${nextQuery}` }}>
      <AuthTitle
        title={codeStep ? "Two-step verification" : isLogin ? "Sign in" : "Create your account"}
        subtitle={codeStep ? "Enter the 6-digit code from your authenticator app." : isLogin ? "Continue to Craton." : "Free while in early access. No credit card."}
      />
      {codeStep && ticket ? (
        <CodeStep ticket={ticket} next={next} onBack={() => setLeftTicket(ticket)} />
      ) : (
        <>
          {notice && (
            <p role="status" className={cn(AUTH.note, "mb-6")}>
              {notice}
            </p>
          )}
          {hasAlternatives && (
            <>
              {social.length > 0 && (
                <div className={cn("grid gap-2.5", social.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                  {social.map((p) => (
                    /* A plain anchor on purpose: a Next <Link> would prefetch this route and start a sign-in nobody asked for. */
                    <a key={p.key} href={p.href} className={cn(buttonVariants({ variant: "outline" }), AUTH.outline, "gap-2.5")}>
                      {p.mark}
                      {p.label}
                    </a>
                  ))}
                </div>
              )}
              {(passkeyButton || sso) && (
                <div className={cn("flex flex-col", social.length > 0 && "mt-1.5")}>
                  {passkeyButton && (
                    <Button type="button" variant="ghost" className={cn(AUTH.quiet, "gap-2")} onClick={() => void signInWithPasskey()} loading={passkeyBusy} disabled={passkeyBusy}>
                      <KeyRound className="size-4" aria-hidden />
                      Use a passkey
                    </Button>
                  )}
                  {sso && (
                    <a href={`/login/sso${nextQuery}`} className={cn(buttonVariants({ variant: "ghost" }), AUTH.quiet, "gap-2")}>
                      <Building2 className="size-4" aria-hidden />
                      Single sign-on
                    </a>
                  )}
                </div>
              )}
              <AuthDivider />
            </>
          )}
          <form action={formAction} noValidate>
            {next && <input type="hidden" name="next" value={next} />}
            <div className="flex flex-col gap-5">
              {!isLogin && (
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
                    placeholder="priya-menon"
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
                      Shown on your profile and commits as <span className="font-mono text-foreground/70">@{username || "username"}</span>
                    </FieldDescription>
                  )}
                </Field>
              )}
              <Field data-invalid={fieldError("email") ? true : undefined}>
                <FieldLabel htmlFor="login" className={AUTH.label}>
                  {isLogin ? "Email or username" : "Work email"}
                </FieldLabel>
                <Input
                  id="login"
                  name={isLogin ? "login" : "email"}
                  type={isLogin ? "text" : "email"}
                  inputMode="email"
                  autoComplete={isLogin ? "username webauthn" : "email"}
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@your-organization.org"
                  value={loginValue}
                  onChange={(e) => setLoginValue(e.target.value)}
                  aria-invalid={!!fieldError("email")}
                  aria-describedby={fieldError("email") ? "login-error" : undefined}
                  className={AUTH.input}
                  required
                  autoFocus={isLogin}
                />
                {fieldError("email") && (
                  <FieldError id="login-error" className="text-[13px] text-destructive">
                    {fieldError("email")}
                  </FieldError>
                )}
              </Field>
              <Field data-invalid={passwordError ? true : undefined}>
                <div className="flex items-center justify-between">
                  <FieldLabel htmlFor="password" className={AUTH.label}>
                    Password
                  </FieldLabel>
                  {isLogin && (
                    <Link href="/forgot-password" className={cn("hit-area text-[13px]", AUTH.link)}>
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
                    className={cn(AUTH.input, "pr-11")}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    aria-pressed={showPassword}
                    className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-[4px] text-foreground/40 transition-colors hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
                  </button>
                </div>
                {passwordError ? (
                  <FieldError id="password-error" className="text-[13px] text-destructive">
                    {passwordError}
                  </FieldError>
                ) : (
                  !isLogin && (
                    <FieldDescription id="password-help" className="text-[13px] text-foreground/40">
                      At least 12 characters. A passphrase works well.
                    </FieldDescription>
                  )
                )}
              </Field>
              {formError && (
                <p role="alert" className={AUTH.error}>
                  {formError}
                </p>
              )}
              <Button type="submit" className={cn(AUTH.primary, "mt-1")} loading={pending} disabled={pending}>
                {pending ? (isLogin ? "Signing in…" : "Creating your account…") : isLogin ? "Sign in" : "Create account"}
              </Button>
              {!isLogin && (
                <p className="text-center text-[12px] leading-relaxed text-foreground/40 text-pretty">
                  By creating an account you agree to the{" "}
                  <Link href="/terms" className={AUTH.link}>
                    Terms
                  </Link>{" "}
                  and{" "}
                  <Link href="/privacy" className={AUTH.link}>
                    Privacy policy
                  </Link>
                  .
                </p>
              )}
            </div>
          </form>
          {((notSetUp && notSetUp.length > 0) || (isLogin && demoHint)) && (
            <div className="mt-10 flex flex-col gap-1.5 border-t border-foreground/10 pt-4 text-[11px] leading-relaxed text-foreground/35">
              {notSetUp && notSetUp.length > 0 && (
                <p data-testid="providers-not-set-up" className="text-pretty">
                  Development note: {notSetUp.join(" and ")} {notSetUp.length === 1 ? "is" : "are"} not set up on this server yet. Add the credentials with <span className="font-mono text-foreground/55">npm run setup:oauth</span>. Visitors never see this, or an unconfigured button, in production.
                </p>
              )}
              {isLogin && demoHint && (
                <p>
                  Local demo: <span className="font-mono text-foreground/55">priyam</span> / <span className="font-mono text-foreground/55">craton-demo-2026</span>
                </p>
              )}
            </div>
          )}
        </>
      )}
    </AuthShell>
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
      <div className="flex flex-col gap-5">
        <Field data-invalid={error?.field === "code" ? true : undefined}>
          <FieldLabel htmlFor="code" className={AUTH.label}>
            {recovery ? "Recovery code" : "Authentication code"}
          </FieldLabel>
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
            className={cn(AUTH.input, "font-mono tracking-[0.3em]")}
            aria-invalid={error?.field === "code"}
            autoFocus
            required
          />
          {error?.field === "code" ? (
            <FieldError className="text-[13px] text-destructive">{error.error}</FieldError>
          ) : (
            <FieldDescription className="text-[13px] text-foreground/40">{recovery ? "Each recovery code works once." : "The code changes every 30 seconds."}</FieldDescription>
          )}
        </Field>
        {error && error.field !== "code" && (
          <p role="alert" className={AUTH.error}>
            {error.error}
          </p>
        )}
        <Button type="submit" className={AUTH.primary} loading={pending} disabled={pending || !code}>
          <ShieldCheck data-icon="inline-start" />
          Verify and sign in
        </Button>
        <div className="flex flex-col items-center gap-2 text-[13px]">
          <button
            type="button"
            className={AUTH.link}
            onClick={() => {
              setRecovery((v) => !v);
              setCode("");
            }}
          >
            {recovery ? "Use an authenticator code instead" : "Lost your phone? Use a recovery code"}
          </button>
          <button type="button" className={AUTH.link} onClick={onBack}>
            Back to password
          </button>
        </div>
      </div>
    </form>
  );
}
