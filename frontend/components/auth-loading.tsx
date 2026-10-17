import { CratonLogo } from "@/components/craton-logo";
import { DotPattern } from "@/components/ui/dot-pattern";
import { SquareSpinner } from "@/components/ui/square-spinner";
import { cn } from "@/lib/utils";

// Loading state for the standalone sign-in pages. They have no site header or footer, so falling
// back to the app's PageLoading would flash a dashboard-looking screen behind a login form. This
// keeps the page's own background, and for sign-in/sign-up the logo where it will be, with a
// spinner in place of the form.
export function AuthLoading({ branded = false }: { branded?: boolean }) {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-background px-4 py-12">
      {branded && (
        <>
          <DotPattern className={cn("text-foreground/20 mask-[radial-gradient(480px_circle_at_center,white,transparent)]")} width={24} height={24} />
          <div className="relative mb-8">
            <CratonLogo className="text-xl" />
          </div>
        </>
      )}
      <div className={cn("relative flex w-full max-w-sm items-center justify-center", branded ? "min-h-84" : "min-h-48")}>
        <SquareSpinner size={24} />
      </div>
    </main>
  );
}
