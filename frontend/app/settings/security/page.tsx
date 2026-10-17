import type { Metadata } from "next";
import { SettingsView } from "../settings-view";
import { requireUser } from "@/lib/auth";
import { api } from "@/lib/api";

export const metadata: Metadata = { title: "Security · Settings" };

export default async function SecuritySettingsPage() {
  const user = await requireUser("/settings/security");
  const [sessions, twoFactor, events, identities, passkeys] = user ? await Promise.all([api.sessions(), api.twoFactor(), api.securityLog(), api.identities(), api.passkeys()]) : [null, null, null, null, null];
  return (
    <SettingsView
      tab="security"
      profile={user ? { handle: user.handle, name: user.name, email: user.email, bio: user.bio, website: user.website, location: user.location, company: user.company, pronouns: user.pronouns, hasAvatar: user.hasAvatar, emailVerified: user.emailVerified, digest: user.digest ?? "off" } : null}
      sessions={sessions ?? []}
      twoFactor={twoFactor}
      events={events ?? []}
      identities={identities}
      passkeys={passkeys}
    />
  );
}
