import Link from "next/link";
import { CratonLogo } from "@/components/craton-logo";

export function SiteFooter() {
  return (
    <footer className="mt-auto w-full border-t border-border/40 py-8 text-xs text-muted-foreground">
      <div className="flex w-full flex-col items-center justify-between gap-4 px-4 sm:px-6 lg:px-8 xl:px-10 md:flex-row">
        <div className="flex items-center gap-3">
          <CratonLogo className="text-xs scale-90 origin-left" />
          <span>Early access · not yet a public release</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
          <Link href="/terms" className="hit-area hover:text-foreground hover:underline">
            Terms
          </Link>
          <Link href="/privacy" className="hit-area hover:text-foreground hover:underline">
            Privacy
          </Link>
          <Link href="/security" className="hit-area hover:text-foreground hover:underline">
            Security
          </Link>
          <Link href="/cli" className="hit-area hover:text-foreground hover:underline">
            CLI
          </Link>
          <Link href="/docs" className="hit-area hover:text-foreground hover:underline">
            Docs
          </Link>
          <Link href="/api-reference" className="hit-area hover:text-foreground hover:underline">
            API
          </Link>
          <Link href="/pricing" className="hit-area hover:text-foreground hover:underline">
            Pricing
          </Link>
          <Link href="/changelog" className="hit-area hover:text-foreground hover:underline">
            Changelog
          </Link>
          <Link href="/about" className="hit-area hover:text-foreground hover:underline">
            About
          </Link>
          <Link href="/help" className="hit-area hover:text-foreground hover:underline">
            Help &amp; Support
          </Link>
          <Link href="/contact" className="hit-area hover:text-foreground hover:underline">
            Contact
          </Link>
        </nav>
      </div>
    </footer>
  );
}
