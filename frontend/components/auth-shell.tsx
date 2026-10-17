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
  label: "text-[13px] font-medium text-white/70",
  input:
    "h-11 rounded-[4px] border-white/10 bg-white/[0.03] px-3.5 text-[15px] text-white placeholder:text-white/30 hover:border-white/20 focus-visible:border-white/50 focus-visible:ring-4 focus-visible:ring-white/10 md:text-[15px]",
  primary: "h-11 w-full rounded-[4px] bg-white text-[15px] font-medium text-black hover:bg-white/90 focus-visible:ring-4 focus-visible:ring-white/20",
  outline: "h-11 rounded-[4px] border-white/10 bg-transparent text-[14px] font-medium text-white hover:bg-white/[0.06] hover:border-white/20",
  quiet: "h-10 w-full rounded-[4px] border-transparent bg-transparent text-[13px] font-medium text-white/60 hover:bg-white/[0.05] hover:text-white",
  error: "border-l-2 border-red-500/70 bg-red-500/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-red-300",
  note: "border-l-2 border-white/25 pl-3 text-[13px] leading-relaxed text-white/60",
  link: "text-white/55 underline-offset-4 transition-colors hover:text-white hover:underline",
} as const;

export function AuthShell({ children, action }: { children: ReactNode; action?: { lead?: string; label: string; href: string } }) {
  return (
    <main id="main" className="auth-surface dark relative flex min-h-dvh flex-col bg-black text-white">
      <header className="flex items-center justify-between px-6 py-6 sm:px-10">
        <Link href="/" aria-label="Craton home" className="rounded-[4px] outline-none focus-visible:ring-4 focus-visible:ring-white/20">
          <CratonLogo className="text-[14px]" />
        </Link>
        {action && (
          <p className="flex items-center gap-3 text-[13px] text-white/45">
            {action.lead && <span className="hidden sm:inline">{action.lead}</span>}
            <Link href={action.href} className="inline-flex h-9 items-center rounded-[4px] border border-white/15 px-3.5 text-[13px] font-medium text-white transition-colors hover:border-white/30 hover:bg-white/[0.06]">
              {action.label}
            </Link>
          </p>
        )}
      </header>
      <div className="flex flex-1 items-center justify-center px-6 pb-20 pt-4">
        <div className="auth-rise w-full max-w-[368px]">{children}</div>
      </div>
      <footer className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-6 pb-7 text-[12px] text-white/30">
        <span>© Craton</span>
        <Link href="/terms" className="transition-colors hover:text-white/70">
          Terms
        </Link>
        <Link href="/privacy" className="transition-colors hover:text-white/70">
          Privacy
        </Link>
        <Link href="/security" className="transition-colors hover:text-white/70">
          Security
        </Link>
      </footer>
    </main>
  );
}

export function AuthTitle({ title, subtitle, className }: { title: string; subtitle?: ReactNode; className?: string }) {
  return (
    <div className={cn("mb-8", className)}>
      <h1 className="text-[30px] font-medium leading-[1.15] tracking-[-0.025em] text-white">{title}</h1>
      {subtitle && <p className="mt-2.5 text-[15px] leading-relaxed text-white/50 text-pretty">{subtitle}</p>}
    </div>
  );
}

/** A hairline with a word in it. */
export function AuthDivider({ children = "or" }: { children?: ReactNode }) {
  return (
    <div className="my-6 flex items-center gap-4 text-[12px] uppercase tracking-[0.14em] text-white/30" aria-hidden>
      <span className="h-px flex-1 bg-white/10" />
      {children}
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
