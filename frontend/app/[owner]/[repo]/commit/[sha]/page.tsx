import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, FolderCode, GitBranch, GitCommit, ShieldCheck } from "lucide-react";
import { CopyButton } from "@/components/craton-actions";
import { Initials, KeyValueList, StatGrid, StatTile, StatusIcon } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPreview, MapDiffLegend } from "@/components/map-preview";
import { DataTypeBadge } from "@/components/data-type-badge";
import { ChunkMap } from "@/components/chunk-map";
import { RelativeTimeCard } from "@/components/ui/relative-time-card";
import { CopyButton as AnimateCopyButton } from "@/components/animate-ui/components/buttons/copy";
import type { ApiCheckRun } from "@/lib/api";
import { commits as demoCommits, type Commit } from "@/lib/data";
import { mockSha256 } from "@/lib/download";
import { loadBranches, loadCommit, loadCommits, loadRepo } from "@/lib/source";
import { changePreviews } from "@/lib/previews";
import { ChangePreview } from "@/components/data-preview";

type Params = { owner: string; repo: string; sha: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo, sha } = await params;
  const found = await loadCommit(owner, repo, sha);
  return { title: `${found?.commit.message ?? sha.slice(0, 7)} · ${owner}/${repo}` };
}

type Neighbor = { sha: string; message: string } | undefined;

/** How many changed files a commit page shows at first, and how many more each step adds (`?files=` in the address). */
const FILES_PAGE = 50;

export default async function CommitPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ files?: string }> }) {
  const { owner, repo, sha } = await params;
  const asked = Number((await searchParams).files);
  const base = `/${owner}/${repo}`;
  const summary = await loadRepo(owner, repo);

  let commit: Commit;
  let checks: ApiCheckRun | null = null;
  let parent: Neighbor;
  let newer: Neighbor;
  let branch = summary.repo.defaultBranch;

  if (summary.live) {
    const found = await loadCommit(owner, repo, sha);
    if (!found) notFound();
    commit = found.commit;
    checks = found.checks;
    // Branch that contains the commit (default first), and its neighbours on that branch.
    const { branches } = await loadBranches(owner, repo);
    for (const b of branches) {
      const { commits } = await loadCommits(owner, repo, b.name);
      const i = commits.findIndex((c) => c.sha === commit.sha);
      if (i === -1) continue;
      branch = b.name;
      newer = commits[i - 1];
      parent = commits[i + 1];
      break;
    }
    if (!parent && commit.parents?.[0]) {
      const p = await loadCommit(owner, repo, commit.parents[0]);
      if (p) parent = p.commit;
    }
  } else {
    const index = Math.max(0, demoCommits.findIndex((c) => c.sha === sha));
    commit = demoCommits[index];
    parent = demoCommits[index + 1];
    newer = demoCommits[index - 1];
  }

  const live = summary.live;
  const merkle = commit.merkleRoot ?? mockSha256(`${owner}/${repo}@${commit.sha}`);
  const totals = commit.files.reduce(
    (t, f) => ({ added: t.added + f.added, changed: t.changed + f.changed, removed: t.removed + f.removed, reused: t.reused + (f.reused ?? 0) }),
    { added: 0, changed: 0, removed: 0, reused: 0 },
  );
  const unit = commit.files[0]?.unit ?? "chunks";
  // A commit can change thousands of files; the page draws a page of them (previews are fetched only for those shown).
  const shown = Number.isFinite(asked) && asked > FILES_PAGE ? Math.floor(asked) : FILES_PAGE;
  const visibleFiles = commit.files.slice(0, shown);
  const hiddenFiles = commit.files.length - visibleFiles.length;
  const previews = live ? await changePreviews(owner, repo, commit.sha, commit.parents?.[0], visibleFiles) : {};

  const demoChecks = [
    { label: "CRS is EPSG:32643", status: "passed" as const },
    { label: "Nodata value is -9999", status: "passed" as const },
    { label: "No topology gaps", status: "passed" as const },
    { label: "Chunks verified against Merkle root", status: "passed" as const },
  ];
  const checkRows = live ? (checks?.steps.map((s) => ({ label: s.name, status: s.status, detail: s.detail })) ?? []) : demoChecks.map((c) => ({ ...c, detail: "" }));

  return (
    <>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <GitCommit className="size-3.5" aria-hidden />
              Commit
            </p>
            <h1 className="text-xl font-semibold text-balance sm:text-2xl">{commit.message.split("\n")[0]}</h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Initials name={commit.authorHandle} />
              <Link href={`/${commit.authorHandle}`} className="font-medium text-foreground hover:underline">
                {commit.author}
              </Link>
              committed{" "}
              {commit.isoTime ? (
                <RelativeTimeCard date={commit.isoTime} timezones={["UTC", "Asia/Kolkata"]} className="underline decoration-dotted underline-offset-2" />
              ) : (
                commit.timestamp
              )}{" "}
              on
              <Link href={`${base}/commits${branch === summary.repo.defaultBranch ? "" : `?ref=${encodeURIComponent(branch)}`}`} className="flex items-center gap-1 bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground hover:underline">
                <GitBranch className="size-3" aria-hidden />
                {branch}
              </Link>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 lg:items-end">
            <div className="flex max-w-full items-center gap-1 border border-border bg-muted/30 py-0.5 pl-2.5 pr-0.5 font-mono text-xs">
              <span className="text-muted-foreground">commit</span>
              <span className="ml-1 truncate">{live ? commit.sha.slice(0, 12) : commit.sha}</span>
              <CopyButton value={commit.sha} label="Copy commit SHA" />
            </div>
            {parent && (
              <p className="text-xs text-muted-foreground">
                parent{" "}
                <Link href={`${base}/commit/${parent.sha}`} className="font-mono text-foreground hover:underline">
                  {parent.sha.slice(0, 7)}
                </Link>
              </p>
            )}
            <Button variant="outline" size="sm" href={`${base}?ref=${commit.sha}`}>
              <FolderCode data-icon="inline-start" />
              Browse files at this commit
            </Button>
          </div>
        </div>

        <StatGrid>
          <StatTile label="Files changed" value={commit.files.length} hint={commit.files.slice(0, 5).map((f) => f.name).join(", ") + (commit.files.length > 5 ? `, and ${commit.files.length - 5} more` : "") || "No file changes"} />
          {unit === "chunks" ? (
            <>
              <StatTile label="New chunks" value={`+${totals.added.toLocaleString("en-US")}`} hint={`${totals.reused.toLocaleString("en-US")} reused from the previous version`} />
              <StatTile label="Chunks dropped" value={`-${totals.removed.toLocaleString("en-US")}`} hint="Kept in history, no longer in the tree" />
              <StatTile label="New data" value={commit.sizeDelta} hint="Only new chunks are uploaded and stored" />
            </>
          ) : (
            <>
              <StatTile label={`Added ${unit}`} value={`+${totals.added.toLocaleString("en-US")}`} hint={`${totals.changed.toLocaleString("en-US")} changed`} />
              <StatTile label={`Removed ${unit}`} value={`-${totals.removed.toLocaleString("en-US")}`} hint="Features, rows, cells or tiles" />
              <StatTile label="Stored size change" value={commit.sizeDelta} hint="Unique chunks only, after deduplication" />
            </>
          )}
        </StatGrid>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
          <div className="flex min-w-0 flex-col gap-4">
            <h2 className="text-sm font-semibold">Changed data</h2>
            {commit.files.length === 0 && <p className="text-sm text-muted-foreground">This commit doesn’t change any files.</p>}
            {visibleFiles.map((f) => (
              <Card key={f.name} className="cv-card overflow-hidden py-0">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-3 text-sm">
                  {f.change === "removed" ? (
                    <span className="font-mono text-muted-foreground line-through">{f.name}</span>
                  ) : (
                    <Link href={live ? `${base}/blob/${f.name}?ref=${commit.sha}` : `${base}/blob/${f.name}`} className="font-mono hover:underline">
                      {f.name}
                    </Link>
                  )}
                  {f.dataType && <DataTypeBadge type={f.dataType} />}
                  {f.change && <span className="text-xs capitalize text-muted-foreground">{f.change}</span>}
                  <span className="ml-auto flex items-center gap-3 font-mono text-xs tabular-nums">
                    <span className="text-chart-1">+{f.added}</span>
                    {f.unit === "chunks" ? <span className="text-muted-foreground">={f.reused ?? 0}</span> : <span className="text-foreground">~{f.changed}</span>}
                    <span className="text-destructive">-{f.removed}</span>
                    <span className="text-muted-foreground">{f.unit}</span>
                  </span>
                </div>
                <CardContent className="flex flex-col gap-3 p-4">
                  {f.unit === "chunks" ? (
                    <>
                      {previews[f.name] && <ChangePreview preview={previews[f.name]} />}
                      <ChunkMap map={f.map ?? ""} before={f.sizeBefore ?? 0} after={f.sizeAfter ?? 0} change={f.change} />
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <figure className="flex flex-col gap-1.5">
                          <MapPreview seed={commit.sha.charCodeAt(1) + 3} className="aspect-video" />
                          <figcaption className="text-xs text-muted-foreground">Before{parent ? ` · ${parent.sha}` : ""}</figcaption>
                        </figure>
                        <figure className="flex flex-col gap-1.5">
                          <MapPreview
                            seed={commit.sha.charCodeAt(1) + 3}
                            variant={f.dataType === "Shapefile" ? "vector" : "terrain"}
                            className="aspect-video"
                            diff={{ "2-3": "changed", "2-4": "added", "3-3": "changed", "4-8": "added", "5-8": "changed", "6-2": "removed" }}
                          />
                          <figcaption className="text-xs text-muted-foreground">After · {commit.sha}</figcaption>
                        </figure>
                      </div>
                      <MapDiffLegend />
                    </>
                  )}
                </CardContent>
              </Card>
            ))}
            {hiddenFiles > 0 && (
              <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Showing {visibleFiles.length.toLocaleString("en-US")} of {commit.files.length.toLocaleString("en-US")} changed files.
                </span>
                <Link href={`?files=${shown + FILES_PAGE * 4}`} className="text-foreground underline underline-offset-2 hover:no-underline">
                  Show {Math.min(FILES_PAGE * 4, hiddenFiles).toLocaleString("en-US")} more
                </Link>
                {hiddenFiles > FILES_PAGE * 4 && (
                  <Link href={`?files=${commit.files.length}`} className="text-foreground underline underline-offset-2 hover:no-underline">
                    Show all
                  </Link>
                )}
              </p>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4 text-chart-1" aria-hidden />
                  Integrity
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground text-pretty">
                  Merkle root over every file in this commit. The server recomputes it on push; audits reference this root.
                </p>
                <div className="flex items-center gap-1 border border-border bg-muted/30 py-0.5 pl-2 pr-0.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{merkle}</code>
                  <AnimateCopyButton content={merkle} variant="ghost" size="xs" aria-label="Copy Merkle root" />
                </div>
                <KeyValueList
                  items={[
                    { label: "Author", value: commit.authorHandle, mono: true },
                    { label: live ? "New chunks" : "Chunks", value: (live ? totals.added : totals.added + totals.changed).toLocaleString("en-US"), mono: true },
                    { label: "Compression", value: live ? "Lossless (zstd)" : "Lossless", mono: false },
                  ]}
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  Checks
                  {checks && <span className="ml-auto font-mono text-xs font-normal text-muted-foreground">{checks.durationMs} ms</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5 text-sm">
                {checkRows.length === 0 && (
                  <p className="text-xs text-muted-foreground">Checks run on the commit at the tip of each push. This one was pushed together with a newer commit.</p>
                )}
                {checkRows.map((c) => (
                  <div key={c.label} className="flex items-start gap-2" title={c.detail || undefined}>
                    <StatusIcon status={c.status} className="mt-0.5" />
                    <span className="flex flex-col">
                      {c.label}
                      {c.detail && c.status === "failed" && <span className="text-xs text-muted-foreground">{c.detail}</span>}
                    </span>
                  </div>
                ))}
                <Link href={`${base}/checks`} className="text-xs text-muted-foreground hover:text-foreground hover:underline">
                  All checks for this repository
                </Link>
              </CardContent>
            </Card>
          </aside>
        </div>

        <nav aria-label="Commit navigation" className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          {parent ? (
            <Button variant="outline" size="sm" href={`${base}/commit/${parent.sha}`}>
              <ArrowLeft data-icon="inline-start" />
              Older: <span className="max-w-36 truncate sm:max-w-48">{parent.message}</span>
            </Button>
          ) : (
            <span />
          )}
          {newer ? (
            <Button variant="outline" size="sm" href={`${base}/commit/${newer.sha}`}>
              Newer: <span className="max-w-36 truncate sm:max-w-48">{newer.message}</span>
              <ArrowRight data-icon="inline-end" />
            </Button>
          ) : (
            <Button variant="ghost" size="sm" href={`${base}/commits`}>
              All commits
              <ArrowRight data-icon="inline-end" />
            </Button>
          )}
        </nav>
      </div>
    </>
  );
}
