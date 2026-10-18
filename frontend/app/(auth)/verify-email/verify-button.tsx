"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUTH } from "@/components/auth-shell";
import { verifyEmailAction } from "@/app/auth-actions";

export function VerifyButton({ token }: { token: string }) {
  const [state, setState] = useState<{ done: boolean; error: string | null }>({ done: false, error: null });
  const [pending, start] = useTransition();

  if (state.done) {
    return (
      <div className="flex flex-col gap-4">
        <p role="status" className="flex items-center gap-2 text-[14px] text-foreground/80">
          <CircleCheck className="size-4 text-emerald-500" aria-hidden />
          Email confirmed.
        </p>
        <Button href="/dashboard" className={AUTH.primary}>
          Go to your dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        className={AUTH.primary}
        loading={pending}
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await verifyEmailAction(token);
            setState(result.ok ? { done: true, error: null } : { done: false, error: result.error });
          })
        }
      >
        Confirm email address
      </Button>
      {state.error && (
        <p role="alert" className={AUTH.error}>
          {state.error}{" "}
          <Link href="/settings/security" className="underline underline-offset-4">
            Send a new link
          </Link>
        </p>
      )}
    </div>
  );
}
