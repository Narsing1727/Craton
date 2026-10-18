"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, CircleCheck, FileCode2, GitBranch, GitCommit, GitPullRequest, TriangleAlert } from "lucide-react";
import { notify } from "@/components/button-status";
import { EmptyState, Initials } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Commit } from "@/lib/data";
import { createPullAction } from "@/app/actions";

type Summary = { ahead: number; behind: number; commits: Commit[]; files: number; conflicts: string[] };

function BranchSelect({ value, branches, onChange, label }: { value: string; branches: string[]; onChange: (v: string) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => v && onChange(String(v))}>
      <SelectTrigger className="w-52 font-mono" aria-label={label}>
        <GitBranch className="size-3.5" aria-hidden />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {branches.map((b) => (
            <SelectItem key={b} value={b} className="font-mono">
              {b}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function NewPullView({
  owner,
  repo,
  branches,
  baseBranch,
  compareBranch,
  summary,
  checks,
  live,
  template = "",
}: {
  owner: string;
  repo: string;
  branches: string[];
  baseBranch: string;
  compareBranch: string;
  summary: Summary;
  checks: "passed" | "failed" | null;
  live: boolean;
  /** The repository's pull request template, which starts the description. */
  template?: string;
}) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const pick = (b: string, h: string) => router.replace(`${base}/pulls/new?base=${encodeURIComponent(b)}&head=${encodeURIComponent(h)}`, { scroll: false });
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState(template);
  const [reviewer, setReviewer] = useState("sarat");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);

  const same = baseBranch === compareBranch;
  const branchCommits = summary.commits;
  const titleError = !title.trim() ? "Summarize the change in a few words." : null;
  const checksFailing = checks === "failed";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (same || titleError || pending) {
      document.getElementById("pr-title")?.focus();
      return;
    }
    if (!live) {
      notify.success("Pull request opened", { description: `${compareBranch} → ${baseBranch}. ${reviewer} was asked to review.` });
      router.push(`${base}/pulls`);
      return;
    }
    setPending(true);
    const result = await createPullAction(owner, repo, { title: title.trim(), body: description.trim(), source: compareBranch, target: baseBranch });
    setPending(false);
    if (!result.ok) {
      notify.error("Couldn’t open the pull request", { description: result.error });
      return;
    }
    notify.success(`Opened #${result.data.number}`, { description: `${compareBranch} → ${baseBranch}` });
    router.push(`${base}/pull/${result.data.number}`);
  }

  return (
    <>
      <div className="mx-auto flex w-full flex-col gap-6 px-4 sm:px-6 py-6 lg:w-[70%] lg:px-0">
        <div>
          <h1 className="text-xl font-semibold">New pull request</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">Propose merging one branch’s data into another. Reviewers see a map diff of every change.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border border-border bg-card p-3">
          <span className="text-xs text-muted-foreground">into</span>
          <BranchSelect value={baseBranch} branches={branches} onChange={(v) => pick(v, compareBranch)} label="Base branch" />
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-xs text-muted-foreground">from</span>
          <BranchSelect value={compareBranch} branches={branches} onChange={(v) => pick(baseBranch, v)} label="Compare branch" />
          <span className="ml-auto flex items-center gap-1.5 text-xs" aria-live="polite">
            {same ? (
              <>
                <TriangleAlert className="size-4 text-chart-3" aria-hidden /> Choose two different branches.
              </>
            ) : summary.ahead === 0 ? (
              <>
                <TriangleAlert className="size-4 text-chart-3" aria-hidden /> {baseBranch} already has everything in {compareBranch}.
              </>
            ) : summary.conflicts.length ? (
              <>
                <TriangleAlert className="size-4 text-destructive" aria-hidden /> {summary.conflicts.length} files changed on both branches. Merging will need a decision.
              </>
            ) : checksFailing ? (
              <>
                <TriangleAlert className="size-4 text-chart-3" aria-hidden /> Checks are failing on {compareBranch}. You can open it, but merging stays blocked.
              </>
            ) : checks === null ? (
              <>
                <TriangleAlert className="size-4 text-chart-3" aria-hidden /> Checks haven’t run on {compareBranch} yet.
              </>
            ) : (
              <>
                <CircleCheck className="size-4 text-chart-1" aria-hidden /> Checks pass and there are no conflicts.
              </>
            )}
          </span>
        </div>

        {same ? (
          <EmptyState
            icon={GitPullRequest}
            title="Nothing to compare"
            description={`${compareBranch} is the same branch as ${baseBranch}.`}
            action={<Button variant="outline" size="sm" onClick={() => pick(baseBranch, branches.find((b) => b !== baseBranch) ?? baseBranch)}>Pick another branch</Button>}
          />
        ) : (
          <form onSubmit={create} noValidate className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
            <div className="flex min-w-0 flex-col gap-5">
              <FieldGroup>
                <Field data-invalid={touched && titleError ? true : undefined}>
                  <FieldLabel htmlFor="pr-title">Title</FieldLabel>
                  <Input
                    id="pr-title"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-invalid={touched && !!titleError}
                    placeholder="e.g. Raise embankment crest along the right bank by 0.5 m…"
                    className="h-10 text-base"
                    autoFocus
                  />
                  {touched && titleError && <FieldError>{titleError}</FieldError>}
                </Field>
                <Field>
                  <FieldLabel htmlFor="pr-desc">Description</FieldLabel>
                  <Textarea
                    id="pr-desc"
                    rows={8}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Which datasets changed, why, and how you validated the result (e.g. re-ran the 100-yr event)."
                  />
                </Field>
              </FieldGroup>

              <section className="flex flex-col gap-2">
                <h2 className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                  <span className="flex items-center gap-1"><GitCommit className="size-3.5" aria-hidden /> {branchCommits.length} commits</span>
                  <span className="flex items-center gap-1"><FileCode2 className="size-3.5" aria-hidden /> {summary.files} files</span>
                </h2>
                <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                  {branchCommits.map((c) => (
                    <li key={c.sha} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Initials name={c.authorHandle} />
                      <span className="min-w-0 flex-1 truncate">{c.message}</span>
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.sha.slice(0, 7)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
                <Button variant="ghost" href={`${base}/pulls`}>
                  Cancel
                </Button>
                <Button type="submit" loading={pending} disabled={pending}>
                  <GitPullRequest data-icon="inline-start" />
                  Create pull request
                </Button>
              </div>
            </div>

            <aside className="flex flex-col gap-5 text-sm">
              {!live && (
              <Field>
                <FieldLabel className="text-xs font-medium text-muted-foreground">Reviewer</FieldLabel>
                <Select value={reviewer} onValueChange={setReviewer}>
                  <SelectTrigger className="w-full" aria-label="Reviewer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-full">
                    <SelectGroup>
                      <SelectItem value="sarat">sarat</SelectItem>
                      <SelectItem value="arunn">arunn</SelectItem>
                      <SelectItem value="vikramr">vikramr</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              )}
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span className="font-medium">Branch</span>
                <span className="font-mono tabular-nums">
                  {summary.ahead} ahead · {summary.behind} behind {baseBranch}
                </span>
              </div>
            </aside>
          </form>
        )}
      </div>
    </>
  );
}
