import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PullView, type TimelineItem } from "./pull-view";
import { pullRequests as demoPulls } from "@/lib/data";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { loadChecks, loadCompare, loadIssues, loadPull, loadRepo, loadUser } from "@/lib/source";
import { changePreviews } from "@/lib/previews";

type Params = { owner: string; repo: string; id: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo, id } = await params;
  const found = await loadPull(owner, repo, Number(id));
  return { title: `${found?.pull.title ?? `Pull request #${id}`} · ${owner}/${repo}` };
}

// ── Demo data (API not running) ──
const demoTimeline: TimelineItem[] = [
  { kind: "event", actor: "arunn", text: "opened this pull request from levee-scenario", time: "2 hours ago" },
  { kind: "comment", actor: "arunn", text: "Raised the embankment crest by 0.5 m along the right bank and re-ran the 100-yr event. Inundation extent drops noticeably near the confluence.", time: "2 hours ago" },
  { kind: "comment", actor: "priyam", text: "Nice. Can you confirm the datum matches the 2024 DEM before we merge?", time: "1 hour ago" },
  { kind: "approve", actor: "sarat", text: "approved these changes", time: "40 minutes ago" },
];
const demoFiles = [
  { name: "vectors/levees.shp", dataType: "Shapefile" as const, added: 86, changed: 0, removed: 0, unit: "features" as const },
  { name: "terrain/basin_dem.tif", dataType: "DEM" as const, added: 0, changed: 320, removed: 0, unit: "tiles" as const },
  { name: "model/model.p01", dataType: "HEC-RAS" as const, added: 0, changed: 18, removed: 0, unit: "cells" as const },
];

/** How many changed files (and commits) a pull request page draws; the totals are still shown. */
const PR_FILES_SHOWN = 100;

export default async function PullDetailPage({ params }: { params: Promise<Params> }) {
  const { owner, repo, id } = await params;
  const n = Number.parseInt(id, 10);
  const summary = await loadRepo(owner, repo);

  if (!summary.live) {
    const pr = demoPulls.find((p) => p.id === n) ?? demoPulls[0];
    return (
      <PullView
        owner={owner}
        repo={repo}
        pr={{ ...pr, checks: "failed", approvals: 1 }}
        live={false}
        viewer="priyam"
        timeline={demoTimeline}
        files={demoFiles}
        commits={[]}
        conflicts={[]}
        checkSteps={[
          { name: "Coordinate reference system", status: "passed", detail: "" },
          { name: "Vertical datum", status: "failed", detail: "0.31 m offset" },
        ]}
        rules={{ requireChecks: true, requireReview: false, requireOwnerReview: false }}
        reviewers={[
          { handle: "sarat", state: "approved" },
          { handle: "priyam", state: "commented" },
        ]}
        linkedIssue={{ id: 88, title: "Datum mismatch between 2023 and 2024 DEM", open: true }}
      />
    );
  }

  const found = await loadPull(owner, repo, n);
  if (!found) notFound();
  const { pull: pr, reviews, thread } = found;
  const merged = pr.status === "merged";

  const [user, checks, compare, { issues }] = await Promise.all([
    loadUser(),
    loadChecks(owner, repo),
    // A merged branch has nothing left to compare; show what it had when it was reviewed.
    merged || !pr.head ? Promise.resolve(null) : loadCompare(owner, repo, pr.target, pr.source),
    loadIssues(owner, repo),
  ]);

  // Opening, the description, comments and reviews in time order.
  type Timed = { at: string; item: Omit<TimelineItem, "time"> };
  const events: Timed[] = [
    { at: found.createdAt, item: { kind: "event", actor: pr.author, text: `opened this pull request from ${pr.source}` } },
    ...(pr.description ? [{ at: found.createdAt, item: { kind: "comment" as const, actor: pr.author, text: pr.description } }] : []),
    ...thread.map((c) => ({ at: c.createdAt, item: { kind: "comment" as const, actor: c.author, text: c.body, commentId: c.id, reactions: c.reactions, edited: Boolean(c.editedAt) } })),
    ...reviews.map((r) => ({
      at: r.createdAt,
      item: r.body
        ? { kind: "comment" as const, actor: r.author, text: r.body, badge: r.state === "approved" ? ("Approved" as const) : r.state === "changes_requested" ? ("Changes requested" as const) : undefined }
        : { kind: r.state === "changes_requested" ? ("changes" as const) : ("approve" as const), actor: r.author, text: r.state === "changes_requested" ? "requested changes" : "approved these changes" },
    })),
  ];
  const timeline = events
    .map((e, i) => ({ ...e, i }))
    .sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? -1 : 1))
    .map((e) => ({ ...e.item, time: e.at ? timeAgo(e.at) : "" }) as TimelineItem);

  // Latest review per reviewer.
  const latest = new Map<string, (typeof reviews)[number]["state"]>();
  for (const r of reviews) latest.set(r.author, r.state);

  const run = pr.head ? (checks ?? []).find((c) => c.commit === pr.head) : undefined;
  const mention = new RegExp(`#(\\d+)\\b`);
  const mentioned = Number(`${pr.title} ${pr.description}`.match(mention)?.[1]);
  // A pull request can change thousands of files; the page draws the first few (the compare page pages through the rest)
  // and fetches previews only for those.
  const allFiles = compare?.files ?? [];
  const files = allFiles.slice(0, PR_FILES_SHOWN);
  const allCommits = compare?.commits ?? [];
  const previews = compare ? await changePreviews(owner, repo, compare.headCommit, compare.mergeBase ?? compare.baseCommit, files) : {};
  const owners = (await api.pullOwners(owner, repo, pr.id)) ?? [];
  const linked = issues.find((i) => i.id === mentioned) ?? issues.find((i) => i.reference && allFiles.some((f) => f.name === i.reference));

  return (
    <PullView
      key={`${pr.id}-${pr.status}-${reviews.length}`}
      owner={owner}
      repo={repo}
      pr={pr}
      live
      viewer={user?.handle ?? null}
      timeline={timeline}
      files={files}
      filesTotal={allFiles.length}
      previews={previews}
      commits={allCommits.slice(0, PR_FILES_SHOWN)}
      commitsTotal={allCommits.length}
      conflicts={compare?.conflicts ?? []}
      checkSteps={run ? run.steps : null}
      rules={{ requireChecks: summary.requireChecks, requireReview: summary.requireReview, requireOwnerReview: summary.requireOwnerReview }}
      reviewers={[...latest.entries()].map(([handle, state]) => ({ handle, state }))}
      waiting={found.reviewRequests}
      owners={owners}
      canModerate={summary.access === "admin"}
      linkedIssue={linked ? { id: linked.id, title: linked.title, open: linked.status === "open" } : undefined}
    />
  );
}
