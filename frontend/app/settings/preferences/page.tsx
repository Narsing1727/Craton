import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ThemeChoice } from "@/components/theme-choice";
import { UnitsChoice } from "@/components/units-choice";
import { BrowserPreferences } from "@/components/browser-preferences";
import { NewRepoDefaults } from "@/components/new-repo-defaults";

export const metadata: Metadata = { title: "Preferences · Settings" };

export default async function PreferencesSettingsPage() {
  const user = await requireUser("/settings/preferences");
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight">Preferences</h2>
        <p className="mt-2 text-base text-muted-foreground">How Craton looks and behaves for you.</p>
      </div>
      <div className="flex flex-col gap-4">
        <ThemeChoice />
        <UnitsChoice />
        <BrowserPreferences />
        <NewRepoDefaults initial={user?.defaultVisibility ?? "public"} live={Boolean(user)} />
      </div>
    </div>
  );
}
