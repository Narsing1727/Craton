"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDot, FileWarning, GitPullRequest, Lock } from "lucide-react";
import { notify } from "@/components/button-status";
import { Initials, StatusBadge } from "@/components/craton-ui";
import { labelStyles } from "@/components/work-lists";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Editable, EditableArea, EditableInput, EditablePreview } from "@/components/ui/editable";
import type { Issue } from "@/lib/data";
import { commentAction, updateIssueAction } from "@/app/actions";
import { SignInPrompt } from "@/components/sign-in-prompt";

export type Entry =
  | { kind: "comment"; id: number; author: string; role: string; time: string; text: string }
  | { kind: "event"; id: number; author: string; time: string; text: string; closed: boolean };

export function IssueView({
  owner,
  repo,
  issue,
  thread,
  live,
  viewer,
  linkedPull,
  milestones = [],
  canWrite = false,
}: {
  owner: string;
  repo: string;
  issue: Issue;
  thread: Entry[];
  live: boolean;
  /** Signed-in handle, or null for a visitor (read-only). */
  viewer: string | null;
  linkedPull?: number;
  /** Titles of the repository's open milestones, for writers to choose from. */
  milestones?: string[];
  canWrite?: boolean;
}) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [isOpen, setIsOpen] = useState(issue.status === "open");
  const [entries, setEntries] = useState<Entry[]>(thread);
  const [pending, setPending] = useState(false);
  const [draft, setDraft] = useState("");
  const [title, setTitle] = useState(issue.title);
  const [milestone, setMilestone] = useState<string | null | undefined>(issue.milestone);
  const commentCount = entries.filter((e) => e.kind === "comment").length;

  async function chooseMilestone(next: string) {
    const value = next === "none" ? null : next;
    const before = milestone;
    setMilestone(value); // optimistic
    const result = await updateIssueAction(owner, repo, issue.id, { milestone: value });
    if (!result.ok) {
      setMilestone(before);
      notify.error("Couldn’t change the milestone", { description: result.error });
      return;
    }
    router.refresh();
  }

  async function renameTitle(next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === title) return;
    setTitle(trimmed); // optimistic
    if (live) {
      const result = await updateIssueAction(owner, repo, issue.id, { title: trimmed });
      if (!result.ok) {
        setTitle(title);
        notify.error("Couldn’t rename the issue", { description: result.error });
        return;
      }
    }
    router.refresh();
  }

  async function addComment() {
    const text = draft.trim();
    if (!text || pending) return false;
    if (live) {
      setPending(true);
      const result = await commentAction(owner, repo, "issue", issue.id, text);
      setPending(false);
      if (!result.ok) {
        notify.error("Couldn’t post the comment", { description: result.error });
        return false;
      }
    }
    setEntries((e) => [...e, { kind: "comment", id: Date.now(), author: viewer ?? "you", role: viewer === issue.author ? "Author" : "Member", time: "just now", text }]);
    setDraft("");
    return true;
  }

  const toggleStatus = (withComment: boolean) => setStatus(!isOpen, withComment);

  /** Open or close the issue; `nowOpen` is the state to end up in, so Undo can name the one it came from. */
  async function setStatus(nowOpen: boolean, withComment: boolean) {
    const commented = withComment && (await addComment());
    if (live) {
      setPending(true);
      const result = await updateIssueAction(owner, repo, issue.id, { state: nowOpen ? "open" : "closed" });
      setPending(false);
      if (!result.ok) {
        notify.error(nowOpen ? "Couldn’t reopen the issue" : "Couldn’t close the issue", { description: result.error });
        return;
      }
      router.refresh();
    }
    setIsOpen(nowOpen);
    setEntries((e) => [
      ...e,
      { kind: "event", id: Date.now() + 1, author: viewer ?? "you", time: "just now", text: nowOpen ? "reopened this issue" : "closed this issue as completed", closed: !nowOpen },
    ]);
    notify.success(nowOpen ? "Issue reopened" : commented ? "Commented and closed" : "Issue closed", {
      duration: 8000,
      action: { label: "Undo", onClick: () => void setStatus(!nowOpen, false) },
    });
  }

  return (
    <>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className="flex flex-wrap items-baseline gap-2 text-2xl font-semibold text-balance">
              <Editable
                defaultValue={title}
                onValueChange={setTitle}
                onSubmit={renameTitle}
                disabled={!viewer}
                triggerMode="dblclick"
                className="min-w-0"
              >
                <EditableArea>
                  <EditablePreview className="cursor-text rounded px-0.5 -mx-0.5 hover:bg-muted/60" title={viewer ? "Double-click to rename" : undefined} />
                  <EditableInput className="bg-transparent outline-none border-b border-foreground/30" />
                </EditableArea>
              </Editable>
              <span className="font-normal text-muted-foreground">#{issue.id}</span>
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StatusBadge status={isOpen ? "open" : "closed"} />
              <span>
                <span className="font-medium text-foreground">{issue.author}</span> opened this issue {issue.opened ?? issue.updated} ·{" "}
                <span className="tabular-nums">{commentCount}</span> comments
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {viewer && (
              <Button variant="outline" size="sm" disabled={pending} onClick={() => toggleStatus(false)}>
                {isOpen ? "Close issue" : "Reopen issue"}
              </Button>
            )}
            <Button size="sm" href={`${base}/issues/new`}>
              New issue
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0">
            <ol className="flex flex-col">
              {entries.map((entry) => (
                <li key={entry.id} className="relative flex gap-3 pb-5">
                  <span className="absolute left-3 top-7 bottom-0 w-px bg-border" aria-hidden />
                  {entry.kind === "comment" ? (
                    <>
                      <Initials name={entry.author} className="relative z-10" />
                      <div className="min-w-0 flex-1 border border-border bg-card">
                        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs">
                          <span className="font-medium text-foreground">{entry.author}</span>
                          <span className="text-muted-foreground">commented {entry.time}</span>
                          <Badge variant="outline" className="ml-auto text-[10px]">{entry.role}</Badge>
                        </div>
                        <p className="px-3 py-3 text-sm text-muted-foreground text-pretty whitespace-pre-line">{entry.text}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="relative z-10 flex size-6 shrink-0 items-center justify-center bg-background">
                        {entry.closed ? (
                          <CheckCircle2 className="size-4 text-chart-1" aria-hidden />
                        ) : (
                          <CircleDot className="size-4 text-chart-2" aria-hidden />
                        )}
                      </span>
                      <p className="pt-0.5 text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">{entry.author}</span> {entry.text}
                        <span className="text-xs"> · {entry.time}</span>
                      </p>
                    </>
                  )}
                </li>
              ))}
            </ol>

            {!viewer ? (
              <SignInPrompt action="join the conversation" />
            ) : (
            <form
              className="flex gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void addComment().then((ok) => ok && notify.success("Comment added"));
              }}
            >
              <Initials name={viewer} />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <label htmlFor="issue-comment" className="sr-only">
                  Add a comment
                </label>
                <Textarea
                  id="issue-comment"
                  rows={4}
                  placeholder="Add a comment… Paste gauge readings, CRS details or file paths"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void addComment().then((ok) => ok && notify.success("Comment added"));
                    }
                  }}
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Kbd>Ctrl</Kbd>
                    <Kbd>Enter</Kbd> to comment
                  </span>
                  <div className="flex items-center gap-2">
                    <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => toggleStatus(true)}>
                      {isOpen ? (draft.trim() ? "Close with comment" : "Close issue") : "Reopen issue"}
                    </Button>
                    <Button type="submit" size="sm" disabled={!draft.trim() || pending}>
                      Comment
                    </Button>
                  </div>
                </div>
              </div>
            </form>
            )}
          </div>

          <aside className="flex flex-col gap-4 text-sm">
            <dl className="flex flex-col divide-y divide-border border border-border bg-card">
              <Property label="Status">
                <StatusBadge status={isOpen ? "open" : "closed"} />
              </Property>
              <Property label="Assignee">
                {issue.assignee === null ? (
                  <span className="text-muted-foreground">No one</span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Initials name={issue.assignee ?? "?"} className="size-5" /> {issue.assignee}
                  </span>
                )}
              </Property>
              <Property label="Label">
                <Badge variant="outline" className={labelStyles[issue.label]}>
                  {issue.label}
                </Badge>
              </Property>
              <Property label="Milestone">
                {live && canWrite ? (
                  <Select value={milestone ?? "none"} onValueChange={(v) => v && void chooseMilestone(v)}>
                    <SelectTrigger size="sm" className="w-44" aria-label="Milestone">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="none">No milestone</SelectItem>
                        {[...new Set([...(milestone ? [milestone] : []), ...milestones])].map((m) => (
                          <SelectItem key={m} value={m}>
                            {m}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                ) : milestone ? (
                  <Link href={`${base}/issues?q=${encodeURIComponent(`milestone:"${milestone}"`)}&state=${isOpen ? "open" : "closed"}`} className="truncate hover:underline">
                    {milestone}
                  </Link>
                ) : (
                  <span className="text-muted-foreground">None</span>
                )}
              </Property>
              {issue.reference && (
                <Property label="File">
                  <Link href={`${base}/blob/${issue.reference}`} className="flex min-w-0 items-center gap-1.5 hover:underline">
                    <FileWarning className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="truncate font-mono text-xs">{issue.reference}</span>
                  </Link>
                </Property>
              )}
              {linkedPull && (
                <Property label="Linked">
                  <Link href={`${base}/pull/${linkedPull}`} className="flex items-center gap-1.5 hover:underline">
                    <GitPullRequest className="size-3.5 text-muted-foreground" aria-hidden />
                    <span className="font-mono text-xs">#{linkedPull}</span>
                  </Link>
                </Property>
              )}
            </dl>
            <Separator />
            <p className="flex items-start gap-2 text-xs text-muted-foreground text-pretty">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Only collaborators can comment once an issue is locked. Lock it from repository settings.
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}

function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3 py-2">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 justify-end">{children}</dd>
    </div>
  );
}
