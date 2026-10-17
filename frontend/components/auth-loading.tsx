import { SquareSpinner } from "@/components/ui/square-spinner";
import { CratonLogo } from "@/components/craton-logo";
import { cn } from "@/lib/utils";

// Loading state for the standalone sign-in pages. They have no site header or footer, so falling back to the app's
// PageLoading would flash a dashboard-looking screen behind a login form. This keeps the page's own black, the wordmark
// where it will be, and a spinner where the form will be.
export function AuthLoading({ branded = false }: { branded?: boolean }) {
  return (
    <main className="auth-surface flex min-h-dvh flex-col bg-background text-foreground">
      <header className="px-6 py-6 sm:px-10">{branded && <CratonLogo className="text-[14px]" />}</header>
      <div className={cn("flex flex-1 items-center justify-center pb-24")}>
        <SquareSpinner size={22} />
      </div>
    </main>
  );
}
