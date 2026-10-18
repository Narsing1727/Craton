// The frame of every sign-in page (sign in, sign up, forgot and reset password, confirm email, single sign-on, choosing a
// username): pure black, no pattern, no card, one centered column. The wordmark sits top left and the one other thing a
// visitor may want (the other way in) top right, the way a product page does, so the page itself is only the question.
//
// The tokens are re-pointed inside `.auth-surface` (globals.css), so the shared inputs, buttons and messages restyle
// themselves without touching the rest of the app. Sizes and radii stay on the app's scale (4px controls).

import type { ReactNode } from "react";
import Link from "next/link";
import { CratonLogo } from "@/components/craton-logo";
import { cn } from "@/lib/utils";

/** The look of the controls on these pages. One place, so every page agrees. */
export const AUTH = {
  label: "text-[13px] font-medium text-foreground/70",
  input:
    "h-11 rounded-[4px] border-foreground/10 bg-foreground/[0.03] px-3.5 text-[15px] text-foreground placeholder:text-foreground/30 hover:border-foreground/20 focus-visible:border-foreground/50 focus-visible:ring-4 focus-visible:ring-foreground/10 md:text-[15px]",
  primary: "h-11 w-full rounded-[4px] bg-foreground text-[15px] font-medium text-background hover:bg-foreground/90 focus-visible:ring-4 focus-visible:ring-foreground/20",
  outline: "h-11 rounded-[4px] border-foreground/10 bg-transparent text-[14px] font-medium text-foreground hover:bg-foreground/[0.06] hover:border-foreground/20",
  quiet: "h-10 w-full rounded-[4px] border-transparent bg-transparent text-[13px] font-medium text-foreground/60 hover:bg-foreground/[0.05] hover:text-foreground",
  error: "border-l-2 border-destructive/70 bg-destructive/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-destructive",
  note: "border-l-2 border-foreground/25 pl-3 text-[13px] leading-relaxed text-foreground/60",
  link: "text-foreground/55 underline-offset-4 transition-colors hover:text-foreground hover:underline",
} as const;

export function AuthShell({ children, action }: { children: ReactNode; action?: { lead?: string; label: string; href: string } }) {
  return (
    <main id="main" className="auth-surface relative flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" aria-label="Craton home" className="rounded-[4px] outline-none focus-visible:ring-4 focus-visible:ring-foreground/20">
          <CratonLogo className="text-[14px]" />
        </Link>
        {action && (
          <p className="flex items-center gap-3 text-[13px] text-foreground/45">
            {action.lead && <span className="hidden sm:inline">{action.lead}</span>}
            <Link href={action.href} className="inline-flex h-9 items-center rounded-[4px] border border-foreground/15 px-3.5 text-[13px] font-medium text-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/[0.06]">
              {action.label}
            </Link>
          </p>
        )}
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-20 pt-4">
        <div className="auth-rise w-full max-w-[368px]">{children}</div>
      </div>
      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-6 pb-7 text-[12px] text-foreground/30">
        <span>© Craton</span>
        <Link href="/terms" className="transition-colors hover:text-foreground/70">
          Terms
        </Link>
        <Link href="/privacy" className="transition-colors hover:text-foreground/70">
          Privacy
        </Link>
        <Link href="/security" className="transition-colors hover:text-foreground/70">
          Security
        </Link>
      </footer>
    </main>
  );
}

export function AuthTitle({ title, subtitle, className }: { title: string; subtitle?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-8", className)}>
      <h1 className="text-[30px] font-medium leading-[1.15] tracking-[-0.025em] text-foreground">{title}</h1>
      {subtitle && <p className="mt-2.5 text-[15px] leading-relaxed text-foreground/50 text-pretty">{subtitle}</p>}
    </div>
  );
}

/** A hairline with a word in it. */
export function AuthDivider({ children = "or" }: { children?: ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-4 text-[12px] uppercase tracking-[0.14em] text-foreground/30" aria-hidden>
      <span className="h-px flex-1 bg-foreground/10" />
      {children}
      <span className="h-px flex-1 bg-foreground/10" />
    </div>
  );
}
