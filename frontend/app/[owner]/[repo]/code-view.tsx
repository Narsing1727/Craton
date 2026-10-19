"use client";

import { UserAvatar } from "@/components/user-avatar";
import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useSoftNav } from "@/lib/use-soft-nav";
import { Code2, Download, FileText, GitBranch, History, MapPin, Scale, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PublishReadiness } from "@/components/publish-readiness";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MapPreview } from "@/components/map-preview";
import { DataPreview } from "@/components/data-preview";
import { DataTypeBadge } from "@/components/data-type-badge";
import { CiteDialog } from "@/components/cite-dialog";
import { UploadDialog } from "@/components/upload-dialog";
import { Kbd } from "@/components/ui/kbd";
import { OPEN_GO_TO_FILE } from "@/lib/shortcuts";
import { describeBBox, osmLink } from "@/lib/geo";
import type { Branch, Repo } from "@/lib/data";
import FileTree, { type FileTreeItem } from "@/components/file-tree";

/** `src` is the rendered preview; null in demo mode, where a schematic stands in. */
export type CodeViewPreview = { path: string; caption: string; src: string | null; error: string | null; /** Width over height of the picture, so its frame has no empty bands. */ aspect?: number };

export type CodeViewProps = {
  owner: string;
  repo: string;
  data: Repo;
  branches: Pick<Branch, "name" | "isDefault">[];
  currentRef: string;
  head: { author: string; message: string; sha: string; updated: string } | null;
  items: FileTreeItem[];
  initialExpanded: string[];
  readme: string | null;
  /** Whether the repository has at least one release (for the completeness checklist). */
  hasRelease?: boolean;
  commitCount: number;
  crs: string;
  preview: CodeViewPreview | null;
};

export function CodeView({ owner, repo, data, branches, currentRef, head, items, initialExpanded, readme, commitCount, crs, preview, hasRelease }: CodeViewProps) {
  const nav = useSoftNav();
  const base = `/${owner}/${repo}`;
  const [selected, setSelected] = useState<string | undefined>(preview?.path);
  const [expanded, setExpanded] = useState<string[]>(initialExpanded);
  const isBranch = branches.some((b) => b.name === currentRef);

  function switchRef(next: string) {
    nav.go(next === data.defaultBranch ? base : `${base}?ref=${encodeURIComponent(next)}`);
  }

  return (
    <>
      <h1 className="sr-only">{owner}/{repo}</h1>
      <div className="grid grid-cols-1 w-full gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px]">
        <div className={cn("flex min-w-0 flex-col gap-4 transition-opacity", nav.pending && "opacity-60")} aria-busy={nav.pending}>
          {/* Branch bar */}
          <div className="flex flex-wrap items-center gap-3">
            <Select value={isBranch ? currentRef : "__commit"} onValueChange={(v) => v !== "__commit" && switchRef(String(v))}>
              <SelectTrigger className="w-48" aria-label="Switch branch">
                <GitBranch className="size-4" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {!isBranch && (
                    <SelectItem value="__commit" className="font-mono">
                      {currentRef.slice(0, 7)}
                    </SelectItem>
                  )}
                  {branches.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" render={<Link href={`${base}/branches`} />}>
              <GitBranch data-icon="inline-start" />
              <span className="tabular-nums">{branches.length}</span> branches
            </Button>
            <Button variant="outline" size="sm" render={<Link href={isBranch && currentRef !== data.defaultBranch ? `${base}/commits?ref=${encodeURIComponent(currentRef)}` : `${base}/commits`} />}>
              <History data-icon="inline-start" />
              <span className="tabular-nums">{commitCount.toLocaleString("en-US")}</span> commits
            </Button>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <UploadDialog
                owner={owner}
                repo={repo}
                branches={branches.map((b) => b.name)}
                defaultBranch={data.defaultBranch}
                currentRef={currentRef}
                expected={isBranch && head && /^[0-9a-f]{64}$/.test(head.sha) ? head.sha : undefined}
              />
              <Button variant="outline" size="sm" onClick={() => window.dispatchEvent(new Event(OPEN_GO_TO_FILE))}>
                <Search data-icon="inline-start" />
                Go to file
                <Kbd className="ml-1">t</Kbd>
              </Button>
              <Button variant="outline" size="sm" render={<a href={`${base}/archive?ref=${encodeURIComponent(currentRef)}`} download />}>
                <Download data-icon="inline-start" />
                Download ZIP
              </Button>
              <Button size="sm" render={<Link href={`${base}/compare`} />}>
                <Code2 data-icon="inline-start" />
                Compare
              </Button>
            </div>
          </div>

          {/* File table */}
          <Card className="overflow-hidden py-0">
            {head && (
              <div className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
                <UserAvatar handle={head.author} className="size-6" fallbackClassName="text-[0.6rem]" />
                <span className="text-sm font-medium">{head.author}</span>
                <span className="truncate text-sm text-muted-foreground">{head.message}</span>
                <Link
                  href={`${base}/commit/${head.sha}`}
                  className="ml-auto shrink-0 font-mono text-xs text-muted-foreground hover:text-foreground hover:underline"
                >
                  {head.sha.slice(0, 7)} · {head.updated}
                </Link>
              </div>
            )}
            <FileTree
              items={items}
              expanded={expanded}
              onExpandedChange={setExpanded}
              onSelectedChange={setSelected}
              selected={selected}
              showLines
            />
          </Card>

          {/* README */}
          {readme && (
            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">README.md</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="prose-sm max-w-none">
                  {readme.trim().split(/\n\s*\n/).map((block, i) => (
                    <ReadmeBlock key={i} block={block} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <aside className="flex flex-col gap-6">
          <div>
            <h2 className="mb-2 text-sm font-medium">About</h2>
            <p className="text-sm text-muted-foreground">{data.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {data.tags.map((t) => (
                <DataTypeBadge key={t} type={t} />
              ))}
            </div>
            {(data.topics?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.topics!.map((t) => (
                  <Link key={t} href={`/explore?topic=${encodeURIComponent(t)}`} className="border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:border-foreground/40 hover:text-foreground">
                    {t}
                  </Link>
                ))}
              </div>
            )}
            {data.footprint && (
              <p className="mt-3 flex items-start gap-1.5 text-sm text-muted-foreground">
                <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  <span className="sr-only">Covers </span>
                  {describeBBox(data.footprint)}{" "}
                  <a href={osmLink(data.footprint)} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap underline underline-offset-2 hover:text-foreground">
                    Open in a map<span className="sr-only"> (opens OpenStreetMap)</span>
                  </a>
                </span>
              </p>
            )}
            <div className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
              <Scale className="size-3.5 shrink-0" aria-hidden />
              {data.license ? (data.license === "proprietary" ? "All rights reserved" : data.license) : (
                <Link href={`${base}/settings`} className="hover:text-foreground hover:underline">
                  No licence chosen
                </Link>
              )}
            </div>
            <div className="mt-3">
              <CiteDialog owner={owner} repo={repo} />
            </div>
          </div>
          <PublishReadiness
            base={base}
            input={{ description: data.description ?? "", license: data.license ?? "", topics: data.topics, verticalDatum: data.verticalDatum ?? null, nodata: data.nodata ?? null, footprint: data.footprint ?? null, hasRelease: !!hasRelease, hasReadme: !!readme }}
          />
          <Separator />
          <div className="flex flex-col gap-3 text-sm">
            <Detail label="Region" value={data.region || "—"} />
            <Detail label="Total size" value={data.size} />
            <Detail label="Default branch" value={data.defaultBranch} mono />
            <Detail label="Required CRS" value={crs} mono />
          </div>
          {preview && (
            <>
              <Separator />
              <div>
                <h2 className="mb-3 text-sm font-medium">Latest preview</h2>
                {preview.src ? (
                  <DataPreview src={preview.src} alt={`Hillshade of ${preview.path}`} error={preview.error} aspect={preview.aspect} className={preview.aspect ? undefined : "aspect-4/3"} />
                ) : (
                  <MapPreview seed={5} className="aspect-video" />
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  <Link href={`${base}/blob/${preview.path}`} className="hover:text-foreground hover:underline">
                    {preview.path}
                  </Link>
                  {preview.caption && ` · ${preview.caption}`}
                </p>
              </div>
            </>
          )}
          <Separator />
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1.5">
              <Badge variant="outline" className="tabular-nums">{data.stars}</Badge> stars
            </span>
          </div>
        </aside>
      </div>
    </>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}

/** Inline `code` spans inside README text. */
function Inline({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("`") && p.endsWith("`") ? (
          <code key={i} className="bg-muted px-1 py-0.5 font-mono text-[0.8em] text-foreground">
            {p.slice(1, -1)}
          </code>
        ) : (
          p
        ),
      )}
    </>
  );
}

function ReadmeBlock({ block }: { block: string }) {
  if (block.startsWith("# ")) return <h2 className="mb-2 font-serif text-2xl font-semibold">{block.slice(2)}</h2>;
  if (block.startsWith("## ")) return <h3 className="mb-2 mt-4 text-lg font-semibold">{block.slice(3)}</h3>;
  if (block.startsWith("- ")) {
    return (
      <ul className="my-2 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
        {block.split("\n").map((line, i) => (
          <li key={i}>
            <Inline text={line.replace(/^- /, "")} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p className="my-2 text-sm text-muted-foreground">
      <Inline text={block} />
    </p>
  );
}
