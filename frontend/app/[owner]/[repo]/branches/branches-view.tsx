"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/components/button-status";
import { GitBranch, GitMerge, GitPullRequest, Plus, Search, Trash2 } from "lucide-react";
import { CopyButton } from "@/components/craton-actions";
import { EmptyState, Initials, StatusBadge } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Branch } from "@/lib/data";
import { createBranchAction, deleteBranchAction } from "@/app/actions";

export type BranchPull = { id: number; status: "open" | "merged" | "closed" | "approved" | "changes-requested" };

const VALID_BRANCH = /^[a-z0-9][a-z0-9._/-]*$/;

/** Ahead/behind split bar, like GitHub's, scaled to the largest divergence. */
function Divergence({ ahead, behind, max, base }: { ahead: number; behind: number; max: number; base: string }) {
  const w = (n: number) => `${Math.round((n / Math.max(max, 1)) * 100)}%`;
  return (
    <div className="flex w-36 flex-col gap-1" aria-label={`${behind} behind, ${ahead} ahead of ${base}`}>
      <div className="flex justify-between font-mono text-[11px] tabular-nums text-muted-foreground">
        <span>{behind} behind</span>
        <span>{ahead} ahead</span>
      </div>
      <div className="grid h-1 grid-cols-2 gap-px bg-border">
        <div className="flex justify-end bg-muted">
          <div className="h-full bg-muted-foreground/60" style={{ width: w(behind) }} />
        </div>
        <div className="bg-muted">
          <div className="h-full bg-chart-2" style={{ width: w(ahead) }} />
        </div>
      </div>
    </div>
  );
}

export function BranchesView({
  owner,
  repo,
  branches,
  pulls,
  live,
  defaultBranch,
}: {
  owner: string;
  repo: string;
  branches: Branch[];
  pulls: Record<string, BranchPull>;
  live: boolean;
  defaultBranch: string;
}) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [branchList, setBranchList] = useState<Branch[]>(branches);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [from, setFrom] = useState(defaultBranch);
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);

  // Fresh server data after a write (router.refresh) replaces the optimistic list.
  useEffect(() => setBranchList(branches), [branches]);

  const trimmed = name.trim();
  const error = !trimmed
    ? "Enter a branch name."
    : !VALID_BRANCH.test(trimmed)
      ? "Use lowercase letters, numbers, dots, dashes or slashes."
      : branchList.some((b) => b.name === trimmed)
        ? `A branch named “${trimmed}” already exists.`
        : null;

  async function createBranch(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (error || pending) return;
    if (live) {
      setPending(true);
      const result = await createBranchAction(owner, repo, trimmed, from);
      setPending(false);
      if (!result.ok) {
        notify.error("Couldn’t create the branch", { description: result.error });
        return;
      }
      router.refresh();
    } else {
      setBranchList((current) => [
        { name: trimmed, lastCommit: `Branched from ${from}`, author: "priyam", updated: "just now", ahead: 0, behind: 0 },
        ...current,
      ]);
    }
    notify.success(`Created ${trimmed}`, { description: `Switch to it with: craton switch ${trimmed}` });
    setOpen(false);
    setName("");
    setTouched(false);
  }

  async function restoreBranch(branch: Branch) {
    if (!live) {
      setBranchList((current) => [...current, branch]);
      return;
    }
    const result = await createBranchAction(owner, repo, branch.name, branch.sha ?? defaultBranch);
    if (!result.ok) {
      notify.error("Couldn’t restore the branch", { description: result.error });
      return;
    }
    router.refresh();
  }

  async function deleteBranch(branch: Branch) {
    setBranchList((current) => current.filter((b) => b.name !== branch.name));
    if (live) {
      const result = await deleteBranchAction(owner, repo, branch.name);
      if (!result.ok) {
        setBranchList((current) => [...current, branch]);
        notify.error("Couldn’t delete the branch", { description: result.error });
        return;
      }
      router.refresh();
    }
    notify.success(`Deleted ${branch.name}`, {
      description: "Its commits stay in history; Undo points the branch back at them.",
      duration: 10_000,
      action: { label: "Undo", onClick: () => void restoreBranch(branch) },
    });
  }

  const q = query.trim().toLowerCase();
  const defaultRow = branchList.find((b) => b.isDefault);
  const others = branchList.filter((b) => !b.isDefault && (!q || b.name.includes(q) || b.author.includes(q)));
  const max = Math.max(...branchList.map((b) => Math.max(b.ahead, b.behind)));
  const defaultName = defaultRow?.name ?? defaultBranch;

  return (
    <>
      <h1 className="sr-only">Branches · {owner}/{repo}</h1>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <InputGroup className="h-8 w-full sm:w-72 sm:flex-none">
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search branches"
              placeholder="Search branches by name or author…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <Plus data-icon="inline-start" />
                  New branch
                </Button>
              }
            />
            <DialogContent>
              <form onSubmit={createBranch} className="flex flex-col gap-4">
                <DialogHeader>
                  <DialogTitle>Create a branch</DialogTitle>
                  <DialogDescription>
                    Branches are free: they point at existing chunks until you change a file.
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup>
                  <Field data-invalid={touched && !!error ? true : undefined}>
                    <FieldLabel htmlFor="branch-name">Name</FieldLabel>
                    <Input
                      id="branch-name"
                      name="branch"
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="e.g. culvert-upgrade-2026…"
                      value={name}
                      aria-invalid={touched && !!error}
                      aria-describedby="branch-name-error"
                      onChange={(e) => setName(e.target.value)}
                      onBlur={() => setTouched(true)}
                      className="font-mono"
                      autoFocus
                    />
                    {touched && error ? (
                      <FieldError id="branch-name-error">{error}</FieldError>
                    ) : (
                      <FieldDescription id="branch-name-error">Lowercase, no spaces.</FieldDescription>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel>Branch from</FieldLabel>
                    <Select value={from} onValueChange={setFrom}>
                      <SelectTrigger className="w-full font-mono" aria-label="Branch from">
                        <GitBranch className="size-3.5" aria-hidden />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="w-full">
                        <SelectGroup>
                          {branchList.map((b) => (
                            <SelectItem key={b.name} value={b.name} className="font-mono">
                              {b.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                </FieldGroup>
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline">Cancel</Button>} />
                  <Button type="submit" loading={pending} disabled={pending}>
                    Create branch
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {defaultRow && (
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground">Default branch</h2>
            <ul className="border border-border bg-card">
              <BranchRow branch={defaultRow} base={base} max={max} pr={pulls[defaultRow.name]} defaultName={defaultName} />
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground tabular-nums">Active branches · {others.length}</h2>
          {others.length === 0 ? (
            <EmptyState
              icon={GitBranch}
              title={q ? "No branches match" : "No other branches"}
              description={q ? "Try another name or author." : `Create a branch to try a scenario without touching ${defaultName}.`}
              action={
                q ? (
                  <Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear search</Button>
                ) : (
                  <Button size="sm" onClick={() => setOpen(true)}>New branch</Button>
                )
              }
            />
          ) : (
            <ul className="flex flex-col divide-y divide-border border border-border bg-card">
              {others.map((b) => (
                <BranchRow
                  key={b.name}
                  branch={b}
                  base={base}
                  max={max}
                  pr={pulls[b.name]}
                  defaultName={defaultName}
                  onDelete={() => void deleteBranch(b)}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

function BranchRow({
  branch,
  base,
  max,
  pr,
  defaultName,
  onDelete,
}: {
  branch: Branch;
  base: string;
  max: number;
  pr?: BranchPull;
  defaultName: string;
  onDelete?: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-1.5">
            <Link
              href={branch.isDefault ? base : `${base}?ref=${encodeURIComponent(branch.name)}`}
              className="truncate font-mono text-sm font-medium hover:underline"
            >
              {branch.name}
            </Link>
            <CopyButton value={branch.name} label={`Copy branch name ${branch.name}`} />
            {branch.isDefault && <Badge variant="outline">default</Badge>}
          </div>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Initials name={branch.author} className="size-5" />
            <span className="truncate">
              {branch.lastCommit} · updated {branch.updated}
            </span>
          </p>
        </div>
      </div>
      {!branch.isDefault && <Divergence ahead={branch.ahead} behind={branch.behind} max={max} base={defaultName} />}
      <div className="flex w-full items-center justify-end gap-2 sm:w-auto">
        {pr && (
          <Link href={`${base}/pull/${pr.id}`} className="flex items-center gap-1.5 text-xs hover:underline">
            <GitPullRequest className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="font-mono text-muted-foreground">#{pr.id}</span>
            <StatusBadge status={pr.status} />
          </Link>
        )}
        {!branch.isDefault && (
          <>
            <Button variant="outline" size="sm" href={`${base}/compare?head=${encodeURIComponent(branch.name)}`}>
              <GitMerge data-icon="inline-start" />
              Compare
            </Button>
            {/* No "are you sure": deleting only moves a pointer, and the message offers Undo. */}
            <Button variant="ghost" size="icon-sm" aria-label={`Delete branch ${branch.name}`} onClick={() => onDelete?.()}>
              <Trash2 />
            </Button>
          </>
        )}
      </div>
    </li>
  );
}
