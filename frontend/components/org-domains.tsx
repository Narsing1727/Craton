"use client";

// Organization settings → Domains: prove the organization controls a domain with a DNS TXT record, then (optionally) let
// anyone with a confirmed address there join as a Member.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Globe, Trash2 } from "lucide-react";
import { notify } from "@/components/button-status";
import { CopyButton } from "@/components/craton-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { addDomainAction, removeDomainAction, setDomainJoinAction, verifyDomainAction } from "@/app/actions";
import type { ApiOrgDomain } from "@/lib/api";

export function OrgDomains({ org, initial }: { org: string; initial: ApiOrgDomain[] }) {
  const router = useRouter();
  const [domains, setDomains] = useState(initial);
  const [draft, setDraft] = useState("");
  const [busy, start] = useTransition();
  const [checking, setChecking] = useState<string | null>(null);
  const [problem, setProblem] = useState<Record<string, string>>({});

  const replace = (d: ApiOrgDomain) => setDomains((all) => all.map((x) => (x.domain === d.domain ? d : x)));

  function add(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    start(async () => {
      const r = await addDomainAction(org, draft.trim());
      if (!r.ok) return void notify.error("Couldn’t add the domain", { description: r.error });
      setDomains((all) => [...all, r.data].sort((a, b) => a.domain.localeCompare(b.domain)));
      setDraft("");
    });
  }

  async function check(domain: string) {
    setChecking(domain);
    const r = await verifyDomainAction(org, domain);
    setChecking(null);
    if (!r.ok) return void setProblem((p) => ({ ...p, [domain]: r.error }));
    setProblem((p) => ({ ...p, [domain]: "" }));
    replace(r.data);
    notify.success(`${domain} is verified`);
    router.refresh();
  }

  function toggleJoin(domain: string, on: boolean) {
    start(async () => {
      const r = await setDomainJoinAction(org, domain, on);
      if (!r.ok) return void notify.error("Couldn’t change that", { description: r.error });
      replace(r.data);
      notify.success(on ? (r.data.joined ? `${r.data.joined} ${r.data.joined === 1 ? "person" : "people"} with a ${domain} address joined` : `People with a confirmed ${domain} address will join as Members`) : "Joining by email address is off");
      router.refresh();
    });
  }

  function remove(domain: string) {
    start(async () => {
      const r = await removeDomainAction(org, domain);
      if (!r.ok) return void notify.error("Couldn’t remove it", { description: r.error });
      setDomains((all) => all.filter((x) => x.domain !== domain));
      notify.info(`${domain} removed. People who joined through it stay.`);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {domains.length === 0 && <p className="text-sm text-muted-foreground">No domains yet. Add the domain your team’s email addresses use.</p>}
      <ul className="flex flex-col gap-3">
        {domains.map((d) => (
          <li key={d.domain} className="border border-border">
            <div className="flex flex-wrap items-center justify-between gap-3 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate font-mono text-sm">{d.domain}</span>
                {d.verified ? (
                  <Badge variant="secondary" className="gap-1">
                    <BadgeCheck className="size-3" aria-hidden /> Verified
                  </Badge>
                ) : (
                  <Badge variant="outline">Not verified</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!d.verified && (
                  <Button size="sm" onClick={() => void check(d.domain)} loading={checking === d.domain} disabled={checking === d.domain}>
                    Check now
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => remove(d.domain)} disabled={busy} aria-label={`Remove ${d.domain}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
            {!d.verified && d.record && (
              <div className="flex flex-col gap-2 border-t border-border bg-muted/30 p-3 text-xs">
                <p className="text-pretty text-muted-foreground">Add this TXT record at your DNS provider, then press Check now. DNS changes can take a few minutes.</p>
                <div className="grid gap-1 sm:grid-cols-[4rem_1fr_auto] sm:items-center">
                  <span className="text-muted-foreground">Name</span>
                  <code className="select-all break-all font-mono">{d.record.name}</code>
                  <CopyButton value={d.record.name} label="Copy name" variant="ghost" size="sm" />
                  <span className="text-muted-foreground">Value</span>
                  <code className="select-all break-all font-mono">{d.record.value}</code>
                  <CopyButton value={d.record.value} label="Copy value" variant="ghost" size="sm" />
                </div>
                {problem[d.domain] && (
                  <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2 text-destructive text-pretty">
                    {problem[d.domain]}
                  </p>
                )}
              </div>
            )}
            {d.verified && (
              <label className="flex cursor-pointer items-start justify-between gap-4 border-t border-border p-3">
                <span className="text-xs">
                  <span className="block text-sm font-medium">Let people with a {d.domain} address join</span>
                  <span className="mt-0.5 block text-muted-foreground text-pretty">
                    Anyone whose <em>confirmed</em> email address ends in @{d.domain} becomes a Member, now and whenever they confirm or sign in. An address nobody has confirmed never counts.
                  </span>
                </span>
                <Switch checked={d.autoJoin} onCheckedChange={(on) => toggleJoin(d.domain, Boolean(on))} disabled={busy} aria-label={`Let people with a ${d.domain} address join`} />
              </label>
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex flex-wrap items-center gap-2">
        <Input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="hydrolab.org" aria-label="Domain to add" className="max-w-xs font-mono" autoComplete="off" spellCheck={false} />
        <Button type="submit" size="sm" variant="outline" loading={busy} disabled={busy || !draft.trim()}>
          Add domain
        </Button>
      </form>
    </div>
  );
}
