import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  CircleCheck,
  CircleDot,
  Eye,
  Keyboard,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitPullRequest,
  HardDrive,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  Tag,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RepoList } from "@/components/repo-list";
import { DataList, DataRow, Initials, PageHeader, Section, StatGrid, StatTile, StatusBadge } from "@/components/craton-ui";
import { SlidingNumber } from "@/components/ui/sliding-number";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Progress } from "@/components/ui/progress";
import type { Activity } from "@/lib/data";
import { formatBytes, timeAgo } from "@/lib/format";
import { OpenInboxLink } from "@/components/inbox-bell";
import { loadActivity, loadAllIssues, loadAllPulls, loadChecks, loadRepos, loadUsage } from "@/lib/source";
import { api } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { GettingStarted, type ChecklistStep } from "@/components/getting-started";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Your repositories, reviews, checks and storage in one place.",
};

const activityIcons: Record<Activity["type"], typeof GitCommit> = {
  commit: GitCommit,
  branch: GitBranch,
  comment: MessageSquare,
  pr: GitPullRequest,
  mention: MessageSquare,
  release: Tag,
  issue: CircleDot,
  review: Eye,
};

type Attention = { href: string; status: "open" | "failed" | "changes-requested" | "approved"; title: string; ref: string; reason: string; time: string };

const shortcuts = [
  { keys: ["Ctrl", "K"], label: "Search or run a command" },
  { keys: ["g", "p"], label: "Your pull requests" },
  { keys: ["g", "i"], label: "Your issues" },
  { keys: ["?"], label: "All shortcuts" },
];

export default async function DashboardPage() {
  const user = await requireUser("/dashboard");
  const [usage, { repos, live }, { activity }, allPulls, allIssues, checklist, sharedRoles] = await Promise.all([
    loadUsage(),
    loadRepos(),
    loadActivity(60),
    loadAllPulls(),
    loadAllIssues(),
    api.checklist(),
    api.shared(),
  ]);
  let steps: ChecklistStep[] | null = null;

  // Until the numbers arrive from the API there is nothing to show, and nothing is invented in its place.
  let myRepos: typeof repos = [];
  let attention: Attention[] = [];
  let eyebrow = user?.handle ?? "";
  let stored = { value: "—", progress: 0, hint: "", used: "", limit: "" };
  let shared = { value: "—", note: "" };
  let repoHint = "";
  let checks = { text: "No checks yet.", link: "/dashboard", cta: "", pct: 100 };
  let pushes = { value: "0", n: 0, hint: "", delta: undefined as string | undefined };
  let feed: Activity[] = live ? activity : [];

  if (live && user && usage) {
    const me = user.handle;
    myRepos = repos.filter((r) => user.writableOwners.includes(r.owner));
    eyebrow = `${me} · ${usage.plan === "team" ? "Team" : "Free"} plan`;
    const percent = usage.limitBytes ? Math.round((usage.storedBytes / usage.limitBytes) * 1000) / 10 : 0;
    stored = {
      value: `${formatBytes(usage.storedBytes)} / ${formatBytes(usage.limitBytes)}`,
      progress: Math.max(percent, usage.storedBytes > 0 ? 1 : 0),
      hint: `${percent < 0.1 && usage.storedBytes > 0 ? "<0.1" : percent}% of your plan`,
      used: `${formatBytes(usage.storedBytes)} stored`,
      limit: `${formatBytes(usage.limitBytes)} limit`,
    };
    shared = {
      value: formatBytes(usage.sharedFreeBytes),
      note: `${formatBytes(usage.sharedFreeBytes)} of your data is shared with public repositories. It’s stored once and doesn’t count against your quota.`,
    };
    repoHint = `${usage.repositories.private} private · ${usage.repositories.public} public`;

    // Only repositories you can push to: public repos you can merely read aren't your work.
    const mine = new Set(myRepos.map((r) => `${r.owner}/${r.name}`));
    feed = activity.filter((a) => mine.has(a.repo)).slice(0, 8);

    // Needs attention: reviews you owe, your pull requests with requested changes, failing branches, issues assigned to you.
    const items: (Attention & { at: number })[] = [];
    for (const p of allPulls ?? []) {
      if (p.status === "merged" || p.status === "closed" || !mine.has(p.repo)) continue;
      const href = `/${p.repo}/pull/${p.id}`;
      if (p.author !== me && !p.reviewers?.includes(me)) {
        const ready = p.status === "approved" && p.checks === "passed";
        items.push({ href, status: ready ? "approved" : "open", title: p.title, ref: `#${p.id}`, reason: ready ? `Approved and checks pass · ready for your review or merge` : `Waiting for your review · opened by ${p.author}`, time: p.updated, at: 2 });
      } else if (p.author === me && p.status === "changes-requested") items.push({ href, status: "changes-requested", title: p.title, ref: `#${p.id}`, reason: "Your pull request needs changes", time: p.updated, at: 1 });
    }
    const failing: { repo: string; branch: string; steps: string[]; sha: string; at: string }[] = [];
    let passed = 0, total = 0;
    for (const r of myRepos) {
      const runs = (await loadChecks(r.owner, r.name)) ?? [];
      const latest = new Map<string, (typeof runs)[number]>();
      for (const run of runs) if (!latest.has(run.branch)) latest.set(run.branch, run);
      for (const run of latest.values()) {
        if (run.status === "failed") failing.push({ repo: `${r.owner}/${r.name}`, branch: run.branch, steps: run.steps.filter((s) => s.status === "failed").map((s) => s.name.toLowerCase()), sha: run.commit, at: run.createdAt });
      }
      const week = Date.now() - 7 * 86_400_000;
      for (const run of runs) if (Date.parse(run.createdAt) >= week) {
        total++;
        if (run.status === "passed") passed++;
      }
    }
    for (const f of failing) items.push({ href: `/${f.repo}/checks`, status: "failed", title: `Checks failing on ${f.branch}`, ref: f.sha.slice(0, 7), reason: `${f.steps.join(", ")} · ${f.repo}`, time: timeAgo(f.at), at: 3 });
    for (const i of allIssues ?? []) {
      if (i.status === "open" && i.assignee === me && mine.has(i.repo)) items.push({ href: `/${i.repo}/issues/${i.id}`, status: "open", title: i.title, ref: `#${i.id}`, reason: `Assigned to you · ${i.label}`, time: i.updated, at: 4 });
    }
    attention = items.sort((a, b) => a.at - b.at).slice(0, 6);
    const checksPct = total ? Math.round((passed / total) * 100) : 100;
    checks = failing.length
      ? { text: `${passed} of ${total} checks passed in the last 7 days.`, link: `/${failing[0].repo}/checks`, cta: `Review the ${failing.length} failing ${failing.length === 1 ? "branch" : "branches"} →`, pct: checksPct }
      : { text: `${passed} of ${total} checks passed in the last 7 days.`, link: myRepos[0] ? `/${myRepos[0].owner}/${myRepos[0].name}/checks` : "/dashboard", cta: "All checks →", pct: checksPct };
    const allActivity = (await loadActivity(200)).activity;
    const pushCount = allActivity.filter((a) => a.type === "commit" && a.actor === me).length;
    pushes = { value: pushCount.toLocaleString("en-US"), n: pushCount, hint: "By you, across your repositories", delta: undefined };

    // Getting started: what each step means, and where to do it.
    const done = new Map((checklist ?? []).map((c) => [c.id, c.done]));
    const firstRepo = myRepos[0];
    const openPull = (allPulls ?? []).find((p) => p.status !== "merged" && p.status !== "closed" && myRepos.some((r) => `${r.owner}/${r.name}` === p.repo));
    steps = [
      { id: "account", title: "Create your account", body: "", href: "/settings", cta: "Settings", done: true },
      { id: "repository", title: "Create a repository", body: "Name one for your project, then push your files from the command line.", href: "/new", cta: "New repository", done: Boolean(done.get("repository")) },
      {
        id: "merge",
        title: "Review and merge a pull request",
        body: "See exactly which chunks a change touched and whether its checks passed, then merge it.",
        href: openPull ? `/${openPull.repo}/pull/${openPull.id}` : "/pulls",
        cta: openPull ? `Open #${openPull.id}` : "Pull requests",
        done: Boolean(done.get("merge")),
      },
      { id: "cli", title: "Connect the command line", body: "Create a token and sign the CLI in. Large files move through it.", href: "/settings/tokens", cta: "Create a token", done: Boolean(done.get("cli")) },
      {
        id: "push",
        title: "Push a change from your machine",
        body: "Edit a file in QGIS or HEC-RAS, commit, push. Only the chunks you changed are uploaded.",
        href: firstRepo ? `/cli` : "/cli",
        cta: "How to push",
        done: Boolean(done.get("push")),
      },
    ];
  }
  const firstName = user?.name?.split(" ")[0];
  const sharedKeys = new Set((sharedRoles ?? []).map((s) => `${s.owner}/${s.name}`));
  const sharedRepos = live ? repos.filter((r) => sharedKeys.has(`${r.owner}/${r.name}`)) : [];
  const isNew = live && myRepos.length === 0 && sharedRepos.length === 0;

  // From 80% of the plan's storage the dashboard says so, plainly, and what will and won't happen at the limit.
  const storagePercent = live && usage && usage.limitBytes ? (usage.storedBytes / usage.limitBytes) * 100 : 0;

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-8 px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
        {storagePercent >= 80 && usage && (
          <div role="status" className="flex flex-wrap items-center justify-between gap-3 border border-border bg-card px-4 py-3 text-sm">
            <p className="text-pretty">
              {storagePercent >= 100
                ? `You are at your storage limit (${formatBytes(usage.storedBytes)} of ${formatBytes(usage.limitBytes)}). New data is refused until you free space or upgrade; nothing has been deleted.`
                : `You have used ${Math.floor(storagePercent)}% of your storage (${formatBytes(usage.storedBytes)} of ${formatBytes(usage.limitBytes)}). Nothing is deleted at the limit; new data is refused.`}
            </p>
            <Button variant="outline" size="sm" href="/settings/billing">See usage</Button>
          </div>
        )}
        <PageHeader
          eyebrow={eyebrow}
          title={isNew && firstName ? `Welcome, ${firstName}` : "Dashboard"}
          description={
            isNew
              ? "Your workspace is ready. Create a repository to start versioning terrain, vectors and model files."
              : "Reviews waiting on you, checks that failed, and what changed across your repositories."
          }
          actions={
            <>
              <Button variant="outline" href="/cli">
                <Upload data-icon="inline-start" />
                Install the CLI
              </Button>
              <Button href="/new">
                <Plus data-icon="inline-start" />
                New repository
              </Button>
            </>
          }
        />

        {user && steps && <GettingStarted handle={user.handle} steps={steps} />}

        <StatGrid>
          <StatTile
            label="Stored after deduplication"
            value={stored.value}
            progress={stored.progress}
            hint={stored.hint}
            icon={HardDrive}
            href="/settings/billing"
          />
          <StatTile label="Shared, not billed" value={shared.value} hint="Public chunks you reference for free" icon={Layers} />
          <StatTile label="Repositories" value={myRepos.length} hint={repoHint} icon={FolderGit2} />
          <StatTile label={live ? "Pushes" : "Syncs this month"} value={<SlidingNumber value={pushes.n} />} delta={pushes.delta ? { value: pushes.delta } : undefined} hint={pushes.hint} icon={RefreshCw} />
        </StatGrid>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_340px]">
          <div className="flex min-w-0 flex-col gap-8">
            <Section
              title="Needs your attention"
              description="Reviews, failed checks and issues assigned to you."
              action={
                <Button variant="ghost" size="sm" href="/pulls">
                  All pull requests
                  <ArrowRight data-icon="inline-end" />
                </Button>
              }
            >
              {attention.length === 0 && (
                <p className="border border-dashed border-border p-4 text-sm text-muted-foreground text-pretty">
                  Nothing needs you right now. Review requests, failing checks and issues assigned to you show up here.
                </p>
              )}
              <DataList label="Needs your attention">
                {attention.map((a) => (
                  <DataRow
                    key={a.href}
                    href={a.href}
                    leading={<div className="w-28 sm:w-36"><StatusBadge status={a.status} /></div>}
                    title={
                      <>
                        <span className="truncate">{a.title}</span>
                        <span className="font-mono text-xs font-normal text-muted-foreground">{a.ref}</span>
                      </>
                    }
                    subtitle={a.reason}
                    trailing={<span className="hidden sm:inline">{a.time}</span>}
                  />
                ))}
              </DataList>
            </Section>

            <Section title="Your repositories" description="Everything you own or maintain.">
              <RepoList repos={myRepos} />
            </Section>

            {sharedRepos.length > 0 && (
              <Section title="Shared with you" description="Repositories other people gave you access to.">
                <RepoList repos={sharedRepos} />
              </Section>
            )}
          </div>

          <aside className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Storage</h2>
                <Link href="/settings/billing" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  Plan and usage
                </Link>
              </div>
              <div className="flex justify-between font-mono text-xs tabular-nums">
                <span>{stored.used}</span>
                <span className="text-muted-foreground">{stored.limit}</span>
              </div>
              <Progress value={stored.progress} aria-label={`${stored.hint.replace(" of your plan", "")} of storage used`} />
              <p className="text-xs text-muted-foreground text-pretty">{shared.note}</p>
            </div>

            <div className="flex flex-col gap-2 border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <CircleCheck className="size-4 text-chart-1" aria-hidden />
                Checks
              </h2>
              <Meter value={checks.pct} aria-label="Checks passed">
                <MeterTrack className="h-1.5">
                  <MeterIndicator />
                </MeterTrack>
              </Meter>
              <p className="text-xs text-muted-foreground tabular-nums">{checks.text}</p>
              <Link href={checks.link} className="text-xs text-foreground hover:underline">
                {checks.cta}
              </Link>
            </div>

            <div className="flex flex-col gap-3 border border-border bg-card p-4">
              <h2 className="text-sm font-semibold">Recent activity</h2>
              <ol className="flex flex-col">
                {feed.length === 0 && <li className="text-xs text-muted-foreground">No activity yet. Pushes, reviews and releases in your repositories appear here.</li>}
                {feed.map((a, i) => {
                  const Icon = activityIcons[a.type];
                  return (
                    <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                      {i < feed.length - 1 && (
                        <span className="absolute left-3 top-7 bottom-0 w-px bg-border" aria-hidden />
                      )}
                      <Initials name={a.actor} />
                      <div className="min-w-0 flex-1 text-xs">
                        <p className="text-muted-foreground text-pretty">
                          <span className="font-medium text-foreground">{a.actor}</span>{" "}
                          {a.href ? (
                            <Link href={a.href} className="hover:text-foreground hover:underline">
                              {a.text}
                            </Link>
                          ) : (
                            a.text
                          )}{" "}
                          <Link href={`/${a.repo}`} className="text-foreground underline decoration-muted-foreground/50 underline-offset-2 hover:decoration-foreground">
                            {a.repo}
                          </Link>
                        </p>
                        <span className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Icon className="size-3" aria-hidden />
                          {a.time}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
              <OpenInboxLink className="cursor-pointer self-start text-xs text-muted-foreground hover:text-foreground hover:underline">See all notifications</OpenInboxLink>
            </div>

            <div className="flex flex-col gap-2 border border-border bg-card p-4">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Keyboard className="size-4 text-muted-foreground" aria-hidden />
                Keyboard shortcuts
              </h2>
              <ul className="flex flex-col gap-2 text-xs">
                {shortcuts.map((s) => (
                  <li key={s.label} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
