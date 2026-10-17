import Link from "next/link";
import { FolderGit2, HardDrive, Layers, Plus, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrgHeader } from "@/components/org-header";
import { Initials, Section, StatGrid, StatTile } from "@/components/craton-ui";
import { RepoList } from "@/components/repo-list";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";
import { repos as demoRepos, orgMembers, activityFeed } from "@/lib/data";
import { formatBytes } from "@/lib/format";
import { loadActivity, loadOwner, noData } from "@/lib/source";

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }): Promise<Metadata> {
  const { org } = await params;
  const owner = await loadOwner(org);
  return { title: owner?.name ?? org, description: owner?.bio };
}

export default async function OrgPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const [owner, usage, { activity, live }] = await Promise.all([loadOwner(org), api.ownerUsage(org), loadActivity(60)]);
  if (!owner) await noData();
  if (owner && owner.kind === "user") redirect(`/${owner.handle}`);

  const orgRepos = owner ? owner.repositories : demoRepos.filter((r) => r.owner === org);
  const shown = owner ? orgRepos : orgRepos.length ? orgRepos : demoRepos.slice(0, 4);
  const members = owner?.members ?? orgMembers;
  const feed = (live ? activity.filter((a) => a.repo.startsWith(`${org}/`)) : activityFeed).slice(0, 4);
  const storedPct = usage && usage.limitBytes ? Math.round((usage.storedBytes / usage.limitBytes) * 1000) / 10 : 34;
  const stored = usage
    ? { value: formatBytes(usage.storedBytes), progress: Math.max(storedPct, usage.storedBytes ? 1 : 0), hint: `of ${formatBytes(usage.limitBytes)} on the ${usage.plan === "team" ? "Team" : "Free"} plan` }
    : { value: "34 GB", progress: 34, hint: "of 100 GB on the Team plan" };
  const shared = usage ? formatBytes(usage.sharedFreeBytes) : "1.1 TB";

  return (
    <AppShell>
      <OrgHeader org={org} />
      <div className="flex w-full flex-col gap-8 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <StatGrid>
          <StatTile label="Repositories" value={shown.length} hint={`${shown.filter((r) => r.visibility === "private").length} private`} icon={FolderGit2} />
          <StatTile label="Members" value={members.length} hint={owner ? `${members.filter((m) => m.role !== "Member").length} admins` : "2 teams"} icon={Users} href={`/orgs/${org}/people`} />
          <StatTile label="Stored" value={stored.value} progress={stored.progress} hint={stored.hint} icon={HardDrive} href="/settings/billing" />
          <StatTile label="Shared, not billed" value={shared} hint="Public chunks the team references" icon={Layers} />
        </StatGrid>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_320px]">
          <Section
            title="Repositories"
            action={
              <Button size="sm" href="/new">
                <Plus data-icon="inline-start" />
                New repository
              </Button>
            }
          >
            <RepoList repos={shown} />
          </Section>

          <aside className="flex flex-col gap-6">
            <Section
              title="People"
              action={
                <Link href={`/orgs/${org}/people`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  Manage
                </Link>
              }
            >
              <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                {members.map((m) => (
                  <li key={m.handle}>
                    <Link href={`/${m.handle}`} className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-muted/30">
                      <Initials name={m.handle} className="size-7" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{m.name}</span>
                        <span className="block text-xs text-muted-foreground">@{m.handle}</span>
                      </span>
                      <Badge variant="outline" className="text-[10px]">{m.role}</Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Recent activity">
              <ul className="flex flex-col gap-3 text-xs">
                {feed.length === 0 && <li className="text-muted-foreground">No activity yet.</li>}
                {feed.map((a, i) => (
                  <li key={i} className="flex gap-2.5">
                    <Initials name={a.actor} />
                    <p className="text-muted-foreground text-pretty">
                      <span className="font-medium text-foreground">{a.actor}</span> {a.text}{" "}
                      <Link href={`/${a.repo}`} className="text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">{a.repo}</Link>
                      <span className="block text-[11px]">{a.time}</span>
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
