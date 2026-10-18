"use client";

// Organization settings → Single sign-on (SAML 2.0): the two addresses to give the identity provider, then what it gives back (its
// sign-in URL, its entity ID, its signing certificate). Test it by signing in once, then (optionally) require it of everyone who is
// not an owner. Works like the OpenID Connect card above it; an organization uses one or the other.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { notify } from "@/components/button-status";
import { CopyButton } from "@/components/craton-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { removeSamlAction, saveSamlAction, setSamlEnforcedAction } from "@/app/actions";
import type { ApiOrgSaml } from "@/lib/api";

export function OrgSaml({ org, initial }: { org: string; initial: ApiOrgSaml }) {
  const router = useRouter();
  const [saml, setSaml] = useState(initial);
  const [ssoUrl, setSsoUrl] = useState(initial.ssoUrl ?? "");
  const [entityId, setEntityId] = useState(initial.entityId ?? "");
  const [certificate, setCertificate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  if (saml.domains.length === 0) {
    return <p className="text-sm text-muted-foreground text-pretty">Verify a domain above first. Single sign-on only applies to addresses at a domain {org} has proved it controls, so the provider can’t vouch for anyone else.</p>;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const r = await saveSamlAction(org, { ssoUrl: ssoUrl.trim(), entityId: entityId.trim(), certificate: certificate.trim() || undefined });
      if (!r.ok) return void setError(r.error);
      setSaml(r.data);
      setCertificate("");
      notify.success("SAML saved", { description: "Sign in through it once yourself to test it." });
      router.refresh();
    });
  }

  function enforce(on: boolean) {
    start(async () => {
      const r = await setSamlEnforcedAction(org, on);
      if (!r.ok) return void notify.error("Couldn’t change that", { description: r.error });
      setSaml(r.data);
      notify.success(on ? "Single sign-on is now required" : "Single sign-on is optional again");
    });
  }

  function remove() {
    start(async () => {
      const r = await removeSamlAction(org);
      if (!r.ok) return void notify.error("Couldn’t remove it", { description: r.error });
      setSaml({ configured: false, sp: saml.sp, domains: saml.domains });
      setSsoUrl("");
      setEntityId("");
      notify.info("SAML removed. People keep their accounts.");
      router.refresh();
    });
  }

  const row = (label: string, value: string) => (
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0">
        <span className="block text-muted-foreground">{label}</span>
        <code className="select-all break-all font-mono">{value}</code>
      </span>
      <CopyButton value={value} label={`Copy ${label}`} variant="ghost" size="sm" />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 border border-border bg-muted/30 p-3 text-xs">
        <p className="text-pretty text-muted-foreground">In your identity provider create a SAML 2.0 application with these values (or import the metadata address). Send the email address in an attribute called <code className="font-mono">email</code>, or as the name ID.</p>
        {row("Single sign-on (ACS) URL", saml.sp.acsUrl)}
        {row("Entity ID (audience)", saml.sp.entityId)}
        {saml.configured && row("Metadata address", saml.sp.metadataUrl)}
      </div>

      <form onSubmit={save} className="grid gap-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Identity provider sign-in URL</span>
          <Input value={ssoUrl} onChange={(e) => setSsoUrl(e.target.value)} placeholder="https://yourcompany.okta.com/app/…/sso/saml" className="font-mono" required spellCheck={false} autoComplete="off" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Identity provider entity ID (issuer)</span>
          <Input value={entityId} onChange={(e) => setEntityId(e.target.value)} placeholder="http://www.okta.com/exk…" className="font-mono" required spellCheck={false} autoComplete="off" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs font-medium text-muted-foreground">Signing certificate</span>
          <textarea
            value={certificate}
            onChange={(e) => setCertificate(e.target.value)}
            rows={5}
            spellCheck={false}
            required={!saml.configured}
            placeholder={saml.configured ? "Saved. Paste a new one only to replace it." : "-----BEGIN CERTIFICATE-----"}
            className="border border-input bg-transparent p-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {error && (
          <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" loading={busy} disabled={busy || !ssoUrl.trim() || !entityId.trim()}>
            {saml.configured ? "Save changes" : "Connect provider"}
          </Button>
          {saml.configured && (
            <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
              Remove
            </Button>
          )}
        </div>
      </form>

      {saml.configured && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {saml.testedAt ? (
              <Badge variant="secondary" className="gap-1">
                <CheckCircle2 className="size-3" aria-hidden /> Tested
              </Badge>
            ) : (
              <Badge variant="outline">Not tested yet</Badge>
            )}
            <span className="text-xs text-muted-foreground text-pretty">
              {saml.testedAt ? "Someone has signed in through it." : `Sign out and use “Continue with single sign-on” with your ${saml.domains[0]} address.`}
            </span>
            {saml.certificateExpires && <span className="ml-auto text-xs text-muted-foreground">Certificate expires {new Date(saml.certificateExpires).toLocaleDateString()}</span>}
          </div>
          <label className="flex cursor-pointer items-start justify-between gap-4">
            <span className="text-xs">
              <span className="block text-sm font-medium">Require single sign-on</span>
              <span className="mt-0.5 block text-muted-foreground text-pretty">
                Members with a {saml.domains.join(" or ")} address can then only sign in through the provider. Owners are exempt so a broken provider can’t lock everyone out.
              </span>
            </span>
            <Switch checked={Boolean(saml.enforced)} onCheckedChange={(on) => enforce(Boolean(on))} disabled={busy || (!saml.testedAt && !saml.enforced)} aria-label="Require single sign-on" />
          </label>
        </div>
      )}
    </div>
  );
}
