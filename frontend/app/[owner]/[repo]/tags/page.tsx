import type { Metadata } from "next";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Tags · ${owner}/${repo}` };
}

import { Download, GitCommit, Tag, Terminal } from "lucide-react";
import { CliDialog, CopyButton, DownloadButton } from "@/components/craton-actions";
import { ScopeTabs } from "@/components/scope-tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { loadReleases } from "@/lib/source";
import { mockSha256 } from "@/lib/download";

export default async function TagsPage({
  params,
}: {
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const base = `/${owner}/${repo}`;
  const { releases } = await loadReleases(owner, repo);

  return (
    <>
      <h1 className="sr-only">Tags · {owner}/{repo}</h1>
      <div className="flex w-full flex-col gap-5 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <ScopeTabs
            label="Releases and tags"
            active="tags"
            tabs={[
              { id: "releases", label: "Releases", href: `${base}/releases`, count: releases.length },
              { id: "tags", label: "Tags", href: `${base}/tags`, count: releases.length },
            ]}
          />
          <Button size="sm" variant="outline" href={`${base}/releases/new`}>
            <Tag data-icon="inline-start" />
            Create a tag
          </Button>
        </div>

        <ul className="flex flex-col divide-y divide-border border border-border bg-card">
          {releases.map((rel) => {
            const manifest = JSON.stringify(
              { repository: `${owner}/${repo}`, tag: rel.version, commit: rel.sha, merkleRoot: rel.merkleRoot ?? mockSha256(`${owner}/${repo}@${rel.sha}`), size: rel.size, files: rel.checksums },
              null,
              2,
            );
            return (
              <li key={rel.version} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <Tag className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`${base}/releases#release-${rel.version}`} className="font-mono text-sm font-semibold hover:underline">
                        {rel.version}
                      </Link>
                      {rel.latest && <Badge variant="outline">Latest</Badge>}
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <GitCommit className="size-3" aria-hidden />
                      <Link href={`${base}/commit/${rel.sha}`} className="font-mono hover:underline">
                        {rel.sha}
                      </Link>
                      <CopyButton value={rel.sha} label={`Copy commit ${rel.sha}`} />
                      <span>tagged {rel.date} by {rel.author}</span>
                      <span className="font-mono tabular-nums">· {rel.size}</span>
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <CliDialog
                    trigger={
                      <Button variant="outline" size="sm">
                        <Terminal data-icon="inline-start" />
                        Get this version
                      </Button>
                    }
                    title={`Get ${rel.version}`}
                    description={`${rel.size} downloads through the CLI, skipping chunks you already have.`}
                    commands={[{ command: `craton clone ${owner}/${repo} --tag ${rel.version}` }]}
                  />
                  <DownloadButton filename={`${repo}-${rel.version}-manifest.json`} content={manifest} type="application/json" variant="ghost">
                    <Download data-icon="inline-start" />
                    Manifest
                  </DownloadButton>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
