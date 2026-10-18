"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, CircleCheck, Clock, GitBranch, ShieldCheck, Timer, TriangleAlert } from "lucide-react";
import { CopyButton } from "@/components/craton-actions";
import { EmptyState, PageHeader, StatGrid, StatTile, StatusBadge, StatusIcon } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type Step = { name: string; status: "passed" | "failed" | "skipped"; detail: string; files?: string[] };
export type Run = {
  id: number;
  status: "passed" | "failed" | "running";
  message: string;
  sha: string;
  branch: string;
  actor: string;
  time: string;
  duration: string;
  pr?: number;
  steps: Step[];
};
export type ChecksStats = { passRate: string; passHint: string; failing: string; failingHint: string; median: string; medianHint: string; blocked: string; blockedHint: string };

export function ChecksView({
  owner,
  repo,
  runs,
  stats,
  config,
  configTitle,
}: {
  owner: string;
  repo: string;
  runs: Run[];
  stats: ChecksStats;
  config: string;
  configTitle: string;
}) {
  const base = `/${owner}/${repo}`;
  const [filter, setFilter] = useState<"all" | "failed" | "passed">("all");
  const [openId, setOpenId] = useState<number | null>(runs.find((r) => r.status === "failed")?.id ?? runs[0]?.id ?? null);
  const shown = runs.filter((r) => filter === "all" || r.status === filter);

  return (
    <>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <PageHeader
          title="Checks"
          description="Every push runs Craton’s validation gate. Failing CRS, datum or integrity checks block the merge."
        />

        <StatGrid>
          <StatTile label="Pass rate, 7 days" value={stats.passRate} hint={stats.passHint} icon={CircleCheck} />
          <StatTile label="Failing now" value={stats.failing} hint={stats.failingHint} icon={TriangleAlert} />
          <StatTile label="Median run time" value={stats.median} hint={stats.medianHint} icon={Timer} />
          <StatTile label="Merges blocked" value={stats.blocked} hint={stats.blockedHint} icon={ShieldCheck} />
        </StatGrid>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <section className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">Recent runs</h2>
              {runs.length > 0 && (
              <ToggleGroup
                variant="outline"
                size="sm"
                spacing={0}
                value={[filter]}
                onValueChange={(v) => v[0] && setFilter(v[0] as typeof filter)}
                aria-label="Filter runs"
              >
                <ToggleGroupItem value="all">All</ToggleGroupItem>
                <ToggleGroupItem value="failed">Failed</ToggleGroupItem>
                <ToggleGroupItem value="passed">Passed</ToggleGroupItem>
              </ToggleGroup>
              )}
            </div>

            {runs.length === 0 ? (
              <EmptyState icon={CircleCheck} title="No runs yet" description="Checks run on every push. The first push to this repository will show up here." />
            ) : shown.length === 0 ? (
              <EmptyState icon={CircleCheck} title="No runs match" action={<Button variant="outline" size="sm" onClick={() => setFilter("all")}>Show all runs</Button>} />
            ) : (
              <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                {shown.map((run) => {
                  const isOpen = openId === run.id;
                  const failed = run.steps.filter((s) => s.status === "failed").length;
                  return (
                    <li key={run.id}>
                      <button
                        type="button"
                        aria-expanded={isOpen}
                        aria-controls={`run-${run.id}`}
                        onClick={() => setOpenId(isOpen ? null : run.id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30 cursor-pointer"
                      >
                        <ChevronRight className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground", isOpen && "rotate-90")} aria-hidden />
                        <StatusIcon status={run.status} className="mt-0.5" />
                        <div className="flex min-w-0 flex-1 flex-col gap-1">
                          <span className="truncate text-sm font-medium">{run.message}</span>
                          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="font-mono">#{run.id}</span>
                            <span className="flex items-center gap-1 font-mono">
                              <GitBranch className="size-3" aria-hidden />
                              {run.branch}
                            </span>
                            <span className="font-mono">{run.sha.slice(0, 7)}</span>
                            <span>by {run.actor}</span>
                          </span>
                        </div>
                        <span className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted-foreground">
                          <StatusBadge status={run.status} label={run.status === "failed" ? `${failed} failed` : undefined} />
                          <span className="flex items-center gap-1 tabular-nums">
                            <Clock className="size-3" aria-hidden />
                            {run.duration} · {run.time}
                          </span>
                        </span>
                      </button>
                      {isOpen && (
                        <div id={`run-${run.id}`} className="border-t border-border bg-muted/10 px-4 py-3">
                          <ol className="flex flex-col gap-2.5">
                            {run.steps.map((step) => (
                              <li key={step.name} className="flex items-start gap-2.5 text-sm">
                                <StatusIcon status={step.status} className="mt-0.5" />
                                <div className="min-w-0">
                                  <p className={cn("font-medium", step.status === "failed" && "text-destructive")}>{step.name}</p>
                                  <p className="text-xs text-muted-foreground text-pretty">{step.detail}</p>
                                  {step.files && step.files.length > 0 && (
                                    <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[11px] text-muted-foreground">
                                      {step.files.map((f) => (
                                        <li key={f}>{f}</li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </li>
                            ))}
                          </ol>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" href={`${base}/commit/${run.sha}`}>
                              View commit
                            </Button>
                            {run.pr && (
                              <Button variant="outline" size="sm" href={`${base}/pull/${run.pr}`}>
                                Open pull request #{run.pr}
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <aside className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Configuration</CardTitle>
                <CardDescription>What every push is checked against. Change it in repository settings.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <div className="relative border border-border bg-muted/30">
                  <pre tabIndex={0} aria-label={configTitle} className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" translate="no">
                    {config}
                  </pre>
                  <div className="absolute right-1 top-1">
                    <CopyButton value={config} label={`Copy ${configTitle}`} />
                  </div>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <Link href={`${base}/settings`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                    Repository settings
                  </Link>
                  <Link href="/docs" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                    All available checks
                  </Link>
                </div>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
