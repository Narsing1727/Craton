"use client";

import { UserAvatar } from "@/components/user-avatar";
import { HardDrive, GitCommit, Users, TrendingUp } from "lucide-react";
import { PageHeader, StatGrid, StatTile } from "@/components/craton-ui";
import { Bar, BarChart, CartesianGrid, XAxis, Area, AreaChart } from "recharts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Progress } from "@/components/ui/progress";

const commitConfig = {
  commits: { label: "Commits", color: "var(--chart-1)" },
} satisfies ChartConfig;

export type InsightsData = {
  stats: { label: string; value: string; hint: string; icon: "commits" | "people" | "size" | "trend" }[];
  weekly: { week: string; commits: number }[];
  growth: { label: string; storage: number }[];
  storageUnit: string;
  growthNote: string;
  contributors: { handle: string; name: string; pct: number }[];
  period: string;
};

const icons = { commits: GitCommit, people: Users, size: HardDrive, trend: TrendingUp };

export function InsightsView({ owner, repo, data }: { owner: string; repo: string; data: InsightsData }) {
  const storageConfig = { storage: { label: `Size (${data.storageUnit})`, color: "var(--chart-2)" } } satisfies ChartConfig;

  return (
    <>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <PageHeader
          title="Insights"
          description={`Activity, contributors and storage trends for ${owner}/${repo}.`}
          actions={
            <span className="text-xs text-muted-foreground">{data.period}</span>
          }
        />

        <StatGrid>
          {data.stats.map((s) => (
            <StatTile key={s.label} label={s.label} value={s.value} hint={s.hint} icon={icons[s.icon]} />
          ))}
        </StatGrid>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Commit activity</CardTitle>
              <CardDescription>Commits over the last 8 weeks</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={commitConfig} className="h-[240px] w-full">
                <BarChart data={data.weekly}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="commits" fill="var(--color-commits)" radius={0} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Storage growth</CardTitle>
              <CardDescription>{data.growthNote}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer config={storageConfig} className="h-[240px] w-full">
                <AreaChart data={data.growth}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Area
                    dataKey="storage"
                    type="monotone"
                    fill="var(--color-storage)"
                    fillOpacity={0.2}
                    stroke="var(--color-storage)"
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Top contributors</CardTitle>
            <CardDescription>Share of commits on the default branch</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {data.contributors.map((c) => {
              return (
                <div key={c.handle} className="flex items-center gap-3">
                  <UserAvatar handle={c.handle} className="size-8" fallbackClassName="font-mono text-[10px]" />
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="tabular-nums text-muted-foreground">{c.pct}%</span>
                    </div>
                    <Progress value={c.pct} aria-label={`${c.pct}% of commits`} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
