import type { Metadata } from "next";
import { AuthShell, AuthTitle } from "@/components/auth-shell";
import { UnsubscribeButton } from "./unsubscribe-button";

export const metadata: Metadata = { title: "Stop the weekly email", robots: { index: false, follow: false } };

/**
 * The link in every weekly summary. It does nothing on its own (mail scanners open links): the person presses a button, and
 * that call carries the signed token from the link, so no sign-in is needed.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <AuthShell>
      <AuthTitle title="Stop the weekly email?" subtitle="You can turn it back on any time in Settings → Profile." />
      {token ? <UnsubscribeButton token={token} /> : <p className="text-[14px] text-foreground/50">This link is incomplete. Turn the weekly email off in Settings → Profile.</p>}
    </AuthShell>
  );
}
