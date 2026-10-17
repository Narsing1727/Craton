"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { unsubscribeDigestAction } from "@/app/auth-actions";

export function UnsubscribeButton({ token }: { token: string }) {
  const [state, setState] = useState<{ done: boolean; error?: string }>({ done: false });
  const [busy, start] = useTransition();
  if (state.done) {
    return (
      <p role="status" className="text-center text-sm">
        Done. You won’t get the weekly email any more.{" "}
        <Link href="/" className="underline underline-offset-2">
          Back to Craton
        </Link>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {state.error && (
        <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
          {state.error}
        </p>
      )}
      <Button
        className="w-full"
        loading={busy}
        disabled={busy}
        onClick={() =>
          start(async () => {
            const r = await unsubscribeDigestAction(token);
            setState(r.ok ? { done: true } : { done: false, error: r.error });
          })
        }
      >
        Stop the weekly email
      </Button>
    </div>
  );
}
