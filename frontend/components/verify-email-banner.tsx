"use client";

// Shown to signed-in people whose email isn't confirmed yet: what it blocks, and a resend button.
// Dismissing hides it for this browser session only; it comes back until the email is confirmed.

import { useEffect, useState, useTransition } from "react";
import { usePathname } from "next/navigation";
import { MailWarning, X } from "lucide-react";
import { notify } from "@/components/button-status";
import { Button } from "@/components/ui/button";
import { useSession } from "@/components/session";
import { resendVerificationAction } from "@/app/auth-actions";

const KEY = "craton:verify-banner-hidden";

export function VerifyEmailBanner() {
  const user = useSession();
  const pathname = usePathname();
  const [hidden, setHidden] = useState(true); // until storage is read, so it never flashes
  const [sending, startSend] = useTransition();

  useEffect(() => {
    try {
      setHidden(sessionStorage.getItem(KEY) === "1");
    } catch {
      setHidden(false);
    }
  }, []);

  if (!user || user.emailVerified || hidden || pathname.startsWith("/onboarding") || pathname.startsWith("/verify-email")) return null;

  function resend() {
    startSend(async () => {
      const result = await resendVerificationAction();
      if (!result.ok) return void notify.error("Couldn’t send the email", { description: result.error });
      notify.success(`Sent a new link to ${user!.email}`);
    });
  }
  function dismiss() {
    setHidden(true);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {}
  }

  return (
    <div role="status" className="w-full border-b border-border bg-muted/40">
      <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm sm:px-6 lg:px-8 xl:px-10">
        <MailWarning className="size-4 shrink-0 text-chart-3" aria-hidden />
        <p className="min-w-0 flex-1 text-muted-foreground">
          Confirm <span className="font-mono text-foreground">{user.email}</span> to publish public repositories and invite people. Check your inbox for the link.
        </p>
        <Button size="sm" variant="outline" onClick={resend} loading={sending} disabled={sending}>
          {sending ? "Sending…" : "Resend email"}
        </Button>
        <Button size="icon" variant="ghost" onClick={dismiss} aria-label="Hide until next visit" className="size-7">
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
