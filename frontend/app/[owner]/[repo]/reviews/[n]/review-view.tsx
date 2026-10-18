"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckCircle2, ChevronRight, Download, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";
import { notify } from "@/components/button-status";
import { addReviewLogAction, decideReviewAction, refreshReviewEvidenceAction, reopenReviewAction, setReviewItemAction, submitReviewAction } from "@/app/actions";
import { useSession } from "@/components/session";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ApiModelReview, ApiReviewItem } from "@/lib/api";
import { formatBytes, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { STATUS_LABEL } from "../reviews-view";

const RESULT: { value: ApiReviewItem["status"]; label: string }[] = [
  { value: "pass", label: "Pass" },
  { value: "fail", label: "Fail" },
  { value: "na", label: "N/A" },
  { value: "todo", label: "To do" },
];

export function ReviewView({ owner, repo, review, canWrite }: { owner: string; repo: string; review: ApiModelReview; canWrite: boolean }) {
  const router = useRouter();
  const me = useSession();
  const [comment, setComment] = useState("");
  const [logText, setLogText] = useState("");
  const [pending, start] = useTransition();
  const locked = review.status === "approved";
  const editable = canWrite && !locked;
  const decided = review.counts.pass + review.counts.fail + review.counts.na;
  const total = decided + review.counts.todo;
  const groups = [...new Set(review.items.map((i) => i.group))];
  const isAuthor = me?.handle === review.createdBy;

  /** Run an action, say what went wrong in plain words, and refresh the page's data. */
  function run(label: string, fn: () => Promise<{ ok: true } | { ok: false; error: string }>, after?: () => void) {
    start(async () => {
      const r = await fn();
      if (!r.ok) return void notify.error(label, { description: r.error });
      after?.();
      router.refresh();
    });
  }

  return (
    <>
      <h1 className="sr-only">
        Model review #{review.number} · {owner}/{repo}
      </h1>
      <div className="flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-muted-foreground">
          <Link href={`/${owner}/${repo}/reviews`} className="hover:text-foreground hover:underline">
            Model review
          </Link>
          <ChevronRight className="size-3" aria-hidden />
          <span className="tabular-nums">#{review.number}</span>
        </nav>

        <header className="flex flex-col gap-3 border-b border-border pb-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-semibold tracking-tight text-balance">{review.title}</h2>
                <Badge variant={locked ? "default" : "outline"}>{STATUS_LABEL[review.status]}</Badge>
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  Pinned to <span className="font-mono text-foreground">{review.ref}</span> at <span className="font-mono text-foreground">{review.commit.slice(0, 12)}</span>
                </span>
                <span>
                  opened by {review.createdBy ?? "someone"} {timeAgo(review.createdAt)}
                </span>
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                Merkle root <span className="font-mono text-foreground">{review.merkleRoot}</span>
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" href={`/${owner}/${repo}/commit/${review.commit}`}>
                View commit
              </Button>
              <a
                href={`/${owner}/${repo}/reviews/${review.number}/export`}
                download
                className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
              >
                <Download className="size-4" aria-hidden />
                Export
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3" role="group" aria-label="Checklist progress">
            <div className="h-1.5 w-full max-w-xs bg-muted" aria-hidden>
              <div className="h-full bg-chart-1" style={{ width: `${total ? (decided / total) * 100 : 0}%` }} />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {decided} of {total} decided · {review.counts.pass} pass · {review.counts.fail} fail · {review.counts.na} n/a
            </span>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-labelledby="checklist-title" className="flex min-w-0 flex-col gap-6">
            <h3 id="checklist-title" className="sr-only">
              Checklist
            </h3>
            {groups.map((g) => (
              <div key={g} className="flex flex-col gap-2">
                <h4 className="text-sm font-semibold">{g}</h4>
                <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                  {review.items
                    .filter((i) => i.group === g)
                    .map((item) => (
                      <ItemRow key={`${item.key}:${item.status}:${item.updatedAt ?? ""}`} item={item} editable={editable} busy={pending} onSet={(patch) => run("Couldn’t save the item", () => setReviewItemAction(owner, repo, review.number, item.key, patch))} />
                    ))}
                </ul>
              </div>
            ))}
          </section>

          <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
            <Card>
              <CardHeader>
                <CardTitle>Sign-off</CardTitle>
                <CardDescription>
                  {review.status === "draft" && "Work through the checklist, then send it for decision."}
                  {review.status === "changes_requested" && "The reviewer asked for changes. Update the items, then submit again."}
                  {review.status === "in_review" && "Waiting for a decision. Every item must be marked, and every failure explained."}
                  {review.status === "approved" && "Approved and locked. The log stays open."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {review.signoffs.length > 0 && (
                  <ul className="flex flex-col gap-2 text-xs">
                    {review.signoffs.map((s) => (
                      <li key={s.id} className="flex items-start gap-2">
                        {s.decision === "approve" ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-chart-1" aria-hidden /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-chart-3" aria-hidden />}
                        <span className="min-w-0">
                          <span className="font-medium">{s.user ?? "someone"}</span> {s.decision === "approve" ? "approved" : "asked for changes"} {timeAgo(s.at)}
                          {!s.independent && <span className="text-muted-foreground"> (the author: not an independent review)</span>}
                          {s.comment && <span className="block text-muted-foreground">{s.comment}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}

                {canWrite && review.status !== "approved" && (
                  <>
                    {review.status === "in_review" && <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Comment (needed when asking for changes)…" rows={3} maxLength={1000} aria-label="Decision comment" />}
                    <div className="flex flex-wrap gap-2">
                      {(review.status === "draft" || review.status === "changes_requested") && (
                        <Button size="sm" loading={pending} disabled={pending} onClick={() => run("Couldn’t submit the review", () => submitReviewAction(owner, repo, review.number))}>
                          Submit for review
                        </Button>
                      )}
                      {review.status === "in_review" && (
                        <>
                          <Button size="sm" loading={pending} disabled={pending} onClick={() => run("Couldn’t approve", () => decideReviewAction(owner, repo, review.number, "approve", comment.trim()), () => setComment(""))}>
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" disabled={pending || !comment.trim()} onClick={() => run("Couldn’t record the decision", () => decideReviewAction(owner, repo, review.number, "request_changes", comment.trim()), () => setComment(""))}>
                            Request changes
                          </Button>
                        </>
                      )}
                    </div>
                    {review.status === "in_review" && isAuthor && (
                      <p className="text-xs text-muted-foreground text-pretty">You opened this review. You can approve it, and the record will say it was not independently reviewed.</p>
                    )}
                  </>
                )}

                {canWrite && locked && (
                  <>
                    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Why is it being reopened…" rows={2} maxLength={500} aria-label="Reason for reopening" />
                    <Button size="sm" variant="outline" className="self-start" disabled={pending || !comment.trim()} onClick={() => run("Couldn’t reopen", () => reopenReviewAction(owner, repo, review.number, comment.trim()), () => setComment(""))}>
                      Reopen as draft
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            <EvidenceCard review={review} editable={editable} busy={pending} onRefresh={() => run("Couldn’t refresh the evidence", () => refreshReviewEvidenceAction(owner, repo, review.number), () => notify.success("Evidence refreshed"))} />

            <Card>
              <CardHeader>
                <CardTitle>Modelling log</CardTitle>
                <CardDescription>What was done and decided. Entries are never edited or removed.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <ol className="flex flex-col gap-2 text-xs">
                  {review.log.map((l) => (
                    <li key={l.id} className="border-l-2 border-border pl-3">
                      <span className="text-muted-foreground">
                        {l.author ?? "someone"} · {timeAgo(l.at)}
                      </span>
                      <p className="mt-0.5 whitespace-pre-wrap text-pretty">{l.body}</p>
                    </li>
                  ))}
                </ol>
                {canWrite && (
                  <div className="flex flex-col gap-2">
                    <Textarea value={logText} onChange={(e) => setLogText(e.target.value)} placeholder="Mesh refined to 10 m near the levee…" rows={3} maxLength={4000} aria-label="New log entry" />
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start"
                      disabled={pending || !logText.trim()}
                      onClick={() => run("Couldn’t add to the log", () => addReviewLogAction(owner, repo, review.number, logText.trim()), () => setLogText(""))}
                    >
                      Add to log
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </>
  );
}

function ItemRow({ item, editable, busy, onSet }: { item: ApiReviewItem; editable: boolean; busy: boolean; onSet: (patch: { status?: ApiReviewItem["status"]; note?: string }) => void }) {
  const [note, setNote] = useState(item.note);
  const [showNote, setShowNote] = useState(item.note.length > 0 || item.status === "fail");
  const needsNote = item.status === "fail" && note.trim().length < 3;
  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-pretty">{item.text}</p>
          <p className="mt-1 text-xs text-muted-foreground text-pretty">
            {item.hint} <span className="whitespace-nowrap">· {item.source}</span>
          </p>
        </div>
        <ToggleGroup
          value={[item.status]}
          onValueChange={(v) => {
            const next = v[0] as ApiReviewItem["status"] | undefined;
            if (!next || next === item.status) return;
            if (next === "fail") setShowNote(true);
            onSet({ status: next });
          }}
          variant="outline"
          size="sm"
          spacing={0}
          disabled={!editable || busy}
          aria-label={`Result for: ${item.text}`}
        >
          {RESULT.map((r) => (
            <ToggleGroupItem key={r.value} value={r.value} className={cn(item.status === r.value && r.value === "pass" && "text-chart-1", item.status === r.value && r.value === "fail" && "text-destructive")}>
              {r.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {item.suggestion && (
        <p className={cn("flex flex-wrap items-center gap-2 border border-dashed border-border px-2.5 py-1.5 text-xs text-pretty", item.suggestion.status === "fail" ? "text-destructive" : "text-muted-foreground")}>
          <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1">Automated: {item.suggestion.detail}</span>
          {editable && item.status === "todo" && item.suggestion.status && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => onSet({ status: item.suggestion!.status!, note: note || item.suggestion!.detail.slice(0, 400) })}>
              Use as {item.suggestion.status}
            </Button>
          )}
        </p>
      )}

      {!editable && item.note ? (
        <p className="whitespace-pre-wrap border-l-2 border-border pl-3 text-xs text-pretty">{item.note}</p>
      ) : showNote || item.note ? (
        <div className="flex flex-col gap-1">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note.trim() !== item.note.trim() && onSet({ note })}
            placeholder={item.status === "fail" ? "What was found, and why it is accepted…" : "Note…"}
            rows={2}
            maxLength={2000}
            readOnly={!editable}
            aria-label={`Note for: ${item.text}`}
            aria-invalid={needsNote || undefined}
          />
          {needsNote && <span className="text-xs text-destructive">A failed item needs a note before the review can be approved.</span>}
        </div>
      ) : (
        editable && (
          <button type="button" onClick={() => setShowNote(true)} className="self-start text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
            Add a note
          </button>
        )
      )}
      {item.updatedBy && (
        <p className="text-[11px] text-muted-foreground">
          Marked by {item.updatedBy}
          {item.updatedAt ? ` ${timeAgo(item.updatedAt)}` : ""}
        </p>
      )}
    </li>
  );
}

function EvidenceCard({ review, editable, busy, onRefresh }: { review: ApiModelReview; editable: boolean; busy: boolean; onRefresh: () => void }) {
  const ev = review.evidence;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Automated findings</CardTitle>
        <CardDescription>
          Captured {timeAgo(ev.capturedAt)} from {ev.files.count} files ({formatBytes(ev.files.bytes)}).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-xs">
        {ev.checks ? (
          <div className="flex flex-col gap-1.5">
            <p className="flex items-center gap-2 font-medium">
              Validation gate
              <Badge variant={ev.checks.status === "passed" ? "outline" : "default"}>{ev.checks.status}</Badge>
            </p>
            <ul className="flex flex-col gap-1">
              {ev.checks.steps
                .filter((s) => s.status !== "skipped")
                .map((s) => (
                  <li key={s.name} className="flex items-baseline justify-between gap-3">
                    <span className="text-muted-foreground">{s.name}</span>
                    <span className={cn("shrink-0", s.status === "failed" && "text-destructive")}>{s.status}</span>
                  </li>
                ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">No validation gate run is recorded for this commit.</p>
        )}

        {ev.runs.length > 0 && (
          <div className="flex flex-col gap-1.5 border-t border-border pt-3">
            <p className="font-medium">HEC-RAS plans</p>
            <ul className="flex flex-col gap-2">
              {ev.runs.map((r) => (
                <li key={r.path} className="flex flex-col gap-0.5">
                  <span className="break-all font-mono">{r.path.split("/").pop()}</span>
                  <span className={cn(r.unstable ? "text-destructive" : "text-muted-foreground")}>
                    {r.solution ?? "no status recorded"}
                    {r.maxWselError !== null ? ` · max WSEL error ${r.maxWselError}` : ""}
                    {r.computeTotal ? ` · ${r.computeTotal}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {editable && (
          <Button variant="outline" size="sm" className="self-start" disabled={busy} onClick={onRefresh}>
            <RefreshCw data-icon="inline-start" />
            Capture again
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
