"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleDot, FileDiff, GitCommit, GitMerge, GitPullRequest, GitPullRequestClosed, MessageSquare, XCircle } from "lucide-react";
import { notify } from "@/components/button-status";
import { ConfirmAction } from "@/components/craton-actions";
import { Initials, StatusBadge, StatusIcon } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MapPreview, MapDiffLegend } from "@/components/map-preview";
import { DataTypeBadge } from "@/components/data-type-badge";
import { ChunkMap } from "@/components/chunk-map";
import { AvatarStack } from "@/components/kibo-ui/avatar-stack";
import { ChangePreview } from "@/components/data-preview";
import type { FilePreview } from "@/lib/previews";
import type { Commit, PullRequest } from "@/lib/data";
import { closePullAction, commentAction, mergePullAction, requestReviewAction, reviewPullAction, withdrawReviewRequestAction } from "@/app/actions";
import { useCanWrite } from "@/components/repo-context";
import { Input } from "@/components/ui/input";
import { SignInPrompt } from "@/components/sign-in-prompt";

export type TimelineItem =
  | { kind: "event"; actor: string; text: string; time: string }
  | { kind: "comment"; actor: string; text: string; time: string; badge?: "Approved" | "Changes requested" }
  | { kind: "approve" | "changes"; actor: string; text: string; time: string };

export type CheckStep = { name: string; status: "passed" | "failed" | "skipped"; detail: string };

export type PullViewProps = {
  owner: string;
  repo: string;
  pr: PullRequest;
  live: boolean;
  /** Signed-in handle, or null for a visitor (read-only). */
  viewer: string | null;
  timeline: TimelineItem[];
  files: Commit["files"];
  /** How many files the pull request changes in all, when `files` holds only the first few (a large one can change thousands). */
  filesTotal?: number;
  /** Likewise for commits. */
  commitsTotal?: number;
  /** Rendered map previews per changed file (live data only). */
  previews?: Record<string, FilePreview>;
  commits: Commit[];
  conflicts: string[];
  checkSteps: CheckStep[] | null;
  rules: { requireChecks: boolean; requireReview: boolean; requireOwnerReview?: boolean };
  reviewers: { handle: string; state: "approved" | "changes_requested" | "commented" }[];
  /** People asked to review who haven't yet. */
  waiting?: string[];
  /** Owners of the changed files, from CODEOWNERS on the target branch. */
  owners?: { handle: string; files: string[]; requested: boolean; state: "approved" | "changes_requested" | "commented" | null; current: boolean }[];
  linkedIssue?: { id: number; title: string; open: boolean };
};

export function PullView({ owner, repo, pr, live, viewer, timeline: initial, files, filesTotal, commitsTotal, previews = {}, commits, conflicts, checkSteps, rules, reviewers, waiting: initialWaiting = [], owners = [], linkedIssue }: PullViewProps) {
  const canWrite = useCanWrite();
  const fileCount = filesTotal ?? files.length;
  const commitCount = commitsTotal ?? commits.length;
  const [waiting, setWaiting] = useState(initialWaiting);
  const [askName, setAskName] = useState("");
  const [asking, setAsking] = useState(false);
  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const who = askName.replace(/^@/, "").trim();
    if (!who || asking) return;
    setAsking(true);
    const r = await requestReviewAction(owner, repo, pr.id, who);
    setAsking(false);
    if (!r.ok) return void notify.error("Couldn’t ask for a review", { description: r.error });
    setWaiting(r.data.reviewRequests);
    setAskName("");
    notify.success(`Asked @${who} to review`, { description: "They were told by email and in their inbox." });
  }
  async function withdraw(handle: string) {
    const r = await withdrawReviewRequestAction(owner, repo, pr.id, handle);
    if (!r.ok) return void notify.error("Couldn’t withdraw the request", { description: r.error });
    setWaiting(r.data.reviewRequests);
  }
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [timeline, setTimeline] = useState<TimelineItem[]>(initial);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);

  const isOpen = pr.status !== "merged" && pr.status !== "closed";
  const isAuthor = viewer === pr.author;
  const approvals = pr.approvals ?? reviewers.filter((r) => r.state === "approved").length;
  const failedSteps = checkSteps?.filter((s) => s.status === "failed") ?? [];
  // With owner approval required, every owner of a changed file has to have approved the latest version.
  const ownersWaiting = rules.requireOwnerReview ? owners.filter((o) => !(o.state === "approved" && o.current)) : [];
  const checksOk = pr.checks === "passed";
  const blockers = [
    rules.requireChecks && !checksOk ? (pr.checks === "failed" ? `${failedSteps.map((s) => s.name.toLowerCase()).join(" and ") || "checks"} failing` : "checks haven’t run on the latest commit") : null,
    rules.requireReview && approvals < 1 ? "an approving review is required" : null,
    ownersWaiting.length ? `code owners still need to approve (${ownersWaiting.map((o) => "@" + o.handle).join(", ")})` : null,
    conflicts.length ? `${conflicts.length} ${conflicts.length === 1 ? "file conflicts" : "files conflict"} with ${pr.target}` : null,
  ].filter(Boolean) as string[];
  const mergeable = isOpen && blockers.length === 0;
  const comments = timeline.filter((t) => t.kind === "comment").length;

  async function run<T extends { ok: boolean; error?: string }>(label: string, action: () => Promise<T>) {
    setPending(label);
    const result = await action();
    setPending(null);
    if (!result.ok) notify.error(`Couldn’t ${label}`, { description: result.error });
    return result.ok;
  }

  async function comment() {
    const text = draft.trim();
    if (!text || pending) return;
    if (live && !(await run("post the comment", () => commentAction(owner, repo, "pull", pr.id, text)))) return;
    setTimeline((t) => [...t, { kind: "comment", actor: viewer ?? "you", text, time: "just now" }]);
    setDraft("");
    notify.success("Comment added");
  }

  async function review(state: "approved" | "changes_requested") {
    const text = draft.trim();
    if (pending) return;
    if (state === "changes_requested" && !text) {
      notify.error("Say what needs to change", { description: "Write it in the comment box, then request changes." });
      return;
    }
    if (live && !(await run("submit the review", () => reviewPullAction(owner, repo, pr.id, state, text)))) return;
    const badge = state === "approved" ? "Approved" : "Changes requested";
    setTimeline((t) => [
      ...t,
      text ? { kind: "comment", actor: viewer ?? "you", text, time: "just now", badge } : { kind: "approve", actor: viewer ?? "you", text: "approved these changes", time: "just now" },
    ]);
    setDraft("");
    notify.success(state === "approved" ? "Approved" : "Changes requested");
    if (live) router.refresh();
  }

  async function merge() {
    if (!live) {
      notify.success(`Merged #${pr.id} into ${pr.target}`);
      return;
    }
    if (!(await run("merge", () => mergePullAction(owner, repo, pr.id)))) return;
    notify.success(`Merged #${pr.id} into ${pr.target}`, { description: "Checks re-ran on the merge result." });
    router.refresh();
  }

  async function close() {
    if (live && !(await run("close the pull request", () => closePullAction(owner, repo, pr.id)))) return;
    notify.success(`Closed #${pr.id}`);
    if (live) router.refresh();
  }

  return (
    <>
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-col gap-2 border-b border-border pb-5">
          <h1 className="text-2xl font-semibold text-balance">
            {pr.title} <span className="font-normal text-muted-foreground">#{pr.id}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <StatusBadge status={pr.status === "merged" ? "merged" : pr.status === "closed" ? "closed" : pr.status === "changes-requested" ? "changes-requested" : pr.status === "approved" ? "approved" : "open"} />
            <span>
              <span className="font-medium text-foreground">{pr.author}</span> {pr.status === "merged" ? "merged" : "wants to merge"}{" "}
              <code className="bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{pr.source}</code> into{" "}
              <code className="bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{pr.target}</code>
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <MessageSquare className="size-3.5" aria-hidden />
              {comments} {comments === 1 ? "comment" : "comments"}
            </span>
            <span className="flex items-center gap-1 tabular-nums">
              <FileDiff className="size-3.5" aria-hidden />
              {fileCount.toLocaleString("en-US")} {fileCount === 1 ? "file" : "files"}
            </span>
            {reviewers.length > 0 && (
              <AvatarStack size={22} className="ml-1">
                {reviewers.map((r) => (
                  <Initials key={r.handle} name={r.handle} className="size-full border-background text-[8px]" />
                ))}
              </AvatarStack>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[1fr_300px]">
          <div className="min-w-0">
            <Tabs defaultValue="conversation">
              <TabsList className="max-w-full overflow-x-auto no-scrollbar">
                <TabsTrigger value="conversation">
                  <MessageSquare data-icon="inline-start" />
                  Conversation
                </TabsTrigger>
                <TabsTrigger value="diff">
                  <GitMerge data-icon="inline-start" />
                  {live ? "Changes" : "Map diff"}
                </TabsTrigger>
                <TabsTrigger value="files">
                  <FileDiff data-icon="inline-start" />
                  Files <span className="tabular-nums text-muted-foreground">{fileCount.toLocaleString("en-US")}</span>
                </TabsTrigger>
                {live && (
                  <TabsTrigger value="commits">
                    <GitCommit data-icon="inline-start" />
                    Commits <span className="tabular-nums text-muted-foreground">{commitCount.toLocaleString("en-US")}</span>
                  </TabsTrigger>
                )}
              </TabsList>

              <TabsContent value="conversation" className="pt-4">
                <ol className="flex flex-col">
                  {timeline.map((item, i) => (
                    <li key={i} className="relative flex gap-3 pb-5">
                      <span className="absolute left-3 top-7 -bottom-0 w-px bg-border" aria-hidden />
                      {item.kind === "comment" ? (
                        <>
                          <Initials name={item.actor} className="relative z-10" />
                          <div className="min-w-0 flex-1 border border-border bg-card">
                            <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2 text-xs">
                              <span className="font-medium text-foreground">{item.actor}</span>
                              <span className="text-muted-foreground">
                                {item.badge ? (item.badge === "Approved" ? "approved" : "requested changes") : "commented"} {item.time}
                              </span>
                              <span className="ml-auto flex items-center gap-1.5">
                                {item.badge && <StatusBadge status={item.badge === "Approved" ? "approved" : "changes-requested"} />}
                                {item.actor === pr.author && (
                                  <Badge variant="outline" className="text-[10px]">Author</Badge>
                                )}
                              </span>
                            </div>
                            <p className="px-3 py-3 text-sm text-muted-foreground text-pretty whitespace-pre-line">{item.text}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <span className="relative z-10 flex size-6 shrink-0 items-center justify-center bg-background">
                            {item.kind === "approve" ? (
                              <CheckCircle2 className="size-4 text-chart-1" aria-hidden />
                            ) : item.kind === "changes" ? (
                              <XCircle className="size-4 text-destructive" aria-hidden />
                            ) : (
                              <GitPullRequest className="size-4 text-muted-foreground" aria-hidden />
                            )}
                          </span>
                          <p className="pt-0.5 text-sm text-muted-foreground">
                            <span className="font-medium text-foreground">{item.actor}</span> {item.text}
                            <span className="text-xs"> · {item.time}</span>
                          </p>
                        </>
                      )}
                    </li>
                  ))}
                </ol>

                {!viewer ? (
                  <SignInPrompt action="review and comment" />
                ) : (
                <form
                  className="flex gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void comment();
                  }}
                >
                  <Initials name={viewer} />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <label htmlFor="pr-comment" className="sr-only">
                      Add a comment
                    </label>
                    <Textarea
                      id="pr-comment"
                      placeholder="Leave a comment… Reference files like terrain/basin_dem.tif"
                      rows={3}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          void comment();
                        }
                      }}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Kbd>Ctrl</Kbd>
                        <Kbd>Enter</Kbd> to comment
                      </span>
                      <div className="flex flex-wrap items-center gap-2">
                        {isOpen && !isAuthor && (
                          <>
                            <Button type="button" variant="outline" size="sm" disabled={!!pending} onClick={() => void review("changes_requested")}>
                              Request changes
                            </Button>
                            <Button type="button" variant="outline" size="sm" disabled={!!pending} onClick={() => void review("approved")}>
                              <CheckCircle2 data-icon="inline-start" />
                              Approve
                            </Button>
                          </>
                        )}
                        <Button type="submit" size="sm" disabled={!draft.trim() || !!pending}>
                          Comment
                        </Button>
                      </div>
                    </div>
                  </div>
                </form>
                )}
              </TabsContent>

              <TabsContent value="diff" className="flex flex-col gap-4 pt-4">
                {live ? (
                  files.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{pr.source} has no changes that {pr.target} doesn’t already have.</p>
                  ) : (
                    files.map((f) => (
                      <Card key={f.name} className="overflow-hidden py-0">
                        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
                          <span className="font-mono text-sm">{f.name}</span>
                          {f.dataType && <DataTypeBadge type={f.dataType} />}
                          <span className="text-xs capitalize text-muted-foreground">{f.change}</span>
                          <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                            <span className="text-chart-1">+{f.added}</span> ={f.reused ?? 0} <span className="text-destructive">-{f.removed}</span> chunks
                          </span>
                        </div>
                        <CardContent className="flex flex-col gap-3 p-4">
                          {previews[f.name] && <ChangePreview preview={previews[f.name]} />}
                          <ChunkMap map={f.map ?? ""} before={f.sizeBefore ?? 0} after={f.sizeAfter ?? 0} change={f.change} />
                        </CardContent>
                      </Card>
                    ))
                  )
                ) : (
                  <>
                    <MapDiffLegend />
                    <Card className="overflow-hidden py-0">
                      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3">
                        <span className="font-mono text-sm">terrain/basin_dem.tif</span>
                        <DataTypeBadge type="DEM" />
                        <Badge variant="outline" className="ml-auto tabular-nums">320 tiles changed</Badge>
                      </div>
                      <CardContent className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
                        <figure className="flex flex-col gap-1.5">
                          <MapPreview seed={9} className="aspect-video" />
                          <figcaption className="text-xs text-muted-foreground">Before · {pr.target}</figcaption>
                        </figure>
                        <figure className="flex flex-col gap-1.5">
                          <MapPreview seed={9} className="aspect-video" diff={{ "3-4": "changed", "3-5": "changed", "4-4": "added", "4-5": "added", "6-9": "changed" }} />
                          <figcaption className="text-xs text-muted-foreground">After · {pr.source}</figcaption>
                        </figure>
                      </CardContent>
                    </Card>
                  </>
                )}
              </TabsContent>

              <TabsContent value="files" className="pt-4">
                <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                  {files.map((f) => (
                    <li key={f.name}>
                      <Link
                        href={f.change === "removed" ? `${base}/blob/${f.name}?ref=${encodeURIComponent(pr.target)}` : `${base}/blob/${f.name}?ref=${encodeURIComponent(pr.source)}`}
                        className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-muted/30"
                      >
                        <FileDiff className="size-4 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.name}</span>
                        {conflicts.includes(f.name) && <StatusBadge status="failed" label="Conflict" />}
                        {f.dataType && <DataTypeBadge type={f.dataType} />}
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {f.unit === "chunks" ? `${f.change} · +${f.added} chunks` : `${f.added + f.changed} ${f.unit} changed`}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {fileCount > files.length && (
                  <p className="mt-3 text-sm text-muted-foreground">
                    Showing the first {files.length.toLocaleString("en-US")} of {fileCount.toLocaleString("en-US")} changed files.{" "}
                    <Link href={`${base}/compare?base=${encodeURIComponent(pr.target)}&head=${encodeURIComponent(pr.source)}&files=${Math.min(fileCount, 500)}`} className="text-foreground underline underline-offset-2 hover:no-underline">
                      See more on the compare page
                    </Link>
                  </p>
                )}
              </TabsContent>

              {live && (
                <TabsContent value="commits" className="pt-4">
                  <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                    {commits.map((c) => (
                      <li key={c.sha} className="flex items-center gap-3 px-4 py-3 text-sm">
                        <Initials name={c.authorHandle} />
                        <Link href={`${base}/commit/${c.sha}`} className="min-w-0 flex-1 truncate hover:underline">
                          {c.message}
                        </Link>
                        <span className="hidden text-xs text-muted-foreground sm:inline">{c.timestamp}</span>
                        <Link href={`${base}/commit/${c.sha}`} className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
                          {c.sha.slice(0, 7)}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </TabsContent>
              )}
            </Tabs>
          </div>

          <aside className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{isOpen ? "Merge checks" : pr.status === "merged" ? "Merged" : "Closed"}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                {isOpen ? (
                  <>
                    <CheckRow
                      status={approvals > 0 ? "passed" : rules.requireReview ? "failed" : "skipped"}
                      label={approvals > 0 ? `${approvals} approving ${approvals === 1 ? "review" : "reviews"}` : rules.requireReview ? "Approving review required" : "No review required"}
                    />
                    {rules.requireOwnerReview && (
                      <CheckRow
                        status={ownersWaiting.length ? "failed" : "passed"}
                        label={ownersWaiting.length ? `Waiting on code owners: ${ownersWaiting.map((o) => "@" + o.handle).join(", ")}` : owners.length ? "Code owners approved" : "No code owners for these files"}
                      />
                    )}
                    <CheckRow status={conflicts.length ? "failed" : "passed"} label={conflicts.length ? `${conflicts.length} conflicting ${conflicts.length === 1 ? "file" : "files"}` : "No merge conflicts"} />
                    {checkSteps === null ? (
                      <CheckRow status={rules.requireChecks ? "failed" : "skipped"} label="Checks haven’t run on the latest commit" href={`${base}/checks`} />
                    ) : failedSteps.length === 0 ? (
                      <CheckRow status="passed" label={`All ${checkSteps.length} checks passed`} href={`${base}/checks`} />
                    ) : (
                      failedSteps.map((s) => <CheckRow key={s.name} status={rules.requireChecks ? "failed" : "skipped"} label={s.name} href={`${base}/checks`} note={s.detail} />)
                    )}
                    <Separator />
                    <ConfirmAction
                      trigger={
                        <Button className="w-full" disabled={!viewer || !mergeable || !!pending} aria-describedby="merge-state">
                          <GitMerge data-icon="inline-start" />
                          {pending === "merge" ? "Merging…" : "Merge pull request"}
                        </Button>
                      }
                      title={`Merge #${pr.id} into ${pr.target}?`}
                      description={`${fileCount} ${fileCount === 1 ? "file" : "files"} from ${pr.source} land on ${pr.target}. History is append-only, so this can be undone later with a revert commit.`}
                      confirmLabel="Merge"
                      onConfirm={() => void merge()}
                    />
                    <p id="merge-state" className="text-xs text-muted-foreground text-pretty">
                      {mergeable ? `Ready to merge into ${pr.target}.` : `Merging is blocked: ${blockers.join("; ")}.`}{" "}
                      {!mergeable && (
                        <Link href={`${base}/checks`} className="text-foreground underline underline-offset-2">
                          See checks
                        </Link>
                      )}
                    </p>
                    {viewer && (isAuthor || live) && (
                      <Button variant="ghost" size="sm" className="self-start" disabled={!!pending} onClick={() => void close()}>
                        <GitPullRequestClosed data-icon="inline-start" />
                        Close without merging
                      </Button>
                    )}
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground text-pretty">
                    {pr.status === "merged" ? `${pr.source} was merged into ${pr.target}.` : "This pull request was closed without merging."}{" "}
                    <Link href={`${base}/commits`} className="text-foreground underline underline-offset-2">
                      View history
                    </Link>
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Reviewers</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5 text-sm">
                {reviewers.length === 0 && waiting.length === 0 && <p className="text-xs text-muted-foreground">No reviews yet.</p>}
                {reviewers.map((r) => (
                  <Reviewer key={r.handle} handle={r.handle} status={r.state} />
                ))}
                {waiting.filter((h) => !reviewers.some((r) => r.handle === h)).map((h) => (
                  <div key={h} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate">{h}</span>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      Waiting
                      {canWrite && (
                        <Button variant="ghost" size="xs" onClick={() => void withdraw(h)} aria-label={`Withdraw the request to ${h}`}>
                          Withdraw
                        </Button>
                      )}
                    </span>
                  </div>
                ))}
                {canWrite && pr.status !== "merged" && pr.status !== "closed" && (
                  <form onSubmit={ask} className="flex gap-1.5 border-t border-border pt-2.5">
                    <Input value={askName} onChange={(e) => setAskName(e.target.value)} placeholder="Ask someone to review" aria-label="Ask someone to review" className="h-8 text-xs" spellCheck={false} autoComplete="off" />
                    <Button type="submit" size="sm" loading={asking} disabled={asking || !askName.trim()}>Ask</Button>
                  </form>
                )}
              </CardContent>
            </Card>
            {owners.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Code owners</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2.5 text-sm">
                  {owners.map((o) => (
                    <div key={o.handle} className="flex flex-col gap-0.5">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/${o.handle}`} className="truncate hover:underline">@{o.handle}</Link>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {o.state === "approved" && !o.current ? "Approved an earlier version" : o.state === "approved" ? "Approved" : o.state === "changes_requested" ? "Asked for changes" : o.state === "commented" ? "Commented" : o.requested ? "Waiting" : "Not asked"}
                        </span>
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground" title={o.files.join(", ")}>
                        {o.files.length === 1 ? o.files[0] : `${o.files[0]} and ${o.files.length - 1} more`}
                      </p>
                    </div>
                  ))}
                  <p className="border-t border-border pt-2 text-xs text-muted-foreground text-pretty">
                    From <span className="font-mono">CODEOWNERS</span> on {pr.target}. They are asked when the pull request is opened.
                  </p>
                </CardContent>
              </Card>
            )}
            {linkedIssue && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Linked issue</CardTitle>
                </CardHeader>
                <CardContent>
                  <Link href={`${base}/issues/${linkedIssue.id}`} className="flex items-start gap-2 text-sm hover:underline">
                    <CircleDot className={linkedIssue.open ? "mt-0.5 size-4 shrink-0 text-chart-2" : "mt-0.5 size-4 shrink-0 text-muted-foreground"} aria-hidden />
                    <span>
                      {linkedIssue.title} <span className="text-muted-foreground">#{linkedIssue.id}</span>
                    </span>
                  </Link>
                </CardContent>
              </Card>
            )}
          </aside>
        </div>
      </div>
    </>
  );
}

function CheckRow({ status, label, note, href }: { status: "passed" | "failed" | "skipped"; label: string; note?: string; href?: string }) {
  const content = (
    <>
      <StatusIcon status={status} className="mt-0.5" />
      <span className="flex min-w-0 flex-1 flex-col">
        {label}
        {note && <span className="text-xs text-muted-foreground text-pretty">{note}</span>}
      </span>
    </>
  );
  return href ? (
    <Link href={href} className="flex items-start gap-2 hover:underline">
      {content}
    </Link>
  ) : (
    <div className="flex items-start gap-2">{content}</div>
  );
}

function Reviewer({ handle, status }: { handle: string; status: "approved" | "changes_requested" | "commented" }) {
  return (
    <div className="flex items-center gap-2">
      <Initials name={handle} />
      <span>{handle}</span>
      {status === "approved" ? (
        <StatusBadge status="approved" className="ml-auto" />
      ) : status === "changes_requested" ? (
        <StatusBadge status="changes-requested" className="ml-auto" />
      ) : (
        <Badge variant="outline" className="ml-auto gap-1">
          <MessageSquare className="size-3" aria-hidden />
          Commented
        </Badge>
      )}
    </div>
  );
}
