import { AppShell } from "@/components/app-shell";
import { SettingsNav } from "@/components/settings-nav";

// The frame for every account-settings page. The window itself doesn't scroll: the header and the
// sidebar stay put, and only the pane on the right moves. Going from one page to another replaces
// that pane alone (see loading.tsx next to this file), so nothing around it reloads or jumps.
// The content sits in the middle of the space beside the sidebar, with the same margin on both sides.
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppShell fixed>
      <div className="grid min-h-0 flex-1 grid-cols-1 max-md:overflow-y-auto md:grid-cols-[280px_1fr]">
        <div className="py-6 pl-6 pr-4 md:min-h-0 md:overflow-y-auto">
          <SettingsNav />
        </div>
        <div className="md:min-h-0 md:overflow-y-auto">
          <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:w-[78%] lg:px-0">{children}</div>
        </div>
      </div>
    </AppShell>
  );
}
