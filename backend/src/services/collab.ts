// Issues, pull requests, comments, reviews and merging.

import type { Ctx } from "./context.ts";
import { repoAccess } from "./accounts.ts";
import { badRequest, conflict, forbidden, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import * as milestones from "./milestones.ts";
import type { CommitObject, TreeObject } from "../core/objects.ts";
import { makeCommit, objectId } from "../core/objects.ts";
import { getObject, isAncestor, mergeBase, registerObjects, resolveRef, threeWayMerge, updateBranch } from "./history.ts";
import { latestCheckStatus, runChecks } from "../checks/runner.ts";

export const LABELS = ["data-quality", "question", "enhancement", "bug"] as const;
type Label = (typeof LABELS)[number];

const nextNumber = (ctx: Ctx, repo: RepoRow) => {
  const row = ctx.db
    .prepare("SELECT MAX(n) AS n FROM (SELECT MAX(number) AS n FROM issues WHERE repo_id = ? UNION ALL SELECT MAX(number) FROM pulls WHERE repo_id = ?)")
    .get(repo.id, repo.id) as { n: number | null };
  return (row.n ?? 0) + 1;
};

const handleOf = (ctx: Ctx, id: number | null) =>
  id === null ? null : ((ctx.db.prepare("SELECT handle FROM owners WHERE id = ?").get(id) as { handle: string } | undefined)?.handle ?? null);

const userIdOf = (ctx: Ctx, handle: string) => {
  const row = ctx.db.prepare("SELECT id FROM owners WHERE handle = ? AND kind = 'user'").get(handle) as { id: number } | undefined;
  if (!row) throw badRequest(`@${handle} isn’t a user.`);
  return row.id;
};

// ── Issues ──────────────────────────────────────────────────────────────────

type IssueRow = { number: number; title: string; body: string; author_id: number; state: "open" | "closed"; label: Label; assignee_id: number | null; milestone: string | null; file_ref: string | null; created_at: string; updated_at: string };

function issueJson(ctx: Ctx, repo: RepoRow, r: IssueRow) {
  const comments = (ctx.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE repo_id = ? AND target = 'issue' AND number = ?").get(repo.id, r.number) as { n: number }).n;
  return {
    number: r.number,
    title: r.title,
    body: r.body,
    author: handleOf(ctx, r.author_id),
    state: r.state,
    label: r.label,
    assignee: handleOf(ctx, r.assignee_id),
    milestone: r.milestone,
    file: r.file_ref,
    comments,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createIssue(ctx: Ctx, repo: RepoRow, authorId: number, input: { title: string; body?: string; label?: string; assignee?: string | null; milestone?: string | null; file?: string | null }) {
  if (!input.title?.trim()) throw badRequest("Give the issue a title.");
  const label = (input.label ?? "question") as Label;
  if (!LABELS.includes(label)) throw badRequest(`Label must be one of ${LABELS.join(", ")}.`);
  const number = nextNumber(ctx, repo);
  ctx.db
    .prepare("INSERT INTO issues (repo_id, number, title, body, author_id, label, assignee_id, milestone, file_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(repo.id, number, input.title.trim(), input.body ?? "", authorId, label, input.assignee ? userIdOf(ctx, input.assignee) : null, milestones.resolveForIssue(ctx, repo, input.milestone), input.file ?? null);
  return getIssue(ctx, repo, number);
}

export function listIssues(ctx: Ctx, repo: RepoRow, filter: { state?: string; label?: string } = {}) {
  const rows = ctx.db.prepare("SELECT * FROM issues WHERE repo_id = ? ORDER BY number DESC").all(repo.id) as IssueRow[];
  return rows.filter((r) => (!filter.state || r.state === filter.state) && (!filter.label || r.label === filter.label)).map((r) => issueJson(ctx, repo, r));
}

export function getIssue(ctx: Ctx, repo: RepoRow, number: number) {
  const row = ctx.db.prepare("SELECT * FROM issues WHERE repo_id = ? AND number = ?").get(repo.id, number) as IssueRow | undefined;
  if (!row) throw notFound(`Issue #${number}`);
  return issueJson(ctx, repo, row);
}

export function updateIssue(ctx: Ctx, repo: RepoRow, number: number, patch: { state?: "open" | "closed"; title?: string; label?: string; assignee?: string | null; milestone?: string | null }) {
  getIssue(ctx, repo, number);
  if (patch.state && !["open", "closed"].includes(patch.state)) throw badRequest("State must be open or closed.");
  if (patch.label && !LABELS.includes(patch.label as Label)) throw badRequest(`Label must be one of ${LABELS.join(", ")}.`);
  if (patch.state) ctx.db.prepare("UPDATE issues SET state = ? WHERE repo_id = ? AND number = ?").run(patch.state, repo.id, number);
  if (patch.title?.trim()) ctx.db.prepare("UPDATE issues SET title = ? WHERE repo_id = ? AND number = ?").run(patch.title.trim(), repo.id, number);
  if (patch.label) ctx.db.prepare("UPDATE issues SET label = ? WHERE repo_id = ? AND number = ?").run(patch.label, repo.id, number);
  if (patch.assignee !== undefined) ctx.db.prepare("UPDATE issues SET assignee_id = ? WHERE repo_id = ? AND number = ?").run(patch.assignee ? userIdOf(ctx, patch.assignee) : null, repo.id, number);
  if (patch.milestone !== undefined) ctx.db.prepare("UPDATE issues SET milestone = ? WHERE repo_id = ? AND number = ?").run(milestones.resolveForIssue(ctx, repo, patch.milestone), repo.id, number);
  ctx.db.prepare("UPDATE issues SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE repo_id = ? AND number = ?").run(repo.id, number);
  return getIssue(ctx, repo, number);
}

// ── Comments ────────────────────────────────────────────────────────────────

/** The reactions a comment can carry (named, as the web app draws them). */
export const REACTIONS = ["thumbs_up", "thumbs_down", "laugh", "hooray", "confused", "heart", "rocket", "eyes"] as const;
export type Reaction = (typeof REACTIONS)[number];
export type ReactionCounts = Partial<Record<Reaction, { count: number; mine: boolean; by: string[] }>>;

type CommentRow = { id: number; author_id: number; body: string; created_at: string; edited_at: string | null };

function reactionsOf(ctx: Ctx, ids: number[], viewerId: number | null): Map<number, ReactionCounts> {
  const out = new Map<number, ReactionCounts>();
  if (!ids.length) return out;
  const rows = ctx.db
    .prepare(`SELECT r.comment_id, r.emoji, r.user_id, o.handle FROM comment_reactions r JOIN owners o ON o.id = r.user_id WHERE r.comment_id IN (${ids.map(() => "?").join(",")}) ORDER BY r.created_at, o.handle`)
    .all(...ids) as { comment_id: number; emoji: Reaction; user_id: number; handle: string }[];
  for (const r of rows) {
    const mine = out.get(r.comment_id) ?? {};
    const entry = (mine[r.emoji] ??= { count: 0, mine: false, by: [] });
    entry.count += 1;
    if (r.user_id === viewerId) entry.mine = true;
    if (entry.by.length < 10) entry.by.push(r.handle);
    out.set(r.comment_id, mine);
  }
  return out;
}

const commentJson = (ctx: Ctx, r: CommentRow, reactions: ReactionCounts | undefined) => ({ id: r.id, author: handleOf(ctx, r.author_id), body: r.body, createdAt: r.created_at, editedAt: r.edited_at, reactions: reactions ?? {} });

export function addComment(ctx: Ctx, repo: RepoRow, target: "issue" | "pull", number: number, authorId: number, body: string) {
  if (!body?.trim()) throw badRequest("Comments can’t be empty.");
  if (body.length > 65_536) throw badRequest("Comments are at most 64 KB.");
  const table = target === "issue" ? "issues" : "pulls";
  if (!ctx.db.prepare(`SELECT 1 FROM ${table} WHERE repo_id = ? AND number = ?`).get(repo.id, number)) throw notFound(`${target === "issue" ? "Issue" : "Pull request"} #${number}`);
  ctx.db.prepare("INSERT INTO comments (repo_id, target, number, author_id, body) VALUES (?, ?, ?, ?, ?)").run(repo.id, target, number, authorId, body.trim());
  ctx.db.prepare(`UPDATE ${table} SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE repo_id = ? AND number = ?`).run(repo.id, number);
  return listComments(ctx, repo, target, number, authorId).at(-1);
}

export function listComments(ctx: Ctx, repo: RepoRow, target: "issue" | "pull", number: number, viewerId: number | null = null) {
  const rows = ctx.db.prepare("SELECT id, author_id, body, created_at, edited_at FROM comments WHERE repo_id = ? AND target = ? AND number = ? ORDER BY id").all(repo.id, target, number) as CommentRow[];
  const reactions = reactionsOf(ctx, rows.map((r) => r.id), viewerId);
  return rows.map((r) => commentJson(ctx, r, reactions.get(r.id)));
}

function commentOf(ctx: Ctx, repo: RepoRow, id: number): CommentRow & { target: "issue" | "pull"; number: number } {
  const row = ctx.db.prepare("SELECT id, author_id, body, created_at, edited_at, target, number FROM comments WHERE id = ? AND repo_id = ?").get(id, repo.id) as (CommentRow & { target: "issue" | "pull"; number: number }) | undefined;
  if (!row) throw notFound("Comment");
  return row;
}

export function getComment(ctx: Ctx, repo: RepoRow, id: number, viewerId: number | null) {
  const row = commentOf(ctx, repo, id);
  return commentJson(ctx, row, reactionsOf(ctx, [id], viewerId).get(id));
}

/** Only the person who wrote a comment can change its words. */
export function editComment(ctx: Ctx, repo: RepoRow, id: number, userId: number, body: string) {
  const row = commentOf(ctx, repo, id);
  if (row.author_id !== userId) throw forbidden("You can only edit your own comments.");
  if (!body?.trim()) throw badRequest("Comments can’t be empty.");
  if (body.length > 65_536) throw badRequest("Comments are at most 64 KB.");
  if (body.trim() !== row.body) ctx.db.prepare("UPDATE comments SET body = ?, edited_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(body.trim(), id);
  return getComment(ctx, repo, id, userId);
}

/** The author can take a comment back; so can anyone who administers the repository (`isAdmin`), for moderation. */
export function deleteComment(ctx: Ctx, repo: RepoRow, id: number, userId: number, isAdmin: boolean) {
  const row = commentOf(ctx, repo, id);
  if (row.author_id !== userId && !isAdmin) throw forbidden("You can only delete your own comments, unless you administer the repository.");
  ctx.db.prepare("DELETE FROM comments WHERE id = ?").run(id);
}

/** Add or take away one person's reaction; asking twice changes nothing. */
export function setReaction(ctx: Ctx, repo: RepoRow, id: number, userId: number, emoji: string, on: boolean) {
  if (!(REACTIONS as readonly string[]).includes(emoji)) throw badRequest(`Unknown reaction “${emoji.slice(0, 20)}”. Choose from ${REACTIONS.join(", ")}.`);
  commentOf(ctx, repo, id);
  if (on) ctx.db.prepare("INSERT OR IGNORE INTO comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?)").run(id, userId, emoji);
  else ctx.db.prepare("DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?").run(id, userId, emoji);
  return getComment(ctx, repo, id, userId);
}

// ── Pull requests ───────────────────────────────────────────────────────────

type PullRow = { number: number; title: string; body: string; author_id: number; source: string; target: string; state: "open" | "merged" | "closed"; merged_commit: string | null; created_at: string; updated_at: string };

function reviewsOf(ctx: Ctx, repo: RepoRow, number: number) {
  const rows = ctx.db.prepare("SELECT author_id, state, body, commit_id, created_at FROM reviews WHERE repo_id = ? AND number = ? ORDER BY id").all(repo.id, number) as { author_id: number; state: string; body: string; commit_id: string; created_at: string }[];
  return rows.map((r) => ({ author: handleOf(ctx, r.author_id), state: r.state, body: r.body, commit: r.commit_id, createdAt: r.created_at }));
}

function pullJson(ctx: Ctx, repo: RepoRow, r: PullRow) {
  let head: string | null = null;
  try {
    head = resolveRef(ctx, repo, r.source);
  } catch {}
  const reviews = reviewsOf(ctx, repo, r.number);
  const comments = (ctx.db.prepare("SELECT COUNT(*) AS n FROM comments WHERE repo_id = ? AND target = 'pull' AND number = ?").get(repo.id, r.number) as { n: number }).n;
  // A reviewer's latest review counts; approvals only count for the current head.
  const latest = new Map<string, (typeof reviews)[number]>();
  for (const rv of reviews) if (rv.author) latest.set(rv.author, rv);
  const approvals = [...latest.values()].filter((rv) => rv.state === "approved" && rv.commit === head).length;
  // People asked to review who haven't yet (any review of theirs after the request answers it).
  const requested = (ctx.db.prepare("SELECT o.handle, q.created_at FROM review_requests q JOIN owners o ON o.id = q.user_id WHERE q.repo_id = ? AND q.number = ? ORDER BY q.id").all(repo.id, r.number) as { handle: string; created_at: string }[])
    .filter((q) => !reviews.some((rv) => rv.author === q.handle && rv.createdAt >= q.created_at))
    .map((q) => q.handle);
  const changesRequested = [...latest.values()].some((rv) => rv.state === "changes_requested");
  return {
    number: r.number,
    title: r.title,
    body: r.body,
    author: handleOf(ctx, r.author_id),
    source: r.source,
    target: r.target,
    state: r.state,
    status: r.state === "merged" ? "merged" : changesRequested ? "changes-requested" : approvals > 0 ? "approved" : r.state,
    head,
    checks: head ? latestCheckStatus(ctx, repo, head) : null,
    approvals,
    comments,
    reviews,
    reviewRequests: requested,
    mergedCommit: r.merged_commit,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function createPull(ctx: Ctx, repo: RepoRow, authorId: number, input: { title: string; body?: string; source: string; target?: string }) {
  if (!input.title?.trim()) throw badRequest("Give the pull request a title.");
  const target = input.target ?? repo.default_branch;
  if (input.source === target) throw badRequest("Choose two different branches.");
  const head = resolveRef(ctx, repo, input.source);
  const base = resolveRef(ctx, repo, target);
  if (isAncestor(ctx, repo, head, base)) throw badRequest(`${target} already contains every commit on ${input.source}.`);
  if (ctx.db.prepare("SELECT 1 FROM pulls WHERE repo_id = ? AND source = ? AND target = ? AND state = 'open'").get(repo.id, input.source, target)) {
    throw conflict("pull_exists", `There’s already an open pull request from ${input.source} into ${target}.`);
  }
  const number = nextNumber(ctx, repo);
  ctx.db.prepare("INSERT INTO pulls (repo_id, number, title, body, author_id, source, target) VALUES (?, ?, ?, ?, ?, ?, ?)").run(repo.id, number, input.title.trim(), input.body ?? "", authorId, input.source, target);
  return getPull(ctx, repo, number);
}

export function listPulls(ctx: Ctx, repo: RepoRow, filter: { state?: string } = {}) {
  const rows = ctx.db.prepare("SELECT * FROM pulls WHERE repo_id = ? ORDER BY number DESC").all(repo.id) as PullRow[];
  return rows.filter((r) => !filter.state || r.state === filter.state).map((r) => pullJson(ctx, repo, r));
}

export function getPull(ctx: Ctx, repo: RepoRow, number: number) {
  const row = ctx.db.prepare("SELECT * FROM pulls WHERE repo_id = ? AND number = ?").get(repo.id, number) as PullRow | undefined;
  if (!row) throw notFound(`Pull request #${number}`);
  return pullJson(ctx, repo, row);
}

export function reviewPull(ctx: Ctx, repo: RepoRow, number: number, reviewerId: number, input: { state: "approved" | "changes_requested" | "commented"; body?: string }) {
  const pull = getPull(ctx, repo, number);
  if (pull.state !== "open") throw badRequest("Only open pull requests can be reviewed.");
  if (!["approved", "changes_requested", "commented"].includes(input.state)) throw badRequest("Review state must be approved, changes_requested or commented.");
  if (input.state !== "commented" && handleOf(ctx, reviewerId) === pull.author) throw badRequest("You can’t approve or request changes on your own pull request.");
  ctx.db.prepare("INSERT INTO reviews (repo_id, number, author_id, state, body, commit_id) VALUES (?, ?, ?, ?, ?, ?)").run(repo.id, number, reviewerId, input.state, input.body ?? "", pull.head);
  return getPull(ctx, repo, number);
}

const MAX_REQUESTS = 10;

/** Ask a specific person to review. They must be able to see the repository; the author can't be asked. */
export function requestReview(ctx: Ctx, repo: RepoRow, number: number, requesterId: number, handle: unknown) {
  const pull = getPull(ctx, repo, number);
  if (pull.state !== "open") throw badRequest("Only open pull requests can be reviewed.");
  const who = String(handle ?? "").replace(/^@/, "").trim().toLowerCase();
  const row = ctx.db.prepare("SELECT o.id, o.handle, o.kind FROM owners o WHERE o.handle = ?").get(who) as { id: number; handle: string; kind: string } | undefined;
  if (!row || row.kind !== "user") throw notFound(`Person @${who}`);
  if (row.handle === pull.author) throw badRequest("The author can’t review their own pull request.");
  if (repoAccess(ctx, repo, row.id) === "none") throw badRequest(`@${row.handle} can’t see this repository. Give them access first, then ask for their review.`);
  const waiting = (ctx.db.prepare("SELECT COUNT(*) AS n FROM review_requests WHERE repo_id = ? AND number = ?").get(repo.id, number) as { n: number }).n;
  const have = ctx.db.prepare("SELECT 1 FROM review_requests WHERE repo_id = ? AND number = ? AND user_id = ?").get(repo.id, number, row.id);
  if (!have && waiting >= MAX_REQUESTS) throw badRequest(`Up to ${MAX_REQUESTS} reviewers can be asked on one pull request.`);
  // Asking again starts a fresh request, so a person who already reviewed is asked to look again. A review answers the
  // requests made at or before it, and timestamps have millisecond resolution, so a request made in the same
  // millisecond as their last review must still come out after it: never stamp it earlier than that review plus 1 ms.
  const last = ctx.db.prepare("SELECT MAX(created_at) AS at FROM reviews WHERE repo_id = ? AND number = ? AND author_id = ?").get(repo.id, number, row.id) as { at: string | null };
  const nowIso = new Date().toISOString();
  const stamp = last.at && last.at >= nowIso ? new Date(Date.parse(last.at) + 1).toISOString() : nowIso;
  ctx.db
    .prepare("INSERT INTO review_requests (repo_id, number, user_id, requested_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repo_id, number, user_id) DO UPDATE SET created_at = excluded.created_at, requested_by = excluded.requested_by")
    .run(repo.id, number, row.id, requesterId, stamp);
  return { pull: getPull(ctx, repo, number), requested: row.handle, id: row.id };
}

export function withdrawReviewRequest(ctx: Ctx, repo: RepoRow, number: number, handle: string) {
  const who = handle.replace(/^@/, "").trim().toLowerCase();
  const r = ctx.db.prepare("DELETE FROM review_requests WHERE repo_id = ? AND number = ? AND user_id = (SELECT id FROM owners WHERE handle = ?)").run(repo.id, number, who);
  if (r.changes === 0) throw notFound(`A review request for @${who}`);
  return getPull(ctx, repo, number);
}

/**
 * Merge a pull request. Branch protection: checks must pass on the head commit (require_checks)
 * and an approval of the current head is needed (require_review). Fast-forwards when possible,
 * otherwise records a merge commit; conflicting files are reported, never guessed.
 */
export async function mergePull(ctx: Ctx, repo: RepoRow, number: number, actor: string) {
  const pull = getPull(ctx, repo, number);
  if (pull.state !== "open") throw badRequest(`Pull request #${number} is ${pull.state}.`);
  if (!pull.head) throw badRequest(`Branch ${pull.source} no longer exists.`);
  if (repo.require_checks && pull.checks !== "passed") {
    throw conflict("checks_failing", pull.checks === "failed" ? "Checks are failing on this branch." : "Checks haven’t run on the latest commit yet.");
  }
  if (repo.require_review && pull.approvals < 1) throw conflict("review_required", "An approving review of the latest commit is required.");
  if (repo.require_owner_review) {
    // Imported here: owners.ts builds on this module.
    const { ownersOfPull } = await import("./owners.ts");
    const waiting = (await ownersOfPull(ctx, repo, number)).filter((o) => !(o.state === "approved" && o.current));
    if (waiting.length) {
      throw conflict("owner_review_required", `Code owners still need to approve: ${waiting.map((o) => "@" + o.handle).join(", ")}.`, { owners: waiting.map((o) => ({ handle: o.handle, files: o.files })) });
    }
  }

  const baseTip = resolveRef(ctx, repo, pull.target);
  let result: string;
  if (isAncestor(ctx, repo, baseTip, pull.head)) {
    result = pull.head;
  } else {
    const baseId = mergeBase(ctx, repo, baseTip, pull.head);
    const tree = (id: string) => getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, id, "commit").tree, "tree");
    const merged = threeWayMerge(baseId ? tree(baseId) : null, tree(baseTip), tree(pull.head));
    if (merged.conflicts.length) throw conflict("merge_conflict", `${merged.conflicts.length} files changed on both branches.`, { files: merged.conflicts });
    const commit = makeCommit(
      { tree: objectId(merged.tree), parents: [baseTip, pull.head], author: actor, message: `Merge #${number}: ${pull.title}`, timestamp: new Date().toISOString() },
      merged.tree,
    );
    registerObjects(ctx, repo, [merged.tree, commit]);
    result = objectId(commit);
  }
  updateBranch(ctx, repo, pull.target, result, baseTip, actor, "merge");
  if (result !== pull.head) await runChecks(ctx, repo, result, pull.target);
  ctx.db.prepare("UPDATE pulls SET state = 'merged', merged_commit = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE repo_id = ? AND number = ?").run(result, repo.id, number);
  return getPull(ctx, repo, number);
}

export function closePull(ctx: Ctx, repo: RepoRow, number: number) {
  const pull = getPull(ctx, repo, number);
  if (pull.state !== "open") throw badRequest(`Pull request #${number} is ${pull.state}.`);
  ctx.db.prepare("UPDATE pulls SET state = 'closed', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE repo_id = ? AND number = ?").run(repo.id, number);
  return getPull(ctx, repo, number);
}
