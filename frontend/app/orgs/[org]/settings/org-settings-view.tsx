"use client";

import { useState, useTransition } from "react";
import { notify } from "@/components/button-status";
import { Download, Save, Trash2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrgHeader } from "@/components/org-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TypeToConfirm } from "@/components/craton-actions";
import { deleteOrgAction, updateOrgAction } from "@/app/actions";
import { AuditLog } from "@/components/audit-log";
import { OrgDomains } from "@/components/org-domains";
import { OrgSso } from "@/components/org-sso";
import type { ApiAuditPage, ApiOrgDomain, ApiOrgSso } from "@/lib/api";

export function OrgSettingsView({ org, name, bio, role, repositories, audit, domains, sso, verified }: { org: string; name: string; bio: string; role: string | null; repositories: number; audit: ApiAuditPage | null; domains: ApiOrgDomain[] | null; sso: ApiOrgSso | null; verified: string[] }) {
  const owner = role === "Owner";
  const [displayName, setDisplayName] = useState(name);
  const [description, setDescription] = useState(bio);
  const [saved, setSaved] = useState({ name, bio });
  const [saving, startSave] = useTransition();
  const changed = displayName.trim() !== saved.name || description.trim() !== saved.bio;

  function save(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      const result = await updateOrgAction(org, { name: displayName.trim(), bio: description.trim() });
      if (!result.ok) return void notify.error("Couldn’t save", { description: result.error });
      setSaved({ name: result.data.name, bio: result.data.bio });
      notify.success("Organization profile saved");
    });
  }

  async function remove() {
    const result = await deleteOrgAction(org, org);
    // On success the action redirects; only failures come back.
    if (result && !result.ok) notify.error(`Couldn’t delete ${org}`, { description: result.error });
  }

  return (
    <AppShell>
      <OrgHeader org={org} domains={verified} />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <div className="flex flex-col gap-6">
          <div>
            <h1 className="text-xl font-semibold">Organization settings</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {owner ? "The name and description appear on the organization’s page and its repositories." : `Only owners of ${org} can change these${role ? `; you’re a ${role.toLowerCase()}` : ""}.`}
            </p>
          </div>

          <form onSubmit={save}>
            <Card>
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base font-semibold">Public profile</CardTitle>
                <CardDescription>
                  The handle <span className="font-mono">{org}</span> can’t be changed: it’s part of every repository’s address.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 p-5">
                <div>
                  <label htmlFor="org-name" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Display name
                  </label>
                  <Input id="org-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} required disabled={!owner} />
                </div>
                <div>
                  <label htmlFor="org-description" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Description
                  </label>
                  <Textarea id="org-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={280} disabled={!owner} />
                </div>
                {owner && (
                  <div className="pt-2">
                    <Button type="submit" size="sm" loading={saving} disabled={saving || !changed || !displayName.trim()}>
                      <Save data-icon="inline-start" /> Save profile
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </form>

          {owner && domains && (
            <Card>
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base font-semibold">Domains</CardTitle>
                <CardDescription>Prove {org} controls a domain and it shows as verified on the organization’s page. Optionally, people with a confirmed address there join as Members, with no invitations to send.</CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                <OrgDomains org={org} initial={domains} />
              </CardContent>
            </Card>
          )}

          {owner && sso && (
            <Card>
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base font-semibold">Single sign-on</CardTitle>
                <CardDescription>Let {org}’s people sign in with the organization’s own identity provider (OpenID Connect). People who sign in this way join {org} automatically.</CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                <OrgSso org={org} initial={sso} />
              </CardContent>
            </Card>
          )}

          {owner && audit && (
            <Card>
              <CardHeader className="p-5 pb-2">
                <CardTitle className="text-base font-semibold">Audit log</CardTitle>
                <CardDescription>Changes made under {org}, and attempts that were refused. Only owners can read this. Request contents are never kept.</CardDescription>
              </CardHeader>
              <CardContent className="p-5">
                <AuditLog scope={{ kind: "org", org }} initial={audit} csvHref={`/orgs/${org}/audit-log/export`} />
              </CardContent>
            </Card>
          )}

          {owner && repositories > 0 && (
            <Card className="p-5">
              <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                  <p className="text-sm font-semibold">Download everything</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">The default branch of each of {org}’s repositories as one ZIP, a folder per repository. Larger than 4 GB: use the CLI.</p>
                </div>
                <Button variant="outline" size="sm" render={<a href={`/orgs/${org}/export`} download />}>
                  <Download data-icon="inline-start" /> Download repositories (ZIP)
                </Button>
              </div>
            </Card>
          )}

          {owner && (
            <div className="flex flex-col gap-3 pt-4">
              <h2 className="text-base font-semibold text-destructive">Danger zone</h2>
              <Card className="border-destructive/40 bg-destructive/5 p-5">
                <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                  <div>
                    <p className="text-sm font-semibold text-destructive">Delete organization</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {repositories > 0
                        ? `${org} still has ${repositories} ${repositories === 1 ? "repository" : "repositories"}. Delete ${repositories === 1 ? "it" : "them"} first; Craton won’t delete data as a side effect.`
                        : "Removes the organization and everyone’s membership. This can’t be undone."}
                    </p>
                  </div>
                  <TypeToConfirm
                    trigger={
                      <Button variant="destructive" size="sm" disabled={repositories > 0}>
                        <Trash2 data-icon="inline-start" /> Delete organization
                      </Button>
                    }
                    title={`Delete ${org}?`}
                    description="Everyone loses access and the handle becomes available again. This can’t be undone."
                    expected={org}
                    confirmLabel="Delete organization"
                    onConfirm={remove}
                  />
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
