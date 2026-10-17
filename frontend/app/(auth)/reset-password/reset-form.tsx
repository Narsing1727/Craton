"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
      <FieldGroup>
        <Field data-invalid={state && !state.ok && state.field === "password" ? true : undefined}>
          <FieldLabel htmlFor="password">New password</FieldLabel>
          <Input id="password" name="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
          <FieldDescription>At least 12 characters. Every other session will be signed out.</FieldDescription>
        </Field>
        <Field data-invalid={mismatch ? true : undefined}>
          <FieldLabel htmlFor="confirm">Confirm password</FieldLabel>
          <Input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={mismatch} required />
          {mismatch && <FieldError>The passwords don&apos;t match.</FieldError>}
        </Field>
        {error && (
          <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={pending} disabled={pending || mismatch || password.length < 12}>
          Set new password
        </Button>
      </FieldGroup>
    </form>
  );
}
