import { SquareSpinner } from "@/components/ui/square-spinner";

// For loading.tsx in a route segment whose layout already renders the persistent chrome
// (AppShell, RepoHeader): wrapping in AppShell again here would double it up while the tab
// content streams in. Use PageLoading instead for a segment with no such layout.
export function ContentLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-24">
      <SquareSpinner size={28} />
    </div>
  );
}
