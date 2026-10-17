"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ClipboardCheck, Plus } from "lucide-react";
import { notify } from "@/components/button-status";
import { createModelReviewAction } from "@/app/actions";
import { EmptyState } from "@/components/craton-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import type { ApiModelReviewSummary } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export const STATUS_LABEL: Record<ApiModelReviewSummary["status"], string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
};

export function ReviewsView({ owner, repo, reviews, canWrite, defaultRef }: { owner: string; repo: string; reviews: ApiModelReviewSummary[]; canWrite: boolean; defaultRef: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState("");
  const [ref, setRef] = useState(defaultRef);
  const [pending, start] = useTransition();

  function create(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await createModelReviewAction(owner, repo, { title: title.trim(), ref: ref.trim() || undefined });
      if (!r.ok) return void notify.error("Couldn’t open the review", { description: r.error });
      setCreating(false);
      router.push(`/${owner}/${repo}/reviews/${r.data.number}`);
    });
  }

  return (
    <>
      <h1 className="sr-only">Model review · {owner}/{repo}</h1>
      <div className="flex w-full max-w-4xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-xl text-sm text-muted-foreground text-pretty">
            A review pins one version of the model, works through a QA checklist, keeps the modelling log, and records who signed it off. The Merkle root names exactly which files the sign-off covers.
          </p>
          {canWrite && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus data-icon="inline-start" />
              New review
            </Button>
          )}
        </div>

        {reviews.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No model reviews yet"
            description="Open one when a model is ready for checking. It captures the validation findings and each HEC-RAS plan’s own run status, so the checklist starts with what the software already knows."
            action={canWrite ? <Button size="sm" onClick={() => setCreating(true)}>New review</Button> : undefined}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border bg-card" aria-label="Model reviews">
            {reviews.map((r) => {
              const decided = r.counts.pass + r.counts.fail + r.counts.na;
              const total = decided + r.counts.todo;
              return (
                <li key={r.number}>
                  <Link href={`/${owner}/${repo}/reviews/${r.number}`} className="flex flex-col gap-1.5 px-4 py-3 outline-none transition-colors hover:bg-muted/30 focus-visible:bg-muted/30">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{r.title}</span>
                      <Badge variant={r.status === "approved" ? "default" : "outline"}>{STATUS_LABEL[r.status]}</Badge>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="tabular-nums">#{r.number}</span>
                      <span>
                        <span className="font-mono">{r.ref}</span> at <span className="font-mono">{r.commit.slice(0, 7)}</span>
                      </span>
                      <span className="tabular-nums">
                        {decided} of {total} items{r.counts.fail ? `, ${r.counts.fail} failed` : ""}
                      </span>
                      <span>
                        opened by {r.createdBy ?? "someone"} {timeAgo(r.createdAt)}
                      </span>
                      {r.lastDecision && (
                        <span>
                          {r.lastDecision.decision === "approve" ? "approved" : "changes requested"} by {r.lastDecision.by ?? "someone"}
                        </span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <form onSubmit={create} noValidate>
            <DialogHeader>
              <DialogTitle>New model review</DialogTitle>
              <DialogDescription>It is pinned to the commit this ref points to now. You can re-pin it to a later version while it is a draft.</DialogDescription>
            </DialogHeader>
            <FieldGroup className="py-4">
              <Field>
                <FieldLabel htmlFor="review-title">Title</FieldLabel>
                <Input id="review-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Chalakudy 2D model, 100-year event…" autoComplete="off" required autoFocus />
              </Field>
              <Field>
                <FieldLabel htmlFor="review-ref">Branch, tag or commit</FieldLabel>
                <Input id="review-ref" value={ref} onChange={(e) => setRef(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />
                <FieldDescription>A release tag is the usual choice for a submission.</FieldDescription>
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={pending || !title.trim()}>
                Open review
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
