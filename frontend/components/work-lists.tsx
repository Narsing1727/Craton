"use client";

// Issue and pull request lists with working filters (Linear style).
// Filter state is mirrored into the URL (?state=closed&label=bug&q=datum) so views can be shared.

import { SavedFilters } from "@/components/saved-filters";
import * as React from "react";
import Link from "next/link";
import { CircleDot, FileWarning, Flag, GitPullRequest, MessageSquare, Search } from "lucide-react";
import { EmptyState, Initials, StatusBadge, StatusIcon } from "@/components/craton-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Issue, PullRequest } from "@/lib/data";
import { cn } from "@/lib/utils";
import { matchesFields, matchesWords, parseQuery, removeOperator, removeToken, stateOperator, type FieldSpec, type ParsedQuery } from "@/lib/search-query";

export const labelStyles: Record<Issue["label"], string> = {
  "data-quality": "bg-chart-1/15 text-chart-1 border-chart-1/30",
  question: "bg-chart-3/20 text-foreground border-chart-3/60",
  enhancement: "bg-chart-2/20 text-foreground border-chart-2/60",
  bug: "bg-destructive/10 text-destructive border-destructive/30",
};

function syncUrl(params: Record<string, string>, defaults: Record<string, string>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (!v || v === defaults[k]) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  window.history.replaceState(null, "", url);
}

function Toolbar({
  query,
  onQuery,
  placeholder,
  children,
}: {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:[&>:last-child]:ml-auto">
      <InputGroup className="h-8 w-full sm:w-[22rem] sm:flex-none">
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput type="search" aria-label={placeholder} placeholder={placeholder} value={query} onChange={(e) => onQuery(e.target.value)} />
      </InputGroup>
      {children}
    </div>
  );
}

/** The operators found in the search box, as chips you can take back out. */
function QueryChips({ parsed, onChange }: { parsed: ParsedQuery; onChange: (q: string) => void }) {
  if (parsed.operators.length === 0) return null;
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {parsed.operators.map((t, i) => (
        <li key={`${t.raw}-${i}`}>
          <button
            type="button"
            onClick={() => onChange(removeToken(parsed, t))}
            className="inline-flex items-center gap-1 border border-border bg-muted/30 px-2 py-0.5 font-mono text-xs text-foreground hover:bg-muted"
            aria-label={`Remove filter ${t.negate ? "not " : ""}${t.key} ${t.value}`}
          >
            <span className="text-muted-foreground">{t.negate ? "not " : ""}{t.key}:</span>
            {t.value}
            <span aria-hidden className="ml-0.5 text-muted-foreground">×</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export type IssueWithRepo = Issue & { repo: string };

const ISSUE_KEYS = ["is", "label", "author", "assignee", "file", "milestone", "no"] as const;
const issueFields: Record<string, FieldSpec<IssueWithRepo>> = {
  label: { get: (i) => i.label, mode: "exact" },
  author: { get: (i) => i.author, mode: "exact" },
  assignee: { get: (i) => i.assignee, mode: "exact" },
  file: { get: (i) => i.reference, mode: "contains" },
  milestone: { get: (i) => i.milestone, mode: "exact" },
};

const PULL_KEYS = ["is", "author", "branch", "reviewer", "check", "no"] as const;
const pullFields: Record<string, FieldSpec<PullWithRepo>> = {
  author: { get: (p) => p.author, mode: "exact" },
  branch: { get: (p) => [p.source, p.target], mode: "contains" },
  reviewer: { get: (p) => p.reviewers, mode: "exact" },
  check: { get: (p) => p.checks, mode: "exact" },
};

export function IssueList({
  issues,
  showRepo = false,
  initial,
  newHref,
  milestonesHref,
}: {
  issues: IssueWithRepo[];
  showRepo?: boolean;
  initial?: { state?: string; label?: string; q?: string };
  newHref?: string;
  /** Link to the repository's milestones, when this list is one repository's. */
  milestonesHref?: string;
}) {
  const [state, setState] = React.useState(initial?.state === "closed" ? "closed" : "open");
  const [label, setLabel] = React.useState(initial?.label ?? "all");
  const [query, setQuery] = React.useState(initial?.q ?? "");

  React.useEffect(() => {
    syncUrl({ state, label, q: query.trim() }, { state: "open", label: "all", q: "" });
  }, [state, label, query]);

  const q = query.trim().toLowerCase();
  const parsed = parseQuery(query, ISSUE_KEYS);
  // `is:closed` in the box wins over the toggle; clicking the toggle takes it back out of the box.
  const stateOp = stateOperator(parsed, ["open", "closed"] as const);
  const effectiveState = stateOp ?? state;
  const matches = issues.filter(
    (i) =>
      (label === "all" || i.label === label) &&
      matchesWords(`${i.title} ${i.reference ?? ""} ${i.author} #${i.id}`, parsed) &&
      matchesFields(i, parsed, issueFields),
  );
  const open = matches.filter((i) => i.status === "open");
  const closed = matches.filter((i) => i.status === "closed");
  const shown = effectiveState === "open" ? open : closed;
  const labels = [...new Set(issues.map((i) => i.label))];

  return (
    <div className="flex flex-col gap-3">
      <Toolbar query={query} onQuery={setQuery} placeholder="Search issues, or try is:closed label:bug">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[effectiveState]}
          onValueChange={(v) => {
            if (!v[0]) return;
            setState(v[0]);
            if (stateOp) setQuery(removeOperator(parsed, "is"));
          }}
          aria-label="Issue state"
        >
          <ToggleGroupItem value="open">
            <CircleDot aria-hidden /> <span className="tabular-nums">{open.length}</span> Open
          </ToggleGroupItem>
          <ToggleGroupItem value="closed">
            <span className="tabular-nums">{closed.length}</span> Closed
          </ToggleGroupItem>
        </ToggleGroup>
        <Select value={label} onValueChange={setLabel}>
          <SelectTrigger size="sm" className="w-40" aria-label="Filter by label">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectGroup>
              <SelectItem value="all">All labels</SelectItem>
              {labels.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <SavedFilters kind="issues" current={{ state: effectiveState, label, q: query }} onApply={(f) => { setState(f.state === "closed" ? "closed" : "open"); setLabel(f.label); setQuery(f.q); }} />
        {milestonesHref && (
          <Button size="sm" variant="outline" href={milestonesHref}>
            <Flag data-icon="inline-start" />
            Milestones
          </Button>
        )}
        {newHref && (
          <Button size="sm" href={newHref}>
            <CircleDot data-icon="inline-start" />
            New issue
          </Button>
        )}
      </Toolbar>
      <QueryChips parsed={parsed} onChange={setQuery} />

      {shown.length === 0 ? (
        <EmptyState
          icon={CircleDot}
          title={q || label !== "all" ? "No issues match these filters" : effectiveState === "open" ? "No open issues" : "No closed issues"}
          description={q || label !== "all" ? "Try another search or label." : "Issues track data-quality problems, questions and requests."}
          action={
            q || label !== "all" ? (
              <Button variant="outline" size="sm" onClick={() => { setQuery(""); setLabel("all"); }}>
                Clear filters
              </Button>
            ) : newHref ? (
              <Button size="sm" href={newHref}>New issue</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border border border-border bg-card" aria-label="Issues">
          {shown.map((issue) => (
            <li key={`${issue.repo}#${issue.id}`} className="group relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
              <StatusIcon status={issue.status === "open" ? "open" : "closed"} className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {showRepo && <span className="font-mono text-xs text-muted-foreground">{issue.repo}</span>}
                  <Link
                    href={`/${issue.repo}/issues/${issue.id}`}
                    data-list-item
                    className="text-sm font-medium hover:underline after:absolute after:inset-0"
                  >
                    {issue.title}
                  </Link>
                  <Badge variant="outline" className={labelStyles[issue.label]}>
                    {issue.label}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    #{issue.id} opened {issue.updated} by {issue.author}
                  </span>
                  {issue.reference && (
                    <span className="flex items-center gap-1">
                      <FileWarning className="size-3" aria-hidden />
                      <code className="bg-muted px-1 py-0.5 font-mono">{issue.reference}</code>
                    </span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                <Initials name={issue.author} className="hidden sm:flex" />
                <span className={cn("flex w-8 items-center justify-end gap-1 tabular-nums", issue.comments === 0 && "invisible")}>
                  <MessageSquare className="size-3.5" aria-hidden />
                  {issue.comments}
                  <span className="sr-only">comments</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export type PullWithRepo = PullRequest & { repo: string; checks?: "passed" | "failed" | "running"; reviewRequested?: boolean };

const prStatus = (s: PullRequest["status"]) =>
  s === "merged" ? "merged" : s === "closed" ? "closed" : s === "changes-requested" ? "changes-requested" : s === "approved" ? "approved" : "open";

export function PullList({
  pulls,
  showRepo = false,
  initial,
  newHref,
}: {
  pulls: PullWithRepo[];
  showRepo?: boolean;
  initial?: { state?: string; q?: string };
  newHref?: string;
}) {
  const [state, setState] = React.useState(initial?.state === "merged" ? "merged" : "open");
  const [query, setQuery] = React.useState(initial?.q ?? "");

  React.useEffect(() => {
    syncUrl({ state, q: query.trim() }, { state: "open", q: "" });
  }, [state, query]);

  const q = query.trim();
  const parsed = parseQuery(query, PULL_KEYS);
  const stateOp = stateOperator(parsed, ["open", "merged", "closed"] as const);
  // The toggle has two groups; `is:merged` and `is:closed` pick the group and then the exact status.
  const effectiveState = stateOp ? (stateOp === "open" ? "open" : "merged") : state;
  const matches = pulls.filter((p) => matchesWords(`${p.title} ${p.source} ${p.author} #${p.id}`, parsed) && matchesFields(p, parsed, pullFields));
  const open = matches.filter((p) => p.status !== "merged" && p.status !== "closed");
  const merged = matches.filter((p) => p.status === "merged" || p.status === "closed");
  const shown = (effectiveState === "open" ? open : merged).filter((p) => stateOp !== "merged" && stateOp !== "closed" ? true : p.status === stateOp);

  return (
    <div className="flex flex-col gap-3">
      <Toolbar query={query} onQuery={setQuery} placeholder="Search pull requests, or try is:merged check:failed">
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[effectiveState]}
          onValueChange={(v) => {
            if (!v[0]) return;
            setState(v[0]);
            if (stateOp) setQuery(removeOperator(parsed, "is"));
          }}
          aria-label="Pull request state"
        >
          <ToggleGroupItem value="open">
            <GitPullRequest aria-hidden /> <span className="tabular-nums">{open.length}</span> Open
          </ToggleGroupItem>
          <ToggleGroupItem value="merged">
            <span className="tabular-nums">{merged.length}</span> Merged
          </ToggleGroupItem>
        </ToggleGroup>
        <SavedFilters kind="pulls" current={{ state: effectiveState, label: "all", q: query }} onApply={(f) => { setState(f.state === "merged" ? "merged" : "open"); setQuery(f.q); }} />
        {newHref && (
          <Button size="sm" href={newHref}>
            <GitPullRequest data-icon="inline-start" />
            New pull request
          </Button>
        )}
      </Toolbar>
      <QueryChips parsed={parsed} onChange={setQuery} />

      {shown.length === 0 ? (
        <EmptyState
          icon={GitPullRequest}
          title={q ? "No pull requests match" : state === "open" ? "No open pull requests" : "Nothing merged yet"}
          description={q ? "Try another title, branch or number." : "Propose a change to a dataset from a branch."}
          action={
            q ? (
              <Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear search</Button>
            ) : newHref ? (
              <Button size="sm" href={newHref}>New pull request</Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col divide-y divide-border border border-border bg-card" aria-label="Pull requests">
          {shown.map((pr) => (
            <li key={`${pr.repo}#${pr.id}`} className="relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
              <StatusIcon status={pr.status === "merged" ? "merged" : pr.status === "closed" ? "closed" : "open"} className="mt-0.5" />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {showRepo && <span className="font-mono text-xs text-muted-foreground">{pr.repo}</span>}
                  <Link href={`/${pr.repo}/pull/${pr.id}`} data-list-item className="text-sm font-medium hover:underline after:absolute after:inset-0">
                    {pr.title}
                  </Link>
                  {pr.reviewRequested && <Badge variant="secondary">Review requested</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    #{pr.id} by {pr.author} · updated {pr.updated}
                  </span>
                  <code className="bg-muted px-1 py-0.5 font-mono">
                    {pr.source} → {pr.target}
                  </code>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                {pr.checks && <StatusIcon status={pr.checks} className="hidden sm:block" />}
                <StatusBadge status={prStatus(pr.status)} className="hidden md:inline-flex" />
                <span className={cn("flex w-8 items-center justify-end gap-1 tabular-nums", pr.comments === 0 && "invisible")}>
                  <MessageSquare className="size-3.5" aria-hidden />
                  {pr.comments}
                  <span className="sr-only">comments</span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
