import { AppShell } from "@/components/app-shell";
import { SquareSpinner } from "@/components/ui/square-spinner";

// Route-level loading.tsx content: the real header renders immediately since
// AppShell needs none of the page's own data, so only the content area waits on a spinner —
// nothing here guesses at a layout the real page may not end up having.
export function PageLoading() {
  return (
    <AppShell loading>
      <div className="flex flex-1 items-center justify-center py-24">
        <SquareSpinner size={28} />
      </div>
    </AppShell>
  );
}
