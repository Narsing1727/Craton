import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { api } from "@/lib/api";
import { getSessionToken } from "@/lib/session";
import { AcceptInvite } from "./accept-invite";

export const metadata: Metadata = { title: "Invitation", robots: { index: false } };

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const preview = token ? await api.invitePreview(token) : null;
  const signedIn = Boolean(await getSessionToken());
  const here = `/invite?token=${encodeURIComponent(token ?? "")}`;
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-16">
        {!preview ? (
          <>
            <h1 className="text-2xl font-semibold tracking-tight">This invitation can’t be used</h1>
            <p className="text-sm text-muted-foreground">It has expired, was already used, or was withdrawn. Ask the person who invited you to send a new one.</p>
          </>
        ) : (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Join {preview.repo}</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                {preview.invitedBy} invited you with <strong className="font-medium text-foreground">{preview.role}</strong> access. The invitation was sent to{" "}
                <span className="font-mono">{preview.emailHint}</span>.
              </p>
            </div>
            {signedIn ? (
              <AcceptInvite token={token!} repo={preview.repo} />
            ) : (
              <div className="flex flex-col gap-3 border border-border p-4 text-sm">
                <p className="text-muted-foreground">
                  {preview.hasAccount ? "Sign in with the account that uses that address, then come back to this page." : "Create an account with that address, confirm it from the email we send, then come back to this page."}
                </p>
                <div className="flex gap-2">
                  <Link href={`/login?next=${encodeURIComponent(here)}`} className="inline-flex h-8 items-center border border-border px-3 hover:bg-muted">Sign in</Link>
                  <Link href={`/signup?next=${encodeURIComponent(here)}`} className="inline-flex h-8 items-center border border-border px-3 hover:bg-muted">Create an account</Link>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
