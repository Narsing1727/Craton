import type { Metadata } from "next";
import Link from "next/link";
import { Tag, Download, Database, GitCommit, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CliDialog, DownloadButton } from "@/components/craton-actions";
import { Timeline, TimelineConnector, TimelineDot, TimelineHeader, TimelineItem, TimelineTime, TimelineTitle } from "@/components/ui/timeline";
import type { Release } from "@/lib/data";
import { mockSha256 } from "@/lib/download";
import { loadReleases } from "@/lib/source";
import { ReleaseChanges } from "@/components/release-changes";

// Demo file list (API not running); live releases carry their own checksums.
const demoFiles = ["terrain/basin_dem.tif", "vectors/catchment.shp", "model/model.p01", "gauges.csv", "README.md"];
const NL = String.fromCharCode(10);

function filesOf(r: Release) {
  return r.checksums ?? demoFiles.map((path) => ({ path, size: 0, sha256: mockSha256(r.version + path) }));
}

function merkleOf(owner: string, repo: string, r: Release) {
  return r.merkleRoot ?? mockSha256(`${owner}/${repo}@${r.sha}`);
}

/** Same format as `sha256sum` and GET /releases/:tag/SHA256SUMS. */
function checksums(r: Release) {
  return filesOf(r).map((f) => `${f.sha256}  ${f.path}`).join(NL) + NL;
}

function manifest(owner: string, repo: string, r: Release) {
  return JSON.stringify(
    {
      repository: `${owner}/${repo}`,
      tag: r.version,
      commit: r.sha,
      merkleRoot: merkleOf(owner, repo, r),
      size: r.size,
      files: filesOf(r).map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    },
    null,
    2,
  );
}

export async function generateMetadata({ params }: { params: Promise<{ owner: string; repo: string }> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Releases · ${owner}/${repo}` };
}

export default async function ReleasesPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const { releases } = await loadReleases(owner, repo);

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Releases &amp; tags</h1>
            <p className="text-sm text-muted-foreground">
              Immutable, versioned snapshots of the full dataset with pinned checksums.
            </p>
          </div>
          <Button size="sm" href={`/${owner}/${repo}/releases/new`}>
            <Tag data-icon="inline-start" />
            New release
          </Button>
        </div>

        {releases.length === 0 && (
          <p className="mt-6 border border-dashed border-border p-6 text-sm text-muted-foreground">
            No releases yet. A release pins a commit and records the SHA-256 of every file in it.
          </p>
        )}

        <div className="mt-6 flex flex-col gap-5 md:grid md:grid-cols-[220px_1fr]">
          <aside className="hidden md:block">
            <Timeline>
              {releases.map((r) => (
                <TimelineItem key={r.version}>
                  <TimelineConnector />
                  <TimelineDot />
                  <TimelineHeader>
                    <TimelineTitle>
                      <a href={`#release-${r.version}`} className="hover:text-accent hover:underline">
                        {r.version}
                      </a>
                    </TimelineTitle>
                    <TimelineTime>{r.date}</TimelineTime>
                  </TimelineHeader>
                </TimelineItem>
              ))}
            </Timeline>
          </aside>

          <div className="flex flex-col gap-5">
            {releases.map((r, i) => (
              <Card key={r.version} id={`release-${r.version}`} className="scroll-mt-6">
                <CardHeader className="flex flex-wrap items-center gap-2">
                  <Tag className="size-4 text-accent" />
                  <span className="font-semibold">{r.version}</span>
                  {r.latest && <Badge>Latest</Badge>}
                  {r.prerelease && <Badge variant="outline">Pre-release</Badge>}
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <GitCommit className="size-3.5" />
                    <Link href={`/${owner}/${repo}/commit/${r.sha}`} className="font-mono hover:text-foreground hover:underline">
                      {r.sha}
                    </Link>
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {r.author} released this on {r.date}
                  </span>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <h2 className="text-base font-medium">{r.title}</h2>
                  <p className="text-sm text-muted-foreground">{r.notes}</p>
                  {r.run && <RunSummary run={r.run} />}
                  {/* Releases are newest first, so the next one down is the previous release. Live data only. */}
                  {r.checksums && releases[i + 1]?.checksums && (
                    <ReleaseChanges owner={owner} repo={repo} previous={releases[i + 1].version} baseSha={releases[i + 1].sha} current={r.version} headSha={r.sha} />
                  )}
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">{filesOf(r).length} files</span>
                    <span aria-hidden>·</span>
                    <span>Merkle root</span>
                    <code className="font-mono text-foreground">{merkleOf(owner, repo, r).slice(0, 16)}…</code>
                  </p>
                  <Separator />
                  <div className="flex flex-wrap items-center gap-2">
                    <CliDialog
                      trigger={
                        <Button variant="outline" size="sm">
                          <Database data-icon="inline-start" />
                          Full dataset
                          <Badge variant="outline" className="ml-1 tabular-nums">{r.size}</Badge>
                        </Button>
                      }
                      title={`Get ${r.version}`}
                      description={`${r.size} is fetched with the CLI so it can resume, skip chunks you already have and verify every checksum.`}
                      commands={[
                        { label: "1. Download the release", command: `craton clone ${owner}/${repo} --tag ${r.version}` },
                        { label: "2. Verify every file against the Merkle root", command: "craton fsck" },
                      ]}
                    />
                    {r.checksums ? (
                      <>
                        {/* A live release can list thousands of files, so these are downloads, not text in the page. */}
                        <Button variant="outline" size="sm" href={`/${owner}/${repo}/releases/${encodeURIComponent(r.version)}/manifest.json`}>
                          <Download data-icon="inline-start" />
                          Manifest (JSON)
                        </Button>
                        <Button variant="ghost" size="sm" href={`/${owner}/${repo}/releases/${encodeURIComponent(r.version)}/SHA256SUMS`}>
                          <FileCheck2 data-icon="inline-start" />
                          Checksums
                        </Button>
                      </>
                    ) : (
                      <>
                        <DownloadButton filename={`${repo}-${r.version}-manifest.json`} content={manifest(owner, repo, r)} type="application/json">
                          <Download data-icon="inline-start" />
                          Manifest (JSON)
                        </DownloadButton>
                        <DownloadButton filename={`${repo}-${r.version}-SHA256SUMS.txt`} content={checksums(r)} variant="ghost">
                          <FileCheck2 data-icon="inline-start" />
                          Checksums
                        </DownloadButton>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

const duration = (seconds: number) => {
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const m = Math.round(seconds / 60);
  return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim();
};

/** The run a release was made from: what ran, which plan, how long, and which commits fed it. */
function RunSummary({ run }: { run: NonNullable<Release["run"]> }) {
  const what = [[run.software, run.version].filter(Boolean).join(" "), run.plan, run.runtimeSeconds !== undefined ? duration(run.runtimeSeconds) : ""].filter(Boolean);
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-border pl-3 text-xs text-muted-foreground">
      <p>
        <span className="font-medium text-foreground">Model run</span>
        {what.length > 0 && <> · {what.join(" · ")}</>}
      </p>
      {run.notes && <p className="text-pretty">{run.notes}</p>}
      {run.inputs && run.inputs.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {run.inputs.map((i) => (
            <li key={`${i.repo}@${i.commit}`}>
              Input <span className="font-mono text-foreground">{i.repo}@{i.commit.slice(0, 7)}</span>
              {i.note ? ` (${i.note})` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
