import type { Metadata } from "next";
import { SettingsView } from "../settings-view";
import { requireUser } from "@/lib/auth";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "Security · Settings" };

export default async function SecuritySettingsPage() {
  const user = await requireUser("/settings/security");
  const [sessions, twoFactor, events] = user ? await Promise.all([api.sessions(), api.twoFactor(), api.securityLog()]) : [null, null, null];
  return (
    <SettingsView
      tab="security"
      profile={user ? { handle: user.handle, name: user.name, email: user.email, bio: user.bio, emailVerified: user.emailVerified } : null}
      sessions={sessions ?? []}
      twoFactor={twoFactor}
      events={events ?? []}
    />
  );
}
