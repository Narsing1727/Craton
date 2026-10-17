import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Code2,
  Database,
  FileText,
  Folder,
  FolderUp,
  GitBranch,
  History,
  Map as MapIcon,
  Sheet,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { DataTypeBadge } from "@/components/data-type-badge";
import { RefSelect } from "@/components/ref-select";
import type { FileNode } from "@/lib/data";
import { loadBranches, loadFolder, loadRepo } from "@/lib/source";

const fileIcons: Record<FileNode["type"], typeof Folder> = {
  dir: Folder,
  raster: MapIcon,
  vector: Sheet,
  table: Table2,
  text: FileText,
  model: Database,
};

type Params = { owner: string; repo: string; path: string[] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo, path } = await params;
  return { title: `${path.slice(1).map(decodeURIComponent).join("/") || repo} · ${owner}/${repo}` };
}

/** A folder lists this many entries at first; `?show=` in the address asks for more (a folder can hold thousands of files). */
const ENTRIES_PAGE = 200;

export default async function SubfolderPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ show?: string }> }) {
  const { owner, repo, path: raw } = await params;
  const asked = Number((await searchParams).show);
  const path = raw.map(decodeURIComponent);
  const [{ repo: data, live }, { branches }] = await Promise.all([loadRepo(owner, repo), loadBranches(owner, repo)]);
  const base = `/${owner}/${repo}`;

  // URLs are /tree/<branch or commit>/<folder>; older links may omit the ref.
  const isRefFirst = path.length > 0 && (branches.some((b) => b.name === path[0]) || /^[0-9a-f]{7,64}$/.test(path[0]));
  const branch = isRefFirst ? path[0] : data.defaultBranch || "main";
  const folderSegments = isRefFirst ? path.slice(1) : path;
  const folderPath = folderSegments.join("/");
  const blobQuery = branch === data.defaultBranch ? "" : `?ref=${encodeURIComponent(branch)}`;

  // Determine parent route for ".."
  const parentHref =
    folderSegments.length <= 1
      ? base
      : `${base}/tree/${branch}/${folderSegments.slice(0, -1).join("/")}`;

  const folder = await loadFolder(owner, repo, branch, folderPath);
  if (live && !folder.live) notFound();
  // Folders exist only through the files in them, so a folder with nothing in it isn't there.
  if (live && folderPath !== "" && folder.entries.length === 0) notFound();
  const shown = Number.isFinite(asked) && asked > ENTRIES_PAGE ? Math.floor(asked) : ENTRIES_PAGE;
  const contents = folder.entries.slice(0, shown);
  const hidden = folder.entries.length - contents.length;
  const latest = folder.latest ?? { sha: "a1b2c3d", message: `Update ${folderSegments.at(-1) || "directory"} contents`, author: "priyam", updated: "3 hours ago" };

  return (
    <>
      <h1 className="sr-only">{folderPath || repo} · {owner}/{repo}</h1>

      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        {/* Branch selector & Breadcrumbs */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            <RefSelect
              base={base}
              branches={branches.map((b) => b.name)}
              value={branch}
              defaultBranch={data.defaultBranch}
              target="tree"
              path={folderPath}
              size="sm"
              className="w-40 text-xs"
            />

            {/* Breadcrumb Path */}
            <Breadcrumb>
              <BreadcrumbList className="text-sm">
                <BreadcrumbItem>
                  <BreadcrumbLink href={base} className="font-semibold hover:underline text-foreground">
                    {repo}
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {folderSegments.map((seg, idx) => {
                  const isLast = idx === folderSegments.length - 1;
                  const segPath = folderSegments.slice(0, idx + 1).join("/");
                  return (
                    <React.Fragment key={seg}>
                      <BreadcrumbSeparator />
                      <BreadcrumbItem>
                        {isLast ? (
                          <BreadcrumbPage className="font-bold text-foreground">
                            {seg}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink
                            href={`${base}/tree/${branch}/${segPath}`}
                            className="hover:underline text-muted-foreground hover:text-foreground"
                          >
                            {seg}
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </React.Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" href={`${base}/compare`}>
              <Code2 className="size-3.5" />
              Compare
            </Button>
          </div>
        </div>

        {/* Directory File Table */}
        <Card className="overflow-hidden py-0">
          {/* Commit Bar */}
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <Avatar className="size-5">
                <AvatarFallback className="text-[10px]">{latest.author.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="font-medium text-foreground">{latest.author}</span>
              <Link href={`${base}/commit/${latest.sha}`} className="truncate hover:text-foreground hover:underline">
                {latest.message}
              </Link>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-muted-foreground">{latest.sha.slice(0, 7)}</span>
              <span>{latest.updated}</span>
              <Link href={branch === data.defaultBranch ? `${base}/commits` : `${base}/commits?ref=${encodeURIComponent(branch)}`} className="flex items-center gap-1 hover:text-foreground">
                <History className="size-3.5" />
                <span>History</span>
              </Link>
            </div>
          </div>

          {/* Directory listing */}
          <ul className="divide-y divide-border">
            {/* ".." Parent Directory Row */}
            <li className="bg-muted/10 hover:bg-muted/20 transition-colors">
              <Link
                href={parentHref}
                className="flex items-center gap-3 px-4 py-2.5 text-sm font-semibold text-foreground"
                title="Go to parent directory"
              >
                <FolderUp className="size-4 text-blue-500 shrink-0" />
                <span className="text-foreground">..</span>
                <span className="text-xs text-muted-foreground font-normal ml-1">
                  Go to parent directory
                </span>
              </Link>
            </li>

            {/* Subfolders and Files */}
            {contents.map((item) => {
              const Icon = fileIcons[item.type];
              const isDir = item.type === "dir";
              const itemHref = isDir
                ? `${base}/tree/${branch}/${folderPath ? `${folderPath}/${item.name}` : item.name}`
                : `${base}/blob/${folderPath ? `${folderPath}/${item.name}` : item.name}${blobQuery}`;

              return (
                <li key={item.name} className="cv-row">
                  <Link
                    href={itemHref}
                    className="flex items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-muted/40 group"
                  >
                    {isDir ? (
                      <Folder className="size-4 text-blue-500 fill-blue-500/20 shrink-0" />
                    ) : (
                      <Icon className="size-4 text-muted-foreground shrink-0" />
                    )}

                    <span className={`font-medium ${isDir ? "text-foreground group-hover:underline" : "text-foreground group-hover:underline"}`}>
                      {item.name}
                    </span>

                    {isDir && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-border text-foreground font-mono">
                        subfolder
                      </Badge>
                    )}

                    {item.dataType && <DataTypeBadge type={item.dataType} />}

                    <span className="ml-auto hidden truncate text-muted-foreground sm:block text-xs">
                      {item.lastCommit}
                    </span>

                    <span className="w-16 shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {item.size}
                    </span>

                    <span className="hidden w-24 shrink-0 text-right text-xs text-muted-foreground md:block">
                      {item.updated}
                    </span>
                  </Link>
                </li>
              );
            })}
            {hidden > 0 && (
              <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm text-muted-foreground">
                <span>
                  Showing {contents.length.toLocaleString("en-US")} of {folder.entries.length.toLocaleString("en-US")} entries.
                </span>
                <Link href={`?show=${shown + ENTRIES_PAGE * 5}`} className="text-foreground underline underline-offset-2 hover:no-underline">
                  Show {Math.min(ENTRIES_PAGE * 5, hidden).toLocaleString("en-US")} more
                </Link>
                {hidden > ENTRIES_PAGE * 5 && (
                  <Link href={`?show=${folder.entries.length}`} className="text-foreground underline underline-offset-2 hover:no-underline">
                    Show all
                  </Link>
                )}
              </li>
            )}
          </ul>
        </Card>
      </div>
    </>
  );
}
