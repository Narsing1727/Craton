import type { Metadata } from "next";
import { Boxes, Database, HardDrive, Layers, ShieldCheck } from "lucide-react";
import { CommandLine, CopyButton, DownloadButton } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { KeyValueList, PageHeader, Section, StatGrid, StatTile } from "@/components/craton-ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { commits as demoCommits } from "@/lib/data";
import { mockSha256 } from "@/lib/download";
import { formatBytes } from "@/lib/format";
import { loadRepo, loadStorage } from "@/lib/source";

type Folder = { path: string; logical: string; stored: string; saved: number; codec: string };
type Source = { label: string; size: string; pct: number };

// ── Demo data (API not running) ──
const demoFolders: Folder[] = [
  { path: "terrain/", logical: "2.8 GB", stored: "1.21 GB", saved: 57, codec: "LERC, lossless" },
  { path: "vectors/", logical: "364 MB", stored: "142 MB", saved: 61, codec: "zstd" },
  { path: "model/", logical: "457 MB", stored: "296 MB", saved: 35, codec: "zstd" },
  { path: "gauges.csv, README.md", logical: "88 KB", stored: "31 KB", saved: 65, codec: "zstd" },
];
const demoSources: Source[] = [
  { label: "Unchanged chunks from earlier commits", size: "1.1 GB", pct: 48 },
  { label: "Shared with openterrain/srtm-30m-global", size: "612 MB", pct: 27 },
  { label: "Shared with forks of this repository", size: "590 MB", pct: 25 },
];

const pct = (part: number, whole: number) => (whole > 0 ? Math.max(0, Math.round((part / whole) * 100)) : 0);

export async function generateMetadata({ params }: { params: Promise<{ owner: string; repo: string }> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Storage · ${owner}/${repo}` };
}

export default async function StoragePage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const [summary, stats] = await Promise.all([loadRepo(owner, repo), loadStorage(owner, repo)]);
  const live = summary.live && stats !== null;

  let tiles: { logical: string; logicalHint: string; stored: string; storedDelta?: string; storedHint: string; chunks: string; chunksHint: string; ratio: string };
  let folders: Folder[];
  let sources: Source[];
  let shared: { repository: string; bytes: number; chunks: number }[] = [];
  let audit: string;
  let headSha: string;
  let root: string;
  let backend: string;

  if (live && stats) {
    const savedTotal = stats.historyBytes - stats.storedBytes;
    tiles = {
      logical: formatBytes(stats.logicalBytes),
      logicalHint: `Current files · ${formatBytes(stats.historyBytes)} across all history`,
      stored: formatBytes(stats.storedBytes),
      storedDelta: stats.historyBytes ? `−${pct(savedTotal, stats.historyBytes)}%` : undefined,
      storedHint: "Every version, after dedup and compression",
      chunks: stats.chunkCount.toLocaleString("en-US"),
      chunksHint: `Average ${formatBytes(stats.averageChunkBytes)} each`,
      ratio: `${stats.compressionRatio}×`,
    };
    folders = stats.folders.map((f) => ({
      path: f.path,
      logical: formatBytes(f.logicalBytes),
      stored: formatBytes(f.storedBytes),
      saved: pct(f.logicalBytes - f.storedBytes, f.logicalBytes),
      codec: f.codecs.map((c) => (c === "none" ? "stored as is" : `${c}, lossless`)).join(" · "),
    }));
    const compressionSaved = stats.uniqueBytes - stats.storedBytes;
    sources = [
      { label: "Unchanged chunks reused across commits", size: formatBytes(stats.savedByHistoryBytes), pct: pct(stats.savedByHistoryBytes, savedTotal) },
      { label: "Lossless compression (zstd)", size: formatBytes(compressionSaved), pct: pct(compressionSaved, savedTotal) },
    ];
    shared = stats.sharedWith ?? [];
    const pkg = await api.audit(owner, repo);
    // The package itself is a download (it can be megabytes); the page only needs the head and the root.
    audit = "";
    headSha = String(pkg?.head ?? summary.head?.sha ?? "");
    root = String(pkg?.merkleRoot ?? summary.head?.merkleRoot ?? "");
    backend = stats.storage === "cloudflare-r2" ? "Cloudflare R2" : "Local disk (data/chunks)";
  } else {
    tiles = { logical: summary.repo.size, logicalHint: "What you see in the repository", stored: "1.9 GB", storedDelta: "−55%", storedHint: "What counts toward the plan", chunks: "38,412", chunksHint: "Average 128 KB each", ratio: "1.9×" };
    folders = demoFolders;
    sources = demoSources;
    headSha = demoCommits[0].sha;
    root = mockSha256(`${owner}/${repo}@${headSha}`);
    audit = JSON.stringify(
      {
        repository: `${owner}/${repo}`,
        head: headSha,
        merkleRoot: root,
        commits: demoCommits.map((c) => ({ sha: c.sha, message: c.message, author: c.authorHandle, merkleRoot: mockSha256(`${owner}/${repo}@${c.sha}`) })),
      },
      null,
      2,
    );
    backend = "Cloudflare R2";
  }

  return (
    <>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <PageHeader
          title="Storage"
          description="Files are split into content-defined chunks. Identical chunks are stored once, compressed losslessly, and verified on every read."
        />

        <StatGrid>
          <StatTile label="Logical size" value={tiles.logical} hint={tiles.logicalHint} icon={HardDrive} />
          <StatTile label="Stored after dedup" value={tiles.stored} delta={tiles.storedDelta ? { value: tiles.storedDelta } : undefined} hint={tiles.storedHint} icon={Database} />
          <StatTile label="Chunks" value={tiles.chunks} hint={tiles.chunksHint} icon={Boxes} />
          <StatTile label="Compression" value={tiles.ratio} hint="Lossless only; no bounded-error modes" icon={Layers} />
        </StatGrid>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Section title="By folder" description="Current files: logical size against what their chunks take on disk.">
              <div className="border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Path</TableHead>
                      <TableHead className="text-right">Logical</TableHead>
                      <TableHead className="text-right">Stored</TableHead>
                      <TableHead className="w-44">Saved</TableHead>
                      <TableHead>Codec</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {folders.map((f) => (
                      <TableRow key={f.path}>
                        <TableCell className="font-mono text-xs">{f.path}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{f.logical}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{f.stored}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Progress value={f.saved} aria-label={`${f.saved}% saved`} className="flex-1" />
                            <span className="w-9 text-right font-mono text-xs tabular-nums text-muted-foreground">{f.saved}%</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.codec}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Section>

            <Section title="Where the savings come from" description={live ? "Against storing every version of every file in full." : "Chunks referenced instead of stored again."}>
              <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                {sources.map((s) => (
                  <li key={s.label} className="flex flex-col gap-2 px-4 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-pretty">{s.label}</span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">{s.size}</span>
                    </div>
                    <Progress value={s.pct} aria-label={`${s.pct}% of savings`} />
                  </li>
                ))}
              </ul>
            </Section>

            {live && (
              <Section title="Shared with public repositories" description="Chunks that public repositories also reference. They’re stored once and don’t count toward your plan.">
                {shared.length === 0 ? (
                  <p className="border border-dashed border-border p-4 text-sm text-muted-foreground">No chunks shared with public repositories.</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                    {shared.map((s) => (
                      <li key={s.repository} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <a href={`/${s.repository}`} className="font-mono text-xs hover:underline">
                          {s.repository}
                        </a>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {s.chunks} chunks · {formatBytes(s.bytes)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <ShieldCheck className="size-4 text-chart-1" aria-hidden />
                  Integrity and provenance
                </CardTitle>
                <CardDescription>
                  The Merkle root proves every byte of this commit. The audit package includes an inclusion proof for each file.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Merkle root at {headSha.slice(0, 7)}</span>
                  <div className="flex items-center gap-1 border border-border bg-muted/30 py-0.5 pl-2 pr-0.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{root}</code>
                    <CopyButton value={root} label="Copy Merkle root" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Verify your local copy</span>
                  <CommandLine command="craton fsck" />
                </div>
                {summary.live ? (
                  <Button variant="outline" size="sm" href={`/${owner}/${repo}/audit-package`} className="w-full">
                    Export audit package
                  </Button>
                ) : (
                  <DownloadButton filename={`${repo}-audit-package.json`} content={audit} type="application/json" className="w-full">
                    Export audit package
                  </DownloadButton>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Where it lives</CardTitle>
              </CardHeader>
              <CardContent>
                <KeyValueList
                  items={[
                    { label: "Object storage", value: backend },
                    { label: "Chunking", value: "FastCDC, 32–512 KB" },
                    { label: "Retention", value: "All history, no rewrites" },
                    { label: "Deleted branches", value: live ? "Commits kept; re-create any time" : "Recoverable for 30 days" },
                  ]}
                />
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}
