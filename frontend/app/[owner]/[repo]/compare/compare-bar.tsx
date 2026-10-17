"use client";

// Base / compare branch pickers. Changing either navigates, so the server renders the comparison.

import { useSoftNav } from "@/lib/use-soft-nav";
import { ArrowLeftRight, GitBranch, GitPullRequest } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

export function CompareBar({
  repoBase,
  branches,
  base,
  head,
  ahead,
  behind,
  added,
  removed,
}: {
  repoBase: string;
  branches: string[];
  base: string;
  head: string;
  ahead?: number;
  behind?: number;
  added?: number;
  removed?: number;
}) {
  const nav = useSoftNav();
  const go = (b: string, h: string) => nav.go(`${repoBase}/compare?base=${encodeURIComponent(b)}&head=${encodeURIComponent(h)}`);
  const same = base === head;

  return (
    <div className="flex flex-wrap items-center gap-3 border border-border bg-card p-3">
      <span className="text-xs text-muted-foreground">base</span>
      <BranchSelect value={base} branches={branches} onChange={(v) => go(v, head)} label="Base branch" />
      <Button variant="ghost" size="icon-sm" aria-label="Swap branches" title="Swap branches" onClick={() => go(head, base)}>
        <ArrowLeftRight />
      </Button>
      <span className="text-xs text-muted-foreground">compare</span>
      <BranchSelect value={head} branches={branches} onChange={(v) => go(base, v)} label="Compare branch" />
      {!same && ahead !== undefined && (
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {ahead} {ahead === 1 ? "commit" : "commits"} ahead · {behind ?? 0} behind
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        {!same && added !== undefined && (
          <Badge variant="outline" className="gap-2 font-mono tabular-nums" title="New and dropped chunks">
            <span className="text-chart-1">+{added}</span>
            <span className="text-destructive">-{removed ?? 0}</span>
          </Badge>
        )}
        <Button size="sm" href={`${repoBase}/pulls/new?base=${encodeURIComponent(base)}&head=${encodeURIComponent(head)}`} disabled={same || ahead === 0}>
          <GitPullRequest data-icon="inline-start" />
          Create pull request
        </Button>
      </div>
    </div>
  );
}
