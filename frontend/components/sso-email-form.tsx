"use client";

// The work-email step of single sign-on. It navigates with a script rather than submitting a form: the site's
// Content-Security-Policy (form-action 'self') rightly forbids a form whose answer redirects to another site, and the
// next step is exactly that, a redirect to the organization's identity provider.

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AUTH } from "@/components/auth-shell";

export function SsoEmailForm({ email, next, message }: { email?: string; next?: string; message?: string }) {
  const [value, setValue] = useState(email ?? "");
  const [going, setGoing] = useState(false);

  function go(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    setGoing(true);
    window.location.assign(`/auth/sso?email=${encodeURIComponent(value.trim())}${next ? `&next=${encodeURIComponent(next)}` : ""}`);
  }

  return (
    <form onSubmit={go} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label htmlFor="sso-email" className={AUTH.label}>
          Work email
        </label>
        <Input id="sso-email" name="email" type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="you@your-organization.org" autoComplete="email" className={AUTH.input} autoFocus required />
      </div>
      {message && (
        <p role="alert" className={AUTH.error}>
          {message}
        </p>
      )}
      <Button type="submit" className={AUTH.primary} loading={going} disabled={going || !value.trim()}>
        Continue
      </Button>
      <p className="text-center text-[13px] text-foreground/45">
        <Link href="/login" className={AUTH.link}>
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
