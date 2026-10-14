import type { Metadata } from "next";
import Link from "next/link";
import { GitCompare, TriangleAlert } from "lucide-react";
import { EmptyState, Initials, PageHeader } from "@/components/craton-ui";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { MapPreview, MapDiffLegend } from "@/components/map-preview";
import { ChangePreview } from "@/components/data-preview";
import { changePreviews } from "@/lib/previews";
import { DataTypeBadge } from "@/components/data-type-badge";
import { ChunkMap } from "@/components/chunk-map";
import { CompareBar } from "./compare-bar";
import { formatBytes } from "@/lib/format";
import { loadBranches, loadCompare, loadRepo } from "@/lib/source";

type Diff = Record<string, "added" | "removed" | "changed">;

// Demo comparison (API not running).
const demoFiles = [
  { name: "terrain/basin_dem.tif", type: "DEM" as const, variant: "terrain" as const, stats: "320 tiles changed", diff: { "2-4": "changed", "2-5": "changed", "3-4": "added", "3-5": "added", "6-9": "changed", "7-9": "changed" } as Diff },
  { name: "vectors/levees.shp", type: "Shapefile" as const, variant: "vector" as const, stats: "86 features added", diff: { "4-2": "added", "4-3": "added", "5-3": "added", "5-4": "added" } as Diff },
];

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Compare · ${owner}/${repo}` };
}

/** How many changed files the page draws at first, and each step; `?files=` in the address asks for more. */
const FILES_PAGE = 50;

export default async function ComparePage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ base?: string; head?: string; compare?: string; files?: string }> }) {
  const { owner, repo } = await params;
  const query = await searchParams;
  const repoBase = `/${owner}/${repo}`;
  const [summary, { branches }] = await Promise.all([loadRepo(owner, repo), loadBranches(owner, repo)]);
  const names = branches.map((b) => b.name);
  const base = query.base && names.includes(query.base) ? query.base : summary.repo.defaultBranch;
  const requested = query.head ?? query.compare;
  const head = requested && names.includes(requested) ? requested : (names.find((n) => n !== base) ?? base);
  const same = base === head;
  const result = summary.live && !same ? await loadCompare(owner, repo, base, head) : null;
  const added = result?.files.reduce((n, f) => n + f.added, 0);
  const removed = result?.files.reduce((n, f) => n + f.removed, 0);
  // Drawn from the merge base, like the file list: what merging would bring in.
  // A comparison can change thousands of files: draw a page of them, and fetch previews only for those.
  const asked = Number(query.files);
  const shown = Number.isFinite(asked) && asked > FILES_PAGE ? Math.floor(asked) : FILES_PAGE;
  const visibleFiles = result ? result.files.slice(0, shown) : [];
  const hiddenFiles = result ? result.files.length - visibleFiles.length : 0;
  const moreHref = (n: number) => {
    const q = new URLSearchParams();
    if (query.base) q.set("base", query.base);
    const h = query.head ?? query.compare;
    if (h) q.set("head", h);
    q.set("files", String(n));
    return `?${q.toString()}`;
  };
  const previews = result ? await changePreviews(owner, repo, result.headCommit, result.mergeBase ?? result.baseCommit, visibleFiles) : {};
  const demoHead = branches.find((b) => b.name === head);

  return (
    <>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <PageHeader title="Compare changes" description="Pick two branches to see what merging one into the other would change, chunk by chunk." />

        <CompareBar
          repoBase={repoBase}
          branches={names}
          base={base}
          head={head}
          ahead={result?.ahead ?? (summary.live ? undefined : demoHead?.ahead)}
          behind={result?.behind ?? (summary.live ? undefined : demoHead?.behind)}
          added={result ? added : summary.live ? undefined : 406}
          removed={result ? removed : summary.live ? undefined : 12}
        />

        {same ? (
          <EmptyState icon={GitCompare} title="These are the same branch" description="Choose a different compare branch to see what changed." />
        ) : result ? (
          result.ahead === 0 ? (
            <EmptyState icon={GitCompare} title={`${base} already has everything in ${head}`} description={`${head} is ${result.behind} ${result.behind === 1 ? "commit" : "commits"} behind and has nothing new to merge.`} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <Badge variant="outline" className="tabular-nums">
                  {result.files.length} {result.files.length === 1 ? "file" : "files"} changed
                </Badge>
                <span className="tabular-nums">{formatBytes(result.newBytes)} of new data</span>
                <span>{result.fastForward ? "Fast-forward: no merge commit needed" : "Needs a merge commit"}</span>
              </div>

              {result.conflicts.length > 0 && (
                <div className="flex items-start gap-3 border border-destructive/40 bg-destructive/10 p-3 text-sm">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  <div>
                    <p className="font-medium">
                      {result.conflicts.length} {result.conflicts.length === 1 ? "file was" : "files were"} changed on both branches
                    </p>
                    <p className="text-muted-foreground">GIS files can’t be merged line by line; pick one version before merging.</p>
                    <ul className="mt-1 font-mono text-xs">
                      {result.conflicts.slice(0, 50).map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                      {result.conflicts.length > 50 && <li className="text-muted-foreground">and {(result.conflicts.length - 50).toLocaleString("en-US")} more</li>}
                    </ul>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
                <div className="flex min-w-0 flex-col gap-4">
                  {visibleFiles.map((f) => (
                    <Card key={f.name} className="cv-card overflow-hidden py-0">
                      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
                        {f.change === "removed" ? (
                          <span className="font-mono text-sm text-muted-foreground line-through">{f.name}</span>
                        ) : (
                          <Link href={`${repoBase}/blob/${f.name}?ref=${encodeURIComponent(head)}`} className="font-mono text-sm hover:underline">
                            {f.name}
                          </Link>
                        )}
                        {f.dataType && <DataTypeBadge type={f.dataType} />}
                        <span className="text-xs capitalize text-muted-foreground">{f.change}</span>
                        <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                          <span className="text-chart-1">+{f.added}</span> ={f.reused ?? 0} <span className="text-destructive">-{f.removed}</span> chunks
                        </span>
                      </div>
                      <CardContent className="flex flex-col gap-3 p-4">
                        {previews[f.name] && <ChangePreview preview={previews[f.name]} />}
                        <ChunkMap map={f.map ?? ""} before={f.sizeBefore ?? 0} after={f.sizeAfter ?? 0} change={f.change} />
                      </CardContent>
                    </Card>
                  ))}
                  {hiddenFiles > 0 && (
                    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                      <span>
                        Showing {visibleFiles.length.toLocaleString("en-US")} of {result.files.length.toLocaleString("en-US")} changed files.
                      </span>
                      <Link href={moreHref(shown + FILES_PAGE * 4)} className="text-foreground underline underline-offset-2 hover:no-underline">
                        Show {Math.min(FILES_PAGE * 4, hiddenFiles).toLocaleString("en-US")} more
                      </Link>
                      {hiddenFiles > FILES_PAGE * 4 && (
                        <Link href={moreHref(result.files.length)} className="text-foreground underline underline-offset-2 hover:no-underline">
                          Show all
                        </Link>
                      )}
                    </p>
                  )}
                </div>
                <aside className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">
                    Commits <span className="font-normal text-muted-foreground tabular-nums">{result.commits.length}</span>
                  </h2>
                  <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                    {result.commits.slice(0, 50).map((c) => (
                      <li key={c.sha} className="flex items-start gap-2 px-3 py-2.5 text-sm">
                        <Initials name={c.authorHandle} className="size-5" />
                        <div className="min-w-0 flex-1">
                          <Link href={`${repoBase}/commit/${c.sha}`} className="line-clamp-2 hover:underline">
                            {c.message}
                          </Link>
                          <p className="text-xs text-muted-foreground">
                            {c.authorHandle} · {c.timestamp} · <span className="font-mono">{c.sha.slice(0, 7)}</span>
                          </p>
                        </div>
                      </li>
                    ))}
                    {result.commits.length > 50 && <li className="px-3 py-2.5 text-xs text-muted-foreground">and {(result.commits.length - 50).toLocaleString("en-US")} older commits</li>}
                  </ul>
                </aside>
              </div>
            </>
          )
        ) : summary.live ? (
          <EmptyState icon={GitCompare} title="Couldn’t compare these branches" description="One of them may have been deleted. Pick another pair." />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <Badge variant="outline" className="tabular-nums">{demoFiles.length} files changed</Badge>
              <MapDiffLegend />
            </div>
            <div className="flex flex-col gap-4">
              {demoFiles.map((file) => (
                <Card key={file.name} className="overflow-hidden py-0">
                  <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
                    <span className="font-mono text-sm">{file.name}</span>
                    <DataTypeBadge type={file.type} />
                    <Badge variant="outline" className="ml-auto tabular-nums">{file.stats}</Badge>
                  </div>
                  <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                    <figure className="flex flex-col gap-1.5">
                      <MapPreview seed={file.name.length * 4} variant={file.variant} className="aspect-video" />
                      <figcaption className="font-mono text-xs text-muted-foreground">{base}</figcaption>
                    </figure>
                    <figure className="flex flex-col gap-1.5">
                      <MapPreview seed={file.name.length * 4} variant={file.variant} className="aspect-video" diff={file.diff} />
                      <figcaption className="font-mono text-xs text-muted-foreground">{head}</figcaption>
                    </figure>
                  </CardContent>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
