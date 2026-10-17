import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Download, FileText, Scale } from "lucide-react";
import { Message, Shell } from "./share-shell";
import { Button } from "@/components/ui/button";
import { sharedView, type ApiSharedView } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";

// What a share link opens: a read-only snapshot, for someone who may have no Craton account.
// Standalone on purpose (no app header, no sign-in prompts in the way), and never indexed.

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared with you", robots: { index: false, follow: false }, referrer: "no-referrer" };

const SHOWN = 500;
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const enc = (path: string) => path.split("/").map(encodeURIComponent).join("/");

export default async function SharedPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const r = await sharedView(token);
  if (r.status === "gone") notFound(); // a real 404, with the friendly message from not-found.tsx
  if (r.status === "busy") return <Message title="Too many tries" body="Wait a few minutes and open the link again." />;
  if (r.status === "down") return <Message title="Craton can’t be reached right now" body="Try again in a moment." />;
  return <Snapshot token={token} view={r.view} />;
}

function Snapshot({ token, view }: { token: string; view: ApiSharedView }) {
  const { repository: repo, snapshot, files } = view;
  const daysLeft = Math.max(0, Math.ceil((new Date(view.expiresAt).getTime() - Date.now()) / 86_400_000));
  const files$ = [...files].sort((a, b) => (a.path < b.path ? -1 : 1));
  const previewable = files$.find((f) => /\.tiff?$/i.test(f.path)) ?? files$.find((f) => /\.shp$/i.test(f.path));

  return (
    <Shell>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">Shared snapshot</p>
      <h1 className="mt-1 text-2xl font-semibold">
        <span className="text-muted-foreground">{repo.owner} / </span>
        {repo.name}
      </h1>
      {repo.description && <p className="mt-2 max-w-2xl text-sm text-muted-foreground text-pretty">{repo.description}</p>}

      <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <div className="flex gap-1.5">
          <dt className="sr-only">Version</dt>
          <dd>
            <span className="font-mono text-foreground">{snapshot.commit.slice(0, 7)}</span> “{snapshot.message}” by {snapshot.author}, {timeAgo(snapshot.timestamp)}
          </dd>
        </div>
        <div className="flex gap-1.5">
          <dt>Coordinate system</dt>
          <dd className="font-mono text-foreground">{repo.crs}</dd>
        </div>
        {repo.license && (
          <div className="flex items-center gap-1.5">
            <Scale className="size-3.5" aria-hidden />
            <dt className="sr-only">Licence</dt>
            <dd className="text-foreground">{repo.license === "proprietary" ? "All rights reserved" : repo.license}</dd>
          </div>
        )}
      </dl>

      {view.note && (
        <blockquote className="mt-5 border-l-2 border-border pl-4 text-sm text-pretty">
          <p className="text-xs text-muted-foreground">A note from {repo.owner}</p>
          {view.note}
        </blockquote>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 border border-border bg-card px-4 py-3">
        <Button render={<a href={`/s/${token}/archive`} download />}>
          <Download data-icon="inline-start" />
          Download everything
          <span className="font-mono text-xs opacity-70">{formatBytes(view.totalBytes)} · ZIP</span>
        </Button>
        <p className="text-xs text-muted-foreground">
          This link works until {day(view.expiresAt)} ({daysLeft === 0 ? "less than a day left" : `${daysLeft} ${daysLeft === 1 ? "day" : "days"} left`}).
        </p>
      </div>

      {previewable && (
        <section className="mt-6" aria-label="Preview">
          <h2 className="mb-2 text-sm font-semibold">Preview</h2>
          <div className="border border-border bg-card p-3">
            {/* Drawn by the API from the file's bytes, already sized. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/s/${token}/render/${enc(previewable.path)}?size=640`} alt={`Preview of ${previewable.path}`} className="mx-auto max-h-96 w-auto max-w-full object-contain" loading="lazy" />
            <p className="mt-2 text-center font-mono text-xs text-muted-foreground">{previewable.path}</p>
          </div>
        </section>
      )}

      <section className="mt-6" aria-label="Files">
        <h2 className="mb-2 text-sm font-semibold">
          {files$.length} {files$.length === 1 ? "file" : "files"}
        </h2>
        <ul className="divide-y divide-border border border-border bg-card">
          {files$.slice(0, SHOWN).map((f) => (
            <li key={f.path} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
              <a href={`/s/${token}/file/${enc(f.path)}`} download className="shrink-0 text-xs font-medium text-blue-500 underline-offset-2 hover:underline">
                Download<span className="sr-only"> {f.path}</span>
              </a>
            </li>
          ))}
        </ul>
        {files$.length > SHOWN && <p className="mt-2 text-xs text-muted-foreground">Showing the first {SHOWN}. “Download everything” has all {files$.length.toLocaleString("en-US")}.</p>}
      </section>
    </Shell>
  );
}
