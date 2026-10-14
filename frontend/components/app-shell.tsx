"use client";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { VerifyEmailBanner } from "@/components/verify-email-banner";

/** `loading`: just the header while a page's content is on its way (no footer or back link to jump around). */
/**
 * `fixed` pins the page to the window: the header and the left column stay where they are and only
 * the pane a page puts in `children` scrolls (settings). It has no footer.
 */
export function AppShell({ children, loading = false, fixed = false }: { children: React.ReactNode; loading?: boolean; fixed?: boolean }) {
  return (
    <div className={fixed ? "flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground" : "flex min-h-dvh w-full flex-col bg-background text-foreground"}>
      <SiteHeader />
      <VerifyEmailBanner />
      <main id="main" tabIndex={-1} className={fixed ? "flex min-h-0 w-full flex-1 flex-col outline-none" : "flex-1 w-full flex flex-col outline-none"}>
        {children}
      </main>
      {!loading && !fixed && <SiteFooter />}
    </div>
  );
}
