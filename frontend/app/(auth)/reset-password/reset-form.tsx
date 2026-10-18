"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { AUTH } from "@/components/auth-shell";
import { resetPasswordAction, type FormResult } from "@/app/auth-actions";

export function ResetForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState<FormResult | null, FormData>(resetPasswordAction, null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const mismatch = confirm.length > 0 && confirm !== password;
  const error = state && !state.ok ? state.error : null;

  return (
    <form action={formAction} noValidate>
      <input type="hidden" name="token" value={token} />
      <div className="flex flex-col gap-5">
        <Field data-invalid={state && !state.ok && state.field === "password" ? true : undefined}>
          <FieldLabel htmlFor="password" className={AUTH.label}>New password</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={AUTH.input} required autoFocus />
          <FieldDescription className="text-[13px] text-foreground/40">At least 12 characters. Every other session will be signed out.</FieldDescription>
        </Field>
        <Field data-invalid={mismatch ? true : undefined}>
          <FieldLabel htmlFor="confirm" className={AUTH.label}>Confirm password</FieldLabel>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} className={AUTH.input} required />
          {mismatch && <FieldError className="text-[13px] text-destructive">The passwords don&apos;t match.</FieldError>}
        </Field>
        {error && (
          <p role="alert" className={AUTH.error}>
            {error}
          </p>
        )}
        <Button type="submit" className={AUTH.primary} loading={pending} disabled={pending || mismatch || password.length < 12}>
          Set new password
        </Button>
      </div>
    </form>
  );
}
