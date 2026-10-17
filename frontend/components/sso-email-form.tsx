"use client";

// The work-email step of single sign-on. It navigates with a script rather than submitting a form: the site's
// Content-Security-Policy (form-action 'self') rightly forbids a form whose answer redirects to another site, and the
// next step is exactly that, a redirect to the organization's identity provider.

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <form onSubmit={go} className="flex flex-col gap-3">
      <label htmlFor="sso-email" className="text-sm font-medium">
        Work email
      </label>
      <Input id="sso-email" name="email" type="email" value={value} onChange={(e) => setValue(e.target.value)} placeholder="you@your-organization.org" autoComplete="email" autoFocus required />
      {message && (
        <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
          {message}
        </p>
      )}
      <Button type="submit" className="w-full" loading={going} disabled={going || !value.trim()}>
        Continue
      </Button>
      <p className="text-center text-xs text-muted-foreground">
        <Link href="/login" className="underline underline-offset-2 hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
