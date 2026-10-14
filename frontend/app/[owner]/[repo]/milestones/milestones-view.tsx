"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Flag, Pencil, Plus } from "lucide-react";
import { notify } from "@/components/button-status";
import { createMilestoneAction, deleteMilestoneAction, updateMilestoneAction } from "@/app/actions";
import { ConfirmAction } from "@/components/craton-actions";
import { EmptyState } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ApiMilestone } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The issue list filtered to one milestone (the list understands `milestone:"…"`). */
const issuesFor = (owner: string, repo: string, title: string, state: "open" | "closed" = "open") =>
  `/${owner}/${repo}/issues?state=${state}&q=${encodeURIComponent(`milestone:"${title}"`)}`;

export function MilestonesView({ owner, repo, milestones, canWrite, today }: { owner: string; repo: string; milestones: ApiMilestone[]; canWrite: boolean; today: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<"open" | "closed">("open");
  const [editing, setEditing] = useState<ApiMilestone | "new" | null>(null);
  const shown = milestones.filter((m) => m.state === tab);
  const count = (s: "open" | "closed") => milestones.filter((m) => m.state === s).length;

  async function setState(m: ApiMilestone, state: "open" | "closed") {
    const r = await updateMilestoneAction(owner, repo, m.id, { state });
    if (!r.ok) return void notify.error("Couldn’t update the milestone", { description: r.error });
    notify.success(state === "closed" ? `Closed ${m.title}` : `Reopened ${m.title}`);
    router.refresh();
  }

  async function remove(m: ApiMilestone) {
    const r = await deleteMilestoneAction(owner, repo, m.id);
    if (!r.ok) return void notify.error("Couldn’t delete the milestone", { description: r.error });
    notify.success(`Deleted ${m.title}`, { description: r.data.unassigned ? `${r.data.unassigned} issue${r.data.unassigned === 1 ? " is" : "s are"} no longer assigned to it.` : undefined });
    router.refresh();
  }

  return (
    <>
      <h1 className="sr-only">Milestones · {owner}/{repo}</h1>
      <div className="flex w-full max-w-4xl flex-col gap-4 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup value={[tab]} onValueChange={(v) => v[0] && setTab(v[0] as "open" | "closed")} variant="outline" size="sm" spacing={0} aria-label="Milestone state">
            <ToggleGroupItem value="open">
              Open <span className="tabular-nums text-muted-foreground">{count("open")}</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="closed">
              Closed <span className="tabular-nums text-muted-foreground">{count("closed")}</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" href={`/${owner}/${repo}/issues`}>
              Issues
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => setEditing("new")}>
                <Plus data-icon="inline-start" />
                New milestone
              </Button>
            )}
          </div>
        </div>

        {shown.length === 0 ? (
          <EmptyState
            icon={Flag}
            title={tab === "open" ? "No open milestones" : "No closed milestones"}
            description="A milestone groups issues under a goal, like a release or a re-survey, with an optional due date."
            action={canWrite && tab === "open" ? <Button size="sm" onClick={() => setEditing("new")}>New milestone</Button> : undefined}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border bg-card" aria-label={`${tab === "open" ? "Open" : "Closed"} milestones`}>
            {shown.map((m) => {
              const total = m.open + m.closed;
              const pct = total ? Math.round((m.closed / total) * 100) : 0;
              const overdue = m.state === "open" && m.due !== null && m.due < today;
              return (
                <li key={m.id} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={issuesFor(owner, repo, m.title, m.state === "closed" ? "closed" : "open")} className="text-sm font-medium hover:underline">
                        {m.title}
                      </Link>
                      <p className={cn("mt-0.5 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
                        {m.due ? `${overdue ? "Overdue since" : "Due"} ${formatDate(m.due)}` : "No due date"}
                      </p>
                    </div>
                    {canWrite && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditing(m)} aria-label={`Edit ${m.title}`}>
                          <Pencil data-icon="inline-start" />
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setState(m, m.state === "open" ? "closed" : "open")}>
                          {m.state === "open" ? "Close" : "Reopen"}
                        </Button>
                        <ConfirmAction
                          trigger={<Button variant="ghost" size="sm" aria-label={`Delete ${m.title}`}>Delete</Button>}
                          title={`Delete ${m.title}?`}
                          description={total ? `${total} issue${total === 1 ? "" : "s"} will stay, but no longer belong to a milestone.` : "No issues use it."}
                          confirmLabel="Delete milestone"
                          onConfirm={() => remove(m)}
                        />
                      </div>
                    )}
                  </div>
                  {m.description && <p className="text-sm text-muted-foreground text-pretty">{m.description}</p>}
                  <div className="flex items-center gap-3">
                    <div className="h-1.5 w-full max-w-xs bg-muted" role="progressbar" aria-label={`${m.title} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <div className="h-full bg-chart-1" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {total ? `${pct}% done · ${m.open} open · ${m.closed} closed` : "No issues yet"}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {editing && <MilestoneDialog owner={owner} repo={repo} milestone={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function MilestoneDialog({ owner, repo, milestone, onClose }: { owner: string; repo: string; milestone: ApiMilestone | null; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(milestone?.title ?? "");
  const [description, setDescription] = useState(milestone?.description ?? "");
  const [due, setDue] = useState(milestone?.due ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!title.trim()) return void setError("Give the milestone a title.");
    setPending(true);
    setError(null);
    const body = { title: title.trim(), description: description.trim(), due: due || null };
    const r = milestone ? await updateMilestoneAction(owner, repo, milestone.id, body) : await createMilestoneAction(owner, repo, body);
    setPending(false);
    if (!r.ok) return void setError(r.error);
    notify.success(milestone ? "Saved" : `Created ${body.title}`);
    onClose();
    router.refresh();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={save} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{milestone ? "Edit milestone" : "New milestone"}</DialogTitle>
            <DialogDescription>Issues are grouped under it. Renaming it renames it on its issues.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ms-title">Title</FieldLabel>
              <Input id="ms-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="v2.0 2026 terrain" maxLength={60} autoFocus aria-invalid={Boolean(error) && !title.trim()} />
            </Field>
            <Field>
              <FieldLabel htmlFor="ms-due">
                Due date <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Input id="ms-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="w-44" />
            </Field>
            <Field>
              <FieldLabel htmlFor="ms-desc">
                Description <span className="font-normal text-muted-foreground">(optional)</span>
              </FieldLabel>
              <Textarea id="ms-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
              <FieldDescription>What finishing it means.</FieldDescription>
            </Field>
          </FieldGroup>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={pending}>
              {milestone ? "Save changes" : "Create milestone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
