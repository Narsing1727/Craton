"use client";

// Organization settings → User provisioning: the address and tokens an identity provider (Okta, Microsoft Entra ID, OneLogin…) uses
// to add and remove the organization's people. A token is shown once, when it is made.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/button-status";
import { CopyButton } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createScimTokenAction, revokeScimTokenAction } from "@/app/actions";
import type { ApiOrgScim } from "@/lib/api";

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "never used");

export function OrgScim({ org, initial }: { org: string; initial: ApiOrgScim }) {
  const router = useRouter();
  const [scim, setScim] = useState(initial);
  const [note, setNote] = useState("");
  const [fresh, setFresh] = useState<{ token: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (scim.domains.length === 0) {
    return <p className="text-sm text-muted-foreground text-pretty">Verify a domain above first. Provisioning only accepts addresses at a domain {org} has proved it controls, so the provider can’t add people from anywhere else.</p>;
  }

  function make(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await createScimTokenAction(org, note.trim());
      if (!r.ok) return void setError(r.error);
      setFresh({ token: r.data.token });
      setNote("");
      setScim({ ...scim, tokens: [...scim.tokens, { id: r.data.id, note: r.data.note, createdAt: new Date().toISOString(), lastUsedAt: null }] });
      router.refresh();
    });
  }

  function revoke(id: number) {
    start(async () => {
      const r = await revokeScimTokenAction(org, id);
      if (!r.ok) return void notify.error("Couldn’t remove it", { description: r.error });
      setScim({ ...scim, tokens: scim.tokens.filter((t) => t.id !== id) });
      notify.info("Token removed. The provider that held it can no longer connect.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 border border-border bg-muted/30 p-3 text-xs">
        <p className="text-pretty text-muted-foreground">In your identity provider add a SCIM 2.0 application with this base URL and a token from below (authentication: HTTP header / Bearer token). Addresses at {scim.domains.join(", ")} can be provisioned.</p>
        <div className="flex items-center justify-between gap-2">
          <code className="select-all break-all font-mono">{scim.baseUrl}</code>
          <CopyButton value={scim.baseUrl} label="Copy base URL" variant="ghost" size="sm" />
        </div>
      </div>

      {fresh && (
        <div role="status" className="flex flex-col gap-2 border border-border bg-muted/30 p-3 text-xs">
          <p className="text-pretty">Copy this token now. It is not shown again.</p>
          <div className="flex items-center justify-between gap-2">
            <code className="select-all break-all font-mono">{fresh.token}</code>
            <CopyButton value={fresh.token} label="Copy token" variant="ghost" size="sm" />
          </div>
        </div>
      )}

      <form onSubmit={make} className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-48 flex-1 gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Token for</span>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Okta" maxLength={80} />
        </label>
        <Button type="submit" size="sm" loading={busy} disabled={busy || scim.tokens.length >= 5}>
          Make a token
        </Button>
      </form>
      {error && (
        <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
          {error}
        </p>
      )}

      {scim.tokens.length > 0 && (
        <ul className="flex flex-col divide-y divide-border border border-border text-sm">
          {scim.tokens.map((t) => (
            <li key={t.id} className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{t.note || "Provisioning token"}</span>
                <span className="block text-xs text-muted-foreground">Made {when(t.createdAt)} · last used {when(t.lastUsedAt)}</span>
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={() => revoke(t.id)} disabled={busy}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground text-pretty">{scim.provisioned} {scim.provisioned === 1 ? "person has" : "people have"} been provisioned. Removing someone in your directory removes them from {org}; their account stays. Owners are never removed this way.</p>
    </div>
  );
}
