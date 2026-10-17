import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IssueView, type Entry } from "./issue-view";
import { issues as demoIssues, type Issue } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { loadIssue, loadMilestones, loadPulls, loadRepo, loadUser } from "@/lib/source";

type Params = { owner: string; repo: string; id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo, id } = await params;
  const found = await loadIssue(owner, repo, Number(id));
  return { title: `${found?.issue.title ?? `Issue #${id}`} · ${owner}/${repo}` };
}

export default async function IssueDetailPage({ params }: { params: Promise<Params> }) {
  const { owner, repo, id } = await params;
  const n = Number.parseInt(id, 10);
  const summary = await loadRepo(owner, repo);

  if (summary.live) {
    const [found, user, { pulls }, allMilestones] = await Promise.all([loadIssue(owner, repo, n), loadUser(), loadPulls(owner, repo), loadMilestones(owner, repo)]);
    if (!found) notFound();
    const { issue, thread } = found;
    const entries: Entry[] = [
      ...(issue.body ? [{ kind: "comment" as const, id: 0, author: issue.author, role: "Author", time: issue.opened ?? issue.updated, text: issue.body }] : []),
      ...thread.map((c, i) => ({ kind: "comment" as const, id: i + 1, author: c.author, role: c.author === issue.author ? "Author" : "Member", time: timeAgo(c.createdAt), text: c.body, commentId: c.id, reactions: c.reactions, edited: Boolean(c.editedAt) })),
    ];
    // A pull request that mentions this issue (#88) in its title or description.
    const mention = new RegExp(`#${issue.id}\\b`);
    const linked = pulls.find((p) => mention.test(`${p.title} ${p.description}`))?.id;
    return <IssueView key={issue.id} owner={owner} repo={repo} issue={issue} thread={entries} live viewer={user?.handle ?? null} linkedPull={linked} canWrite={summary.access === "write" || summary.access === "admin"} canModerate={summary.access === "admin"} milestones={allMilestones.filter((m) => m.state === "open").map((m) => m.title)} />;
  }

  const issue: Issue = demoIssues.find((i) => i.id === n) ?? {
    id: n,
    title: "Model boundary condition check",
    author: "sarat",
    status: "open",
    label: "data-quality",
    comments: 2,
    updated: "2 hours ago",
    reference: "vectors/catchment.shp",
  };
  const entries: Entry[] = [
    {
      kind: "comment",
      id: 1,
      author: issue.author,
      role: "Contributor",
      time: "2 days ago",
      text: `When inspecting the dataset in QGIS against the 2024 survey points, we noticed a vertical datum offset. Could this be caused by WGS84 vs local ellipsoidal height conversion? Reference layer: ${issue.reference ?? "terrain/basin_dem.tif"}.`,
    },
    {
      kind: "comment",
      id: 2,
      author: "priyam",
      role: "Maintainer",
      time: "1 day ago",
      text: "Good catch. The raw LiDAR survey was delivered in EPSG:4326 with ellipsoidal heights, while the 2023 baseline was orthometric (EGM2008). We are re-running the COG conversion pipeline with the geoid grid transformation.",
    },
  ];
  return <IssueView owner={owner} repo={repo} issue={issue} thread={entries} live={false} viewer="priyam" linkedPull={139} />;
}
