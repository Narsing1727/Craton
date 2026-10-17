"use client";

// Organization settings → Single sign-on: connect the organization's own OpenID Connect provider, test it by signing in
// once, then (optionally) require it of everyone who is not an owner.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { notify } from "@/components/button-status";
import { CopyButton } from "@/components/craton-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { removeSsoAction, saveSsoAction, setSsoEnforcedAction } from "@/app/actions";
import type { ApiOrgSso } from "@/lib/api";

export function OrgSso({ org, initial }: { org: string; initial: ApiOrgSso }) {
  const router = useRouter();
  const [sso, setSso] = useState(initial);
  const [issuer, setIssuer] = useState(initial.issuer ?? "");
  const [clientId, setClientId] = useState(initial.clientId ?? "");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const noDomain = sso.domains.length === 0;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveSsoAction(org, { issuer: issuer.trim(), clientId: clientId.trim(), clientSecret: secret || undefined });
      if (!r.ok) return void setError(r.error);
      setSso(r.data);
      setSecret("");
      notify.success("Single sign-on saved", { description: "Sign in through it once yourself to test it." });
      router.refresh();
    });
  }

  function enforce(on: boolean) {
    start(async () => {
      const r = await setSsoEnforcedAction(org, on);
      if (!r.ok) return void notify.error("Couldn’t change that", { description: r.error });
      setSso(r.data);
      notify.success(on ? "Single sign-on is now required" : "Single sign-on is optional again");
    });
  }

  function remove() {
    start(async () => {
      const r = await removeSsoAction(org);
      if (!r.ok) return void notify.error("Couldn’t remove it", { description: r.error });
      setSso({ configured: false, redirectUri: sso.redirectUri, domains: sso.domains });
      setIssuer("");
      setClientId("");
      notify.info("Single sign-on removed. People keep their accounts.");
      router.refresh();
    });
  }

  if (noDomain) {
    return <p className="text-sm text-muted-foreground text-pretty">Verify a domain above first. Single sign-on only applies to addresses at a domain {org} has proved it controls, so the provider can never vouch for anyone else’s address.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 border border-border bg-muted/30 p-3 text-xs">
        <p className="text-pretty text-muted-foreground">In your identity provider (Microsoft Entra ID, Okta, Keycloak, Google Workspace…) create an OpenID Connect web application with this redirect URI, then paste what it gives you below.</p>
        <div className="flex items-center justify-between gap-2">
          <code className="select-all break-all font-mono">{sso.redirectUri}</code>
          <CopyButton value={sso.redirectUri} label="Copy redirect URI" variant="ghost" size="sm" />
        </div>
      </div>

      <form onSubmit={save} className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Issuer</span>
          <Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="https://login.microsoftonline.com/<tenant>/v2.0" className="font-mono" required spellCheck={false} autoComplete="off" />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Client id</span>
            <Input value={clientId} onChange={(e) => setClientId(e.target.value)} className="font-mono" required spellCheck={false} autoComplete="off" />
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">Client secret</span>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={sso.hasSecret ? "Saved. Leave empty to keep it." : ""} className="font-mono" required={!sso.hasSecret} autoComplete="new-password" />
          </label>
        </div>
        {error && (
          <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={busy} disabled={busy || !issuer.trim() || !clientId.trim()}>
            {sso.configured ? "Save changes" : "Connect provider"}
          </Button>
          {sso.configured && (
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
      </form>

      {sso.configured && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-2 text-sm">
            {sso.testedAt ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" aria-hidden /> Tested
              </Badge>
            ) : (
              <Badge variant="outline">Not tested yet</Badge>
            )}
            <span className="text-xs text-muted-foreground text-pretty">
              {sso.testedAt ? "Someone has signed in through it." : `Sign out and use “Continue with single sign-on” with your ${sso.domains[0]} address.`}
            </span>
          </div>
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="text-xs">
              <span className="block text-sm font-medium">Require single sign-on</span>
              <span className="mt-0.5 block text-muted-foreground text-pretty">
                Members with a {sso.domains.join(" or ")} address can then only sign in through the provider (passwords, Google, GitHub and passkeys are refused for them). Owners are exempt so a broken provider can’t lock everyone out, and access tokens for the CLI keep working.
              </span>
            </span>
            <Switch checked={Boolean(sso.enforced)} onCheckedChange={(on) => enforce(Boolean(on))} disabled={busy || (!sso.testedAt && !sso.enforced)} aria-label="Require single sign-on" />
          </label>
        </div>
      )}
    </div>
  );
}
