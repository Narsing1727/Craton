"use client";

// Shown to signed-out visitors where a signed-in person would comment, review or create.
// Sign-in brings them straight back to this page.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn } from "lucide-react";

export function SignInPrompt({ action }: { action: string }) {
  const pathname = usePathname();
  const next = encodeURIComponent(pathname || "/");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card p-4">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LogIn className="size-4 shrink-0" aria-hidden />
        Sign in to {action}.
      </p>
      <div className="flex items-center gap-2">
        <Link data-radius="control" href={`/login?next=${next}`} className="inline-flex h-8 items-center bg-foreground px-3 text-xs font-semibold text-background hover:bg-foreground/90">
          Sign in
        </Link>
        <Link data-radius="control" href="/signup" className="inline-flex h-8 items-center border border-border px-3 text-xs font-semibold hover:bg-muted">
          Create an account
        </Link>
      </div>
    </div>
  );
}
