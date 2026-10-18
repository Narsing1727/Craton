"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { CratonLogo } from "@/components/craton-logo";
import { Button } from "@/components/ui/button";

/** Route error boundary: keeps the rest of the app usable and offers a retry. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // The server hides what went wrong, so ask the web app's own health route whether the API answers; if it does not,
  // say that plainly instead of the generic message.
  const [apiDown, setApiDown] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((h: { api?: { reachable?: boolean } }) => live && setApiDown(h.api?.reachable === false))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [error]);
  return (
    <main id="main" className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <Link href="/dashboard" aria-label="Craton dashboard">
        <CratonLogo />
      </Link>
      <div className="flex max-w-md flex-col items-center gap-2">
        <TriangleAlert className="size-8 text-chart-3" aria-hidden />
        <h1 className="text-xl font-semibold">{apiDown ? "The Craton API isn’t reachable" : "This page didn’t load"}</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {apiDown
            ? "The web app is running but can’t reach the Craton API right now. Your data is safe; nothing was changed. Try again in a moment."
            : "Your data is safe; nothing was changed. Try again, and if it keeps happening, check the status page."}
        </p>
        {error.digest && <p className="font-mono text-xs text-muted-foreground">Error ID {error.digest}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button onClick={() => reset()}>
          <RotateCcw data-icon="inline-start" />
          Try again
        </Button>
      </div>
    </main>
  );
}
