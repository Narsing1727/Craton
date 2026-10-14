"use client";

import { useState } from "react";
import { createOrgAction } from "@/app/actions";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Check, Shield, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/button-status";

export default function NewOrgPage() {
  const router = useRouter();
  const [orgName, setOrgName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const slug = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!orgName.trim()) {
      notify.error("Please enter an organization name");
      return;
    }
    if (!slug) {
      notify.error("Use letters or numbers in the name");
      return;
    }
    setSubmitting(true);
    const result = await createOrgAction(slug, orgName.trim());
    if (!result.ok) {
      setSubmitting(false);
      notify.error("Couldn’t create the organization", { description: result.error });
      return;
    }
    notify.success(`Created ${orgName.trim()}`, { description: `/orgs/${slug}` });
    router.push(`/orgs/${slug}`);
  }

  return (
    <AppShell>
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-8 max-w-3xl mx-auto">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="size-3.5" />
          Back to dashboard
        </Link>

        <h1 className="font-serif text-3xl font-semibold">Set up your organization</h1>
        <p className="mt-2 text-muted-foreground text-sm">
          Organizations allow your team to collaborate across shared datasets, projects, and custom access permissions.
        </p>

        <form onSubmit={handleCreate} className="mt-8 flex flex-col gap-6">
          <Card>
            <CardHeader className="p-5 pb-2">
              <CardTitle className="text-base font-semibold">Organization details</CardTitle>
              <CardDescription>This will be visible on your team&apos;s repositories and profiles.</CardDescription>
            </CardHeader>
            <CardContent className="p-5 flex flex-col gap-4">
              <div>
                <label htmlFor="org-name" className="block text-xs font-medium text-muted-foreground mb-1">
                  Organization name
                </label>
                <Input
                  id="org-name"
                  placeholder="e.g. Deltares Hydro, CWC River Basin Lab"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Its page will be <span className="font-mono text-foreground font-medium">/orgs/{slug || "your-org"}</span>, and its repositories {slug || "your-org"}/&lt;name&gt;.
                </p>
              </div>

            </CardContent>
          </Card>

          <p className="text-xs text-muted-foreground text-pretty">
            New organizations start on the Free plan. Its limits are on the{" "}
            <Link href="/pricing" className="underline underline-offset-2 hover:text-foreground">
              pricing page
            </Link>
            ; paid plans aren’t available yet.
          </p>

          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" loading={submitting} disabled={submitting || !orgName.trim()}>
              <Building2 data-icon="inline-start" />
              Create organization
            </Button>
            <Link
              href="/dashboard"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-transparent px-3 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
