"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyEmailAction } from "@/app/auth-actions";

export function VerifyButton({ token }: { token: string }) {
  const [state, setState] = useState<{ done: boolean; error: string | null }>({ done: false, error: null });
  const [pending, start] = useTransition();

  if (state.done) {
    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <p role="status" className="flex items-center gap-2 text-sm">
          <CircleCheck className="size-4 text-chart-2" aria-hidden />
          Email confirmed.
        </p>
        <Button href="/dashboard" className="w-full">
          Go to your dashboard
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Button
        className="w-full"
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
        <p role="alert" className="text-center text-sm text-destructive">
          {state.error}{" "}
          <Link href="/settings/security" className="underline underline-offset-2">
            Send a new link
          </Link>
        </p>
      )}
    </div>
  );
}
