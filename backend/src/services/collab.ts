// Issues, pull requests, comments, reviews and merging.

import type { Ctx } from "./context.ts";
import { repoAccess } from "./accounts.ts";
import { inGroups } from "../db/db.ts";
import { mapLimit } from "../core/async.ts";
import { badRequest, conflict, forbidden, inTransaction, lockNumbering, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { readableBy } from "./repos.ts";
import * as milestones from "./milestones.ts";
import type { CommitObject, TreeObject } from "../core/objects.ts";
import { makeCommit, objectId } from "../core/objects.ts";
import { getObject, isAncestor, mergeBase, registerObjects, resolveRef, threeWayMerge, updateBranch } from "./history.ts";
import { latestCheckStatus, runChecks } from "../checks/runner.ts";

export const LABELS = ["data-quality", "question", "enhancement", "bug"] as const;
type Label = (typeof LABELS)[number];

const nextNumber = async (ctx: Ctx, repo: RepoRow) => {
  const row = await ctx.db.get("SELECT MAX(n) AS n FROM (SELECT MAX(number) AS n FROM issues WHERE repo_id = ? UNION ALL SELECT MAX(number) FROM pulls WHERE repo_id = ?)", repo.id, repo.id) as { n: number | null };
  return (row.n ?? 0) + 1;
};

const handleOf = async (ctx: Ctx, id: number | null) =>
  id === null ? null : ((await ctx.db.get("SELECT handle FROM owners WHERE id = ?", id) as { handle: string } | undefined)?.handle ?? null);

const userIdOf = async (ctx: Ctx, handle: string) => {
  const row = await ctx.db.get("SELECT id FROM owners WHERE handle = ? AND kind = 'user'", handle) as { id: number } | undefined;
  if (!row) throw badRequest(`@${handle} isn’t a user.`);
  return row.id;
};

// ── Issues ──────────────────────────────────────────────────────────────────

type IssueRow = { number: number; title: string; body: string; author_id: number; state: "open" | "closed"; label: Label; assignee_id: number | null; milestone: string | null; file_ref: string | null; created_at: string; updated_at: string };

/** Handles for a set of owner ids, in one query. */
async function handlesOf(ctx: Ctx, ids: (number | null)[]) {
  const wanted = [...new Set(ids.filter((i): i is number => i !== null))];
  const rows = await inGroups(wanted, 500, (g) => ctx.db.all<{ id: number; handle: string }>(`SELECT id, handle FROM owners WHERE id IN (${g.map(() => "?").join(",")})`, ...g));
  return new Map(rows.map((r) => [r.id, r.handle]));
}

/** How many comments each issue or pull request has (keyed "repoId:number"), in one query however many repositories they are in. */
async function commentCounts(ctx: Ctx, target: "issue" | "pull", rows: { repo_id: number; number: number }[]) {
  const repoIds = [...new Set(rows.map((r) => r.repo_id))];
  const numbers = [...new Set(rows.map((r) => r.number))];
  const counts = new Map<string, number>();
  if (!rows.length) return counts;
  // The repositories and numbers asked for form a grid that is a superset of the pairs; the pairs not asked for are simply not looked up.
  const wanted = new Set(rows.map((r) => `${r.repo_id}:${r.number}`));
  const found = await ctx.db.all<{ repo_id: number; number: number; n: number }>(
    `SELECT repo_id, number, COUNT(*) AS n FROM comments WHERE target = ? AND repo_id IN (${repoIds.map(() => "?").join(",")}) AND number IN (${numbers.map(() => "?").join(",")}) GROUP BY repo_id, number`,
    target, ...repoIds, ...numbers,
  );
  for (const f of found) if (wanted.has(`${f.repo_id}:${f.number}`)) counts.set(`${f.repo_id}:${f.number}`, f.n);
  return counts;
}

/** The JSON of many issues, from any repositories: a few queries for all of them, not a few for each. */
async function issuesJson(ctx: Ctx, rows: (IssueRow & { repo_id: number })[]) {
  const [handles, counts] = await Promise.all([handlesOf(ctx, rows.flatMap((r) => [r.author_id, r.assignee_id])), commentCounts(ctx, "issue", rows)]);
  return rows.map((r) => ({
    number: r.number,
    title: r.title,
    body: r.body,
    author: handles.get(r.author_id) ?? null,
    state: r.state,
    label: r.label,
    assignee: r.assignee_id === null ? null : (handles.get(r.assignee_id) ?? null),
    milestone: r.milestone,
    file: r.file_ref,
    comments: counts.get(`${r.repo_id}:${r.number}`) ?? 0,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

async function issueJson(ctx: Ctx, repo: RepoRow, r: IssueRow) {
  return (await issuesJson(ctx, [{ ...r, repo_id: repo.id }]))[0];
}

export async function createIssue(ctx: Ctx, repo: RepoRow, authorId: number, input: { title: string; body?: string; label?: string; assignee?: string | null; milestone?: string | null; file?: string | null }) {
  if (!input.title?.trim()) throw badRequest("Give the issue a title.");
  const label = (input.label ?? "question") as Label;
  if (!LABELS.includes(label)) throw badRequest(`Label must be one of ${LABELS.join(", ")}.`);
  // Look everything up before the transaction opens: inside it, only its own connection may be used.
  const assigneeId = input.assignee ? await userIdOf(ctx, input.assignee) : null;
  const milestoneId = await milestones.resolveForIssue(ctx, repo, input.milestone);
  const number = await inTransaction(ctx, async (c) => {
    await lockNumbering(c.db, repo.id);
    const n = await nextNumber(c, repo);
    await c.db.run("INSERT INTO issues (repo_id, number, title, body, author_id, label, assignee_id, milestone, file_ref) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", repo.id, n, input.title.trim(), input.body ?? "", authorId, label, assigneeId, milestoneId, input.file ?? null);
    return n;
  });
  return getIssue(ctx, repo, number);
}

/** A page of a repository's issues, newest first, and how many match in all. */
export async function listIssuesPage(ctx: Ctx, repo: RepoRow, filter: { state?: string; label?: string } = {}, page?: { limit: number; offset: number }) {
  const where = ["repo_id = ?"];
  const params: (string | number)[] = [repo.id];
  if (filter.state) (where.push("state = ?"), params.push(filter.state));
  if (filter.label) (where.push("label = ?"), params.push(filter.label));
  const rows = await ctx.db.all(`SELECT * FROM issues WHERE ${where.join(" AND ")} ORDER BY number DESC${page ? " LIMIT ? OFFSET ?" : ""}`, ...params, ...(page ? [page.limit, page.offset] : [])) as IssueRow[];
  const total = page ? (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM issues WHERE ${where.join(" AND ")}`, ...params))!.n : rows.length;
  return { rows: await issuesJson(ctx, rows.map((r) => ({ ...r, repo_id: repo.id }))), total };
}

/** How many issues and pull requests are open, without reading any of them. */
export async function openCounts(ctx: Ctx, repo: RepoRow) {
  const [issues, pulls] = await Promise.all([
    ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM issues WHERE repo_id = ? AND state = 'open'", repo.id),
    ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM pulls WHERE repo_id = ? AND state = 'open'", repo.id),
  ]);
  return { openIssues: issues!.n, openPulls: pulls!.n };
}

export async function listIssues(ctx: Ctx, repo: RepoRow, filter: { state?: string; label?: string } = {}) {
  return (await listIssuesPage(ctx, repo, filter)).rows;
}

/** The most recently updated issues across every repository `userId` can read. */
export async function listIssuesAcross(ctx: Ctx, userId: number | null, filter: { state?: string; limit: number }) {
  const access = readableBy(userId);
  const rows = await ctx.db.all<IssueRow & { repo_id: number }>(
    `SELECT i.* FROM issues i JOIN repos r ON r.id = i.repo_id WHERE ${access.sql}${filter.state ? " AND i.state = ?" : ""} ORDER BY i.updated_at DESC, i.id DESC LIMIT ?`,
    ...access.params, ...(filter.state ? [filter.state] : []), filter.limit,
  );
  const [repoRows, json] = await Promise.all([repoRowsById(ctx, rows.map((r) => r.repo_id)), issuesJson(ctx, rows)]);
  // `json` is in the order of `rows`, which the query already sorted.
  return json.map((i, k) => {
    const repo = repoRows.get(rows[k].repo_id)!;
    return { ...i, repo: `${repo.owner}/${repo.name}` };
  });
}

async function repoRowsById(ctx: Ctx, ids: number[]) {
  const wanted = [...new Set(ids)];
  const rows = await inGroups(wanted, 500, (g) => ctx.db.all<RepoRow>(`SELECT r.*, o.handle AS owner FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.id IN (${g.map(() => "?").join(",")})`, ...g));
  return new Map(rows.map((r) => [r.id, r]));
}

export async function getIssue(ctx: Ctx, repo: RepoRow, number: number) {
  const row = await ctx.db.get("SELECT * FROM issues WHERE repo_id = ? AND number = ?", repo.id, number) as IssueRow | undefined;
  if (!row) throw notFound(`Issue #${number}`);
  return issueJson(ctx, repo, row);
}

export async function updateIssue(ctx: Ctx, repo: RepoRow, number: number, patch: { state?: "open" | "closed"; title?: string; label?: string; assignee?: string | null; milestone?: string | null }) {
  await getIssue(ctx, repo, number);
  if (patch.state && !["open", "closed"].includes(patch.state)) throw badRequest("State must be open or closed.");
  if (patch.label && !LABELS.includes(patch.label as Label)) throw badRequest(`Label must be one of ${LABELS.join(", ")}.`);
  if (patch.state) await ctx.db.run("UPDATE issues SET state = ? WHERE repo_id = ? AND number = ?", patch.state, repo.id, number);
  if (patch.title?.trim()) await ctx.db.run("UPDATE issues SET title = ? WHERE repo_id = ? AND number = ?", patch.title.trim(), repo.id, number);
  if (patch.label) await ctx.db.run("UPDATE issues SET label = ? WHERE repo_id = ? AND number = ?", patch.label, repo.id, number);
  if (patch.assignee !== undefined) await ctx.db.run("UPDATE issues SET assignee_id = ? WHERE repo_id = ? AND number = ?", patch.assignee ? await userIdOf(ctx, patch.assignee) : null, repo.id, number);
  if (patch.milestone !== undefined) await ctx.db.run("UPDATE issues SET milestone = ? WHERE repo_id = ? AND number = ?", await milestones.resolveForIssue(ctx, repo, patch.milestone), repo.id, number);
  await ctx.db.run("UPDATE issues SET updated_at = now_iso() WHERE repo_id = ? AND number = ?", repo.id, number);
  return getIssue(ctx, repo, number);
}

// ── Comments ────────────────────────────────────────────────────────────────

/** The reactions a comment can carry (named, as the web app draws them). */
export const REACTIONS = ["thumbs_up", "thumbs_down", "laugh", "hooray", "confused", "heart", "rocket", "eyes"] as const;
export type Reaction = (typeof REACTIONS)[number];
export type ReactionCounts = Partial<Record<Reaction, { count: number; mine: boolean; by: string[] }>>;

type CommentRow = { id: number; author_id: number; body: string; created_at: string; edited_at: string | null };

async function reactionsOf(ctx: Ctx, ids: number[], viewerId: number | null): Promise<Map<number, ReactionCounts>> {
  const out = new Map<number, ReactionCounts>();
  if (!ids.length) return out;
  const rows = await ctx.db.all(`SELECT r.comment_id, r.emoji, r.user_id, o.handle FROM comment_reactions r JOIN owners o ON o.id = r.user_id WHERE r.comment_id IN (${ids.map(() => "?").join(",")}) ORDER BY r.created_at, o.handle`, ...ids) as { comment_id: number; emoji: Reaction; user_id: number; handle: string }[];
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

const commentJson = async (ctx: Ctx, r: CommentRow, reactions: ReactionCounts | undefined) => ({ id: r.id, author: await handleOf(ctx, r.author_id), body: r.body, createdAt: r.created_at, editedAt: r.edited_at, reactions: reactions ?? {} });

export async function addComment(ctx: Ctx, repo: RepoRow, target: "issue" | "pull", number: number, authorId: number, body: string) {
  if (!body?.trim()) throw badRequest("Comments can’t be empty.");
  if (body.length > 65_536) throw badRequest("Comments are at most 64 KB.");
  const table = target === "issue" ? "issues" : "pulls";
  if (!await ctx.db.get(`SELECT 1 FROM ${table} WHERE repo_id = ? AND number = ?`, repo.id, number)) throw notFound(`${target === "issue" ? "Issue" : "Pull request"} #${number}`);
  await ctx.db.run("INSERT INTO comments (repo_id, target, number, author_id, body) VALUES (?, ?, ?, ?, ?)", repo.id, target, number, authorId, body.trim());
  await ctx.db.run(`UPDATE ${table} SET updated_at = now_iso() WHERE repo_id = ? AND number = ?`, repo.id, number);
  return (await listComments(ctx, repo, target, number, authorId)).at(-1);
}

export async function listComments(ctx: Ctx, repo: RepoRow, target: "issue" | "pull", number: number, viewerId: number | null = null) {
  const rows = await ctx.db.all("SELECT id, author_id, body, created_at, edited_at FROM comments WHERE repo_id = ? AND target = ? AND number = ? ORDER BY id", repo.id, target, number) as CommentRow[];
  const reactions = await reactionsOf(ctx, rows.map((r) => r.id), viewerId);
  return (await Promise.all(rows.map((r) => commentJson(ctx, r, reactions.get(r.id)))));
}

async function commentOf(ctx: Ctx, repo: RepoRow, id: number): Promise<CommentRow & { target: "issue" | "pull"; number: number }> {
  const row = await ctx.db.get("SELECT id, author_id, body, created_at, edited_at, target, number FROM comments WHERE id = ? AND repo_id = ?", id, repo.id) as (CommentRow & { target: "issue" | "pull"; number: number }) | undefined;
  if (!row) throw notFound("Comment");
  return row;
}

export async function getComment(ctx: Ctx, repo: RepoRow, id: number, viewerId: number | null) {
  const row = await commentOf(ctx, repo, id);
  return commentJson(ctx, row, (await reactionsOf(ctx, [id], viewerId)).get(id));
}

/** Only the person who wrote a comment can change its words. */
export async function editComment(ctx: Ctx, repo: RepoRow, id: number, userId: number, body: string) {
  const row = await commentOf(ctx, repo, id);
  if (row.author_id !== userId) throw forbidden("You can only edit your own comments.");
  if (!body?.trim()) throw badRequest("Comments can’t be empty.");
  if (body.length > 65_536) throw badRequest("Comments are at most 64 KB.");
  if (body.trim() !== row.body) await ctx.db.run("UPDATE comments SET body = ?, edited_at = now_iso() WHERE id = ?", body.trim(), id);
  return getComment(ctx, repo, id, userId);
}

/** The author can take a comment back; so can anyone who administers the repository (`isAdmin`), for moderation. */
export async function deleteComment(ctx: Ctx, repo: RepoRow, id: number, userId: number, isAdmin: boolean) {
  const row = await commentOf(ctx, repo, id);
  if (row.author_id !== userId && !isAdmin) throw forbidden("You can only delete your own comments, unless you administer the repository.");
  await ctx.db.run("DELETE FROM comments WHERE id = ?", id);
}

/** Add or take away one person's reaction; asking twice changes nothing. */
export async function setReaction(ctx: Ctx, repo: RepoRow, id: number, userId: number, emoji: string, on: boolean) {
  if (!(REACTIONS as readonly string[]).includes(emoji)) throw badRequest(`Unknown reaction “${emoji.slice(0, 20)}”. Choose from ${REACTIONS.join(", ")}.`);
  await commentOf(ctx, repo, id);
  if (on) await ctx.db.run("INSERT INTO comment_reactions (comment_id, user_id, emoji) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", id, userId, emoji);
  else await ctx.db.run("DELETE FROM comment_reactions WHERE comment_id = ? AND user_id = ? AND emoji = ?", id, userId, emoji);
  return getComment(ctx, repo, id, userId);
}

// ── Pull requests ───────────────────────────────────────────────────────────

type PullRow = { number: number; title: string; body: string; author_id: number; source: string; target: string; state: "open" | "merged" | "closed"; merged_commit: string | null; created_at: string; updated_at: string };

async function reviewsOf(ctx: Ctx, repo: RepoRow, number: number) {
  const rows = await ctx.db.all("SELECT author_id, state, body, commit_id, created_at FROM reviews WHERE repo_id = ? AND number = ? ORDER BY id", repo.id, number) as { author_id: number; state: string; body: string; commit_id: string; created_at: string }[];
  return (await Promise.all(rows.map(async (r) => ({ author: await handleOf(ctx, r.author_id), state: r.state, body: r.body, commit: r.commit_id, createdAt: r.created_at }))));
}

async function pullJson(ctx: Ctx, repo: RepoRow, r: PullRow) {
  let head: string | null = null;
  try {
    head = await resolveRef(ctx, repo, r.source);
  } catch {}
  const reviews = await reviewsOf(ctx, repo, r.number);
  const comments = (await ctx.db.get("SELECT COUNT(*) AS n FROM comments WHERE repo_id = ? AND target = 'pull' AND number = ?", repo.id, r.number) as { n: number }).n;
  // A reviewer's latest review counts; approvals only count for the current head.
  const latest = new Map<string, (typeof reviews)[number]>();
  for (const rv of reviews) if (rv.author) latest.set(rv.author, rv);
  const approvals = [...latest.values()].filter((rv) => rv.state === "approved" && rv.commit === head).length;
  // People asked to review who haven't yet (any review of theirs after the request answers it).
  const requested = (await ctx.db.all("SELECT o.handle, q.created_at FROM review_requests q JOIN owners o ON o.id = q.user_id WHERE q.repo_id = ? AND q.number = ? ORDER BY q.id", repo.id, r.number) as { handle: string; created_at: string }[])
    .filter((q) => !reviews.some((rv) => rv.author === q.handle && rv.createdAt >= q.created_at))
    .map((q) => q.handle);
  const changesRequested = [...latest.values()].some((rv) => rv.state === "changes_requested");
  return {
    number: r.number,
    title: r.title,
    body: r.body,
    author: await handleOf(ctx, r.author_id),
    source: r.source,
    target: r.target,
    state: r.state,
    status: r.state === "merged" ? "merged" : changesRequested ? "changes-requested" : approvals > 0 ? "approved" : r.state,
    head,
    checks: head ? await latestCheckStatus(ctx, repo, head) : null,
    approvals,
    comments,
    reviews,
    reviewRequests: requested,
    mergedCommit: r.merged_commit,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function createPull(ctx: Ctx, repo: RepoRow, authorId: number, input: { title: string; body?: string; source: string; target?: string }) {
  if (!input.title?.trim()) throw badRequest("Give the pull request a title.");
  const target = input.target ?? repo.default_branch;
  if (input.source === target) throw badRequest("Choose two different branches.");
  const head = await resolveRef(ctx, repo, input.source);
  const base = await resolveRef(ctx, repo, target);
  if (await isAncestor(ctx, repo, head, base)) throw badRequest(`${target} already contains every commit on ${input.source}.`);
  if (await ctx.db.get("SELECT 1 FROM pulls WHERE repo_id = ? AND source = ? AND target = ? AND state = 'open'", repo.id, input.source, target)) {
    throw conflict("pull_exists", `There’s already an open pull request from ${input.source} into ${target}.`);
  }
  const number = await inTransaction(ctx, async (c) => {
    await lockNumbering(c.db, repo.id);
    const n = await nextNumber(c, repo);
    await c.db.run("INSERT INTO pulls (repo_id, number, title, body, author_id, source, target) VALUES (?, ?, ?, ?, ?, ?, ?)", repo.id, n, input.title.trim(), input.body ?? "", authorId, input.source, target);
    return n;
  });
  return getPull(ctx, repo, number);
}

/** A page of a repository's pull requests, newest first, and how many match in all. */
export async function listPullsPage(ctx: Ctx, repo: RepoRow, filter: { state?: string } = {}, page?: { limit: number; offset: number }) {
  const where = ["repo_id = ?"];
  const params: (string | number)[] = [repo.id];
  if (filter.state) (where.push("state = ?"), params.push(filter.state));
  const rows = await ctx.db.all(`SELECT * FROM pulls WHERE ${where.join(" AND ")} ORDER BY number DESC${page ? " LIMIT ? OFFSET ?" : ""}`, ...params, ...(page ? [page.limit, page.offset] : [])) as PullRow[];
  const total = page ? (await ctx.db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM pulls WHERE ${where.join(" AND ")}`, ...params))!.n : rows.length;
  return { rows: await mapLimit(rows, 8, (r) => pullJson(ctx, repo, r)), total };
}

export async function listPulls(ctx: Ctx, repo: RepoRow, filter: { state?: string } = {}) {
  return (await listPullsPage(ctx, repo, filter)).rows;
}

/** The most recently updated pull requests across every repository `userId` can read. */
export async function listPullsAcross(ctx: Ctx, userId: number | null, filter: { state?: string; limit: number }) {
  const access = readableBy(userId);
  const rows = await ctx.db.all<PullRow & { repo_id: number }>(
    `SELECT p.* FROM pulls p JOIN repos r ON r.id = p.repo_id WHERE ${access.sql}${filter.state ? " AND p.state = ?" : ""} ORDER BY p.updated_at DESC, p.id DESC LIMIT ?`,
    ...access.params, ...(filter.state ? [filter.state] : []), filter.limit,
  );
  const repoRows = await repoRowsById(ctx, rows.map((r) => r.repo_id));
  return mapLimit(rows, 8, async (r) => {
    const repo = repoRows.get(r.repo_id)!;
    return { ...(await pullJson(ctx, repo, r)), repo: `${repo.owner}/${repo.name}` };
  });
}

export async function getPull(ctx: Ctx, repo: RepoRow, number: number) {
  const row = await ctx.db.get("SELECT * FROM pulls WHERE repo_id = ? AND number = ?", repo.id, number) as PullRow | undefined;
  if (!row) throw notFound(`Pull request #${number}`);
  return pullJson(ctx, repo, row);
}

export async function reviewPull(ctx: Ctx, repo: RepoRow, number: number, reviewerId: number, input: { state: "approved" | "changes_requested" | "commented"; body?: string }) {
  const pull = await getPull(ctx, repo, number);
  if (pull.state !== "open") throw badRequest("Only open pull requests can be reviewed.");
  if (!["approved", "changes_requested", "commented"].includes(input.state)) throw badRequest("Review state must be approved, changes_requested or commented.");
  if (input.state !== "commented" && await handleOf(ctx, reviewerId) === pull.author) throw badRequest("You can’t approve or request changes on your own pull request.");
  await ctx.db.run("INSERT INTO reviews (repo_id, number, author_id, state, body, commit_id) VALUES (?, ?, ?, ?, ?, ?)", repo.id, number, reviewerId, input.state, input.body ?? "", pull.head);
  return getPull(ctx, repo, number);
}

const MAX_REQUESTS = 10;

/** Ask a specific person to review. They must be able to see the repository; the author can't be asked. */
export async function requestReview(ctx: Ctx, repo: RepoRow, number: number, requesterId: number, handle: unknown) {
  const pull = await getPull(ctx, repo, number);
  if (pull.state !== "open") throw badRequest("Only open pull requests can be reviewed.");
  const who = String(handle ?? "").replace(/^@/, "").trim().toLowerCase();
  const row = await ctx.db.get("SELECT o.id, o.handle, o.kind FROM owners o WHERE o.handle = ?", who) as { id: number; handle: string; kind: string } | undefined;
  if (!row || row.kind !== "user") throw notFound(`Person @${who}`);
  if (row.handle === pull.author) throw badRequest("The author can’t review their own pull request.");
  if (await repoAccess(ctx, repo, row.id) === "none") throw badRequest(`@${row.handle} can’t see this repository. Give them access first, then ask for their review.`);
  const waiting = (await ctx.db.get("SELECT COUNT(*) AS n FROM review_requests WHERE repo_id = ? AND number = ?", repo.id, number) as { n: number }).n;
  const have = await ctx.db.get("SELECT 1 FROM review_requests WHERE repo_id = ? AND number = ? AND user_id = ?", repo.id, number, row.id);
  if (!have && waiting >= MAX_REQUESTS) throw badRequest(`Up to ${MAX_REQUESTS} reviewers can be asked on one pull request.`);
  // Asking again starts a fresh request, so a person who already reviewed is asked to look again. A review answers the
  // requests made at or before it, and timestamps have millisecond resolution, so a request made in the same
  // millisecond as their last review must still come out after it: never stamp it earlier than that review plus 1 ms.
  const last = await ctx.db.get("SELECT MAX(created_at) AS at FROM reviews WHERE repo_id = ? AND number = ? AND author_id = ?", repo.id, number, row.id) as { at: string | null };
  const nowIso = new Date().toISOString();
  const stamp = last.at && last.at >= nowIso ? new Date(Date.parse(last.at) + 1).toISOString() : nowIso;
  await ctx.db.run("INSERT INTO review_requests (repo_id, number, user_id, requested_by, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (repo_id, number, user_id) DO UPDATE SET created_at = excluded.created_at, requested_by = excluded.requested_by", repo.id, number, row.id, requesterId, stamp);
  return { pull: await getPull(ctx, repo, number), requested: row.handle, id: row.id };
}

export async function withdrawReviewRequest(ctx: Ctx, repo: RepoRow, number: number, handle: string) {
  const who = handle.replace(/^@/, "").trim().toLowerCase();
  const r = await ctx.db.run("DELETE FROM review_requests WHERE repo_id = ? AND number = ? AND user_id = (SELECT id FROM owners WHERE handle = ?)", repo.id, number, who);
  if (r.changes === 0) throw notFound(`A review request for @${who}`);
  return getPull(ctx, repo, number);
}

/**
 * Merge a pull request. Branch protection: checks must pass on the head commit (require_checks)
 * and an approval of the current head is needed (require_review). Fast-forwards when possible,
 * otherwise records a merge commit; conflicting files are reported, never guessed.
 */
export async function mergePull(ctx: Ctx, repo: RepoRow, number: number, actor: string) {
  const pull = await getPull(ctx, repo, number);
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

  const baseTip = await resolveRef(ctx, repo, pull.target);
  let result: string;
  if (await isAncestor(ctx, repo, baseTip, pull.head)) {
    result = pull.head;
  } else {
    const baseId = await mergeBase(ctx, repo, baseTip, pull.head);
    const tree = async (id: string) => getObject<TreeObject>(ctx, repo, (await getObject<CommitObject>(ctx, repo, id, "commit")).tree, "tree");
    const merged = threeWayMerge(baseId ? await tree(baseId) : null, await tree(baseTip), await tree(pull.head));
    if (merged.conflicts.length) throw conflict("merge_conflict", `${merged.conflicts.length} files changed on both branches.`, { files: merged.conflicts });
    const commit = makeCommit(
      { tree: objectId(merged.tree), parents: [baseTip, pull.head], author: actor, message: `Merge #${number}: ${pull.title}`, timestamp: new Date().toISOString() },
      merged.tree,
    );
    await registerObjects(ctx, repo, [merged.tree, commit]);
    result = objectId(commit);
  }
  await updateBranch(ctx, repo, pull.target, result, baseTip, actor, "merge");
  if (result !== pull.head) await runChecks(ctx, repo, result, pull.target);
  await ctx.db.run("UPDATE pulls SET state = 'merged', merged_commit = ?, updated_at = now_iso() WHERE repo_id = ? AND number = ?", result, repo.id, number);
  return getPull(ctx, repo, number);
}

export async function closePull(ctx: Ctx, repo: RepoRow, number: number) {
  const pull = await getPull(ctx, repo, number);
  if (pull.state !== "open") throw badRequest(`Pull request #${number} is ${pull.state}.`);
  await ctx.db.run("UPDATE pulls SET state = 'closed', updated_at = now_iso() WHERE repo_id = ? AND number = ?", repo.id, number);
  return getPull(ctx, repo, number);
}
