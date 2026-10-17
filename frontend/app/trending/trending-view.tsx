"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Flame, Star } from "lucide-react";
import { notify } from "@/components/button-status";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PageHeader } from "@/components/craton-ui";
import { DataTypeBadge } from "@/components/data-type-badge";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DataType, Repo } from "@/lib/data";
import { useSession } from "@/components/session";
import { starAction } from "@/app/actions";

export type Period = "day" | "week" | "month";
const periodLabel: Record<Period, string> = { day: "in the last day", week: "in the last 7 days", month: "in the last 30 days" };
type Ranked = Repo & { gained: number; starred: boolean };
const types: ("all" | DataType)[] = ["all", "DEM", "Shapefile", "HEC-RAS", "LiDAR", "NetCDF"];

export function TrendingView({ byPeriod, initialPeriod }: { byPeriod: Record<Period, Ranked[]>; initialPeriod: Period }) {
  const router = useRouter();
  const pathname = usePathname();
  const user = useSession();
  const [period, setPeriod] = useState<Period>(initialPeriod);
  const repos = byPeriod[period];
  const [type, setType] = useState<"all" | DataType>("all");
  // Stars the viewer changed on this page: { on, delta to the server's count }.
  const [local, setLocal] = useState<Record<string, { on: boolean; delta: number }>>({});
  const [, startTransition] = useTransition();

  function toggleStar(repo: Ranked) {
    if (!user) return router.push(`/login?next=${encodeURIComponent(pathname)}`);
    const key = `${repo.owner}/${repo.name}`;
    const was = local[key]?.on ?? repo.starred;
    const next = !was;
    const delta = (local[key]?.delta ?? 0) + (next ? 1 : -1);
    setLocal((l) => ({ ...l, [key]: { on: next, delta } }));
    startTransition(async () => {
      const result = await starAction(repo.owner, repo.name, next);
      if (!result.ok) {
        setLocal((l) => ({ ...l, [key]: { on: was, delta: delta + (next ? -1 : 1) } }));
        notify.error("Couldn’t update the star", { description: result.error });
      }
    });
  }

  const ranked = repos.filter((r) => type === "all" || r.tags.includes(type));

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
        <PageHeader
          eyebrow={
            <span className="flex items-center gap-1.5">
              <Flame className="size-3.5" aria-hidden /> Trending
            </span>
          }
          title="What hydrologists are starring"
          description="Public datasets and models ranked by the stars they received recently, so new work surfaces next to the classics."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup variant="outline" size="sm" spacing={0} value={[period]} onValueChange={(v) => {
              if (!v[0]) return;
              setPeriod(v[0] as Period);
              // The address follows along (so the view can be shared) without asking the server for anything.
              window.history.replaceState(null, "", `${pathname}?period=${v[0]}`);
            }}
            aria-label="Period"
          >
            <ToggleGroupItem value="day">Today</ToggleGroupItem>
            <ToggleGroupItem value="week">This week</ToggleGroupItem>
            <ToggleGroupItem value="month">This month</ToggleGroupItem>
          </ToggleGroup>
          <div className="max-w-full overflow-x-auto">
          <ToggleGroup variant="outline" size="sm" spacing={0} value={[type]} onValueChange={(v) => v[0] && setType(v[0] as typeof type)} aria-label="Data type">
            {types.map((t) => (
              <ToggleGroupItem key={t} value={t}>
                {t === "all" ? "All types" : t}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          </div>
        </div>

        {ranked.length === 0 ? (
          <EmptyState
            icon={Flame}
            title={`No trending ${type} repositories ${periodLabel[period]}`}
            description="Try another data type or a longer period."
            action={<Button variant="outline" size="sm" onClick={() => setType("all")}>Show all types</Button>}
          />
        ) : (
          <ol className="flex flex-col divide-y divide-border border border-border bg-card">
            {ranked.map((repo, idx) => {
              const key = `${repo.owner}/${repo.name}`;
              const isStarred = local[key]?.on ?? repo.starred;
              const stars = repo.stars + (local[key]?.delta ?? 0);
              return (
                <li key={key} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
                  <span className="w-8 shrink-0 font-mono text-sm font-bold tabular-nums text-muted-foreground">{idx + 1}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/${key}`} className="text-base font-semibold hover:underline">
                        <span className="font-normal text-muted-foreground">{repo.owner} / </span>
                        {repo.name}
                      </Link>
                      <Badge variant="outline" className="text-[10px]">{repo.region}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground text-pretty">{repo.description}</p>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                      <span className="flex gap-1.5">
                        {repo.tags.map((t) => (
                          <DataTypeBadge key={t} type={t} />
                        ))}
                      </span>
                      <span className="flex items-center gap-1 tabular-nums">
                        <Star className="size-3" aria-hidden /> {stars.toLocaleString("en-US")}
                      </span>
                      <span className="font-mono tabular-nums">{repo.size}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-4 sm:flex-col sm:items-end sm:gap-1.5">
                    <span className="text-xs tabular-nums">
                      <span className="font-semibold text-foreground">+{repo.gained.toLocaleString("en-US")}</span>{" "}
                      <span className="text-muted-foreground">{repo.gained === 1 ? "star" : "stars"} {periodLabel[period]}</span>
                    </span>
                    <Button variant="outline" size="sm" onClick={() => toggleStar(repo)} aria-pressed={isStarred}>
                      <Star data-icon="inline-start" className={isStarred ? "fill-current" : undefined} />
                      {isStarred ? "Starred" : "Star"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </AppShell>
  );
}
