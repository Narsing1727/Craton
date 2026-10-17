import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SettingsView } from "./settings-view";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const [{ tab }, user] = await Promise.all([searchParams, requireUser("/settings")]);
  // Older links (and emails) point at /settings?tab=security.
  if (tab === "security") redirect("/settings/security");
  return (
    <SettingsView
      tab="profile"
      profile={user ? { handle: user.handle, name: user.name, email: user.email, bio: user.bio, emailVerified: user.emailVerified, digest: user.digest ?? "off" } : null}
      sessions={[]}
      twoFactor={null}
    />
  );
}
