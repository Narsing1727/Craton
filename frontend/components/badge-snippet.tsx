"use client";

// "Add a status badge": the default branch's check result, the latest release, the size or the licence as an
// image for a README or wiki. Public repositories only, because the badge address works without signing in.

import * as React from "react";
import { CopyButton } from "@/components/craton-actions";

const BADGES = [
  { file: "checks", label: "Checks", about: "Whether the latest check run on the default branch passed." },
  { file: "release", label: "Release", about: "The latest release that is not a pre-release." },
  { file: "size", label: "Size", about: "How much the repository stores, after deduplication and compression." },
  { file: "license", label: "Licence", about: "The licence set in the repository's settings." },
] as const;

export function BadgeSnippet({ owner, repo }: { owner: string; repo: string }) {
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  return (
    <section className="mt-8 flex flex-col gap-3 border border-border p-4" aria-labelledby="badge-title">
      <h2 id="badge-title" className="text-sm font-medium">Badges</h2>
      <p className="text-xs text-muted-foreground">Small images for a README or wiki. Each updates by itself.</p>
      <ul className="flex flex-col divide-y divide-border">
        {BADGES.map((b) => {
          const path = `/${owner}/${repo}/badge/${b.file}.svg`;
          const markdown = `![${b.label}](${origin}${path})`;
          return (
            <li key={b.file} className="flex flex-col gap-1.5 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">{b.about}</span>
                {/* eslint-disable-next-line @next/next/no-img-element -- an SVG badge served by the API */}
                <img src={path} alt={`${b.label} badge of ${owner}/${repo}`} height={20} />
              </div>
              <div className="flex items-center gap-1 border border-border bg-muted/30 py-0.5 pl-2 pr-0.5">
                <code className="min-w-0 flex-1 truncate font-mono text-[11px]">{markdown}</code>
                <CopyButton value={markdown} label={`Copy ${b.label.toLowerCase()} badge Markdown`} />
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
