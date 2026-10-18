import type { Metadata } from "next";
import { InsightsView, type InsightsData } from "./insights-view";
import { commitActivity, orgMembers } from "@/lib/data";
import { formatBytes } from "@/lib/format";
import { loadCommits, loadRepo, loadStorage } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Insights · ${owner}/${repo}` };
}

const demo: InsightsData = {
  period: "Last 8 weeks",
  stats: [
    { label: "Total commits", value: "1,284", icon: "commits", hint: "Since Nov 2025" },
    { label: "Contributors", value: "12", icon: "people", hint: "4 active this month" },
    { label: "Dataset size", value: "4.2 GB", icon: "size", hint: "1.9 GB stored after dedup" },
    { label: "Commits per week", value: "27", icon: "trend", hint: "Up from 19 last month" },
  ],
  weekly: commitActivity,
  growth: [
    { label: "Oct", storage: 3.1 },
    { label: "Nov", storage: 3.4 },
    { label: "Dec", storage: 3.6 },
    { label: "Jan", storage: 3.9 },
    { label: "Feb", storage: 4.0 },
    { label: "Mar", storage: 4.2 },
  ],
  storageUnit: "GB",
  growthNote: "Logical dataset size in GB. Stored size grows about half as fast thanks to deduplication.",
  contributors: [
    { handle: "priyam", pct: 46 },
    { handle: "arunn", pct: 31 },
    { handle: "sarat", pct: 18 },
    { handle: "vikramr", pct: 5 },
  ].map((c) => ({ ...c, name: orgMembers.find((m) => m.handle === c.handle)?.name ?? c.handle })),
};

const DAY = 86_400_000;
const short = (t: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(t));

export default async function InsightsPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  if (!summary.live) return <InsightsView owner={owner} repo={repo} data={demo} />;

  const [{ commits }, storage] = await Promise.all([loadCommits(owner, repo, summary.repo.defaultBranch), loadStorage(owner, repo)]);
  const oldestFirst = [...commits].reverse();

  // Commits per week for the last 8 weeks (weeks end today).
  const now = Date.now();
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const end = now - (7 - i) * 7 * DAY;
    const start = end - 7 * DAY;
    return { week: short(start + DAY), commits: commits.filter((c) => { const t = Date.parse(c.isoTime ?? ""); return t > start && t <= end; }).length };
  });
  const recent = weekly.reduce((n, w) => n + w.commits, 0);

  // Logical size after each commit, replaying file size changes in order.
  let size = 0;
  const points = oldestFirst.map((c) => {
    for (const f of c.files) size += (f.sizeAfter ?? 0) - (f.sizeBefore ?? 0);
    return { t: Date.parse(c.isoTime ?? ""), size };
  });
  const peak = Math.max(1, ...points.map((p) => p.size));
  const unit = peak >= 1024 ** 3 ? "GB" : peak >= 1024 ** 2 ? "MB" : "KB";
  const divisor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  const growth = points.map((p) => ({ label: short(p.t), storage: Math.round((p.size / divisor) * 100) / 100 }));

  // Share of commits per author.
  const byAuthor = new Map<string, { name: string; n: number }>();
  for (const c of commits) byAuthor.set(c.authorHandle, { name: c.author, n: (byAuthor.get(c.authorHandle)?.n ?? 0) + 1 });
  const contributors = [...byAuthor.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .map(([handle, v]) => ({ handle, name: v.name, pct: Math.round((v.n / Math.max(1, commits.length)) * 100) }));
  const activeRecently = new Set(commits.filter((c) => Date.parse(c.isoTime ?? "") > now - 30 * DAY).map((c) => c.authorHandle)).size;
  const first = oldestFirst[0]?.isoTime;

  const data: InsightsData = {
    period: "Last 8 weeks",
    stats: [
      { label: "Total commits", value: summary.commitCount.toLocaleString("en-US"), icon: "commits", hint: first ? `Since ${short(Date.parse(first))}` : "No commits yet" },
      { label: "Contributors", value: String(byAuthor.size), icon: "people", hint: `${activeRecently} active this month` },
      { label: "Dataset size", value: summary.repo.size, icon: "size", hint: storage ? `${formatBytes(storage.storedBytes)} stored with full history` : "" },
      { label: "Commits per week", value: (recent / 8).toFixed(1), icon: "trend", hint: `${recent} in the last 8 weeks` },
    ],
    weekly,
    growth,
    storageUnit: unit,
    growthNote: `Logical size of ${summary.repo.defaultBranch} after each commit, in ${unit}. Unchanged chunks aren’t stored again.`,
    contributors,
  };
  return <InsightsView owner={owner} repo={repo} data={data} />;
}
