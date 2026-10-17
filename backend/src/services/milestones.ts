// Milestones: named goals for a repository ("v2.0 2026 terrain") that issues are grouped under, with
// an optional due date. An issue carries its milestone by title, so renaming one renames it on its
// issues, and deleting one only un-assigns them. Setting a milestone is for people who can write.

import type { Ctx } from "./context.ts";
import { badRequest, conflict, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";

export type Milestone = { id: number; title: string; description: string; due: string | null; state: "open" | "closed"; open: number; closed: number; createdAt: string };

type Row = { id: number; title: string; description: string; due: string | null; state: "open" | "closed"; created_at: string };

const toMilestone = (ctx: Ctx, repo: RepoRow, r: Row): Milestone => {
  const counts = ctx.db.prepare("SELECT state, COUNT(*) AS n FROM issues WHERE repo_id = ? AND milestone = ? GROUP BY state").all(repo.id, r.title) as { state: string; n: number }[];
  const n = (s: string) => counts.find((c) => c.state === s)?.n ?? 0;
  return { id: r.id, title: r.title, description: r.description, due: r.due, state: r.state, open: n("open"), closed: n("closed"), createdAt: r.created_at };
};

function cleanTitle(input: unknown): string {
  const title = String(input ?? "").trim().replace(/\s+/g, " ");
  if (!title) throw badRequest("Give the milestone a title.");
  if (title.length > 60) throw badRequest("Keep a milestone title to 60 characters.");
  return title;
}

function cleanDue(input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const s = String(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`)) || new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) !== s) {
    throw badRequest("Give the due date as YYYY-MM-DD, like 2026-12-31.");
  }
  return s;
}

const find = (ctx: Ctx, repo: RepoRow, id: number) => {
  const row = ctx.db.prepare("SELECT * FROM milestones WHERE repo_id = ? AND id = ?").get(repo.id, id) as Row | undefined;
  if (!row) throw notFound("Milestone");
  return row;
};

/** Open ones first (soonest due date first, undated last), then closed. */
export function listMilestones(ctx: Ctx, repo: RepoRow): Milestone[] {
  const rows = ctx.db
    .prepare("SELECT * FROM milestones WHERE repo_id = ? ORDER BY state = 'closed', due IS NULL, due, title")
    .all(repo.id) as Row[];
  return rows.map((r) => toMilestone(ctx, repo, r));
}

export function createMilestone(ctx: Ctx, repo: RepoRow, input: { title: string; description?: string; due?: string | null }): Milestone {
  const title = cleanTitle(input.title);
  const due = cleanDue(input.due);
  if (ctx.db.prepare("SELECT 1 FROM milestones WHERE repo_id = ? AND title = ?").get(repo.id, title)) throw conflict("exists", `There is already a milestone called “${title}”.`);
  const info = ctx.db.prepare("INSERT INTO milestones (repo_id, title, description, due) VALUES (?, ?, ?, ?)").run(repo.id, title, String(input.description ?? "").slice(0, 500), due);
  return toMilestone(ctx, repo, find(ctx, repo, Number(info.lastInsertRowid)));
}

export function updateMilestone(ctx: Ctx, repo: RepoRow, id: number, patch: { title?: string; description?: string; due?: string | null; state?: string }): Milestone {
  const row = find(ctx, repo, id);
  const title = patch.title !== undefined ? cleanTitle(patch.title) : row.title;
  if (patch.state !== undefined && patch.state !== "open" && patch.state !== "closed") throw badRequest("State must be open or closed.");
  const due = patch.due !== undefined ? cleanDue(patch.due) : row.due;
  if (title !== row.title && title.toLowerCase() !== row.title.toLowerCase() && ctx.db.prepare("SELECT 1 FROM milestones WHERE repo_id = ? AND title = ?").get(repo.id, title)) {
    throw conflict("exists", `There is already a milestone called “${title}”.`);
  }
  ctx.db.prepare("UPDATE milestones SET title = ?, description = ?, due = ?, state = ? WHERE id = ?").run(title, patch.description !== undefined ? String(patch.description).slice(0, 500) : row.description, due, patch.state ?? row.state, id);
  if (title !== row.title) ctx.db.prepare("UPDATE issues SET milestone = ? WHERE repo_id = ? AND milestone = ?").run(title, repo.id, row.title);
  return toMilestone(ctx, repo, find(ctx, repo, id));
}

/** Issues keep existing; they just lose the milestone. Returns how many. */
export function deleteMilestone(ctx: Ctx, repo: RepoRow, id: number): number {
  const row = find(ctx, repo, id);
  const info = ctx.db.prepare("UPDATE issues SET milestone = NULL WHERE repo_id = ? AND milestone = ?").run(repo.id, row.title);
  ctx.db.prepare("DELETE FROM milestones WHERE id = ?").run(id);
  return Number(info.changes);
}

/** The title to store on an issue: the milestone must exist in this repository and be open. */
export function resolveForIssue(ctx: Ctx, repo: RepoRow, input: unknown): string | null {
  if (input === null || input === undefined || input === "") return null;
  const row = ctx.db.prepare("SELECT title, state FROM milestones WHERE repo_id = ? AND title = ?").get(repo.id, String(input).trim()) as { title: string; state: string } | undefined;
  if (!row) throw badRequest(`This repository has no milestone called “${String(input).slice(0, 60)}”. Create it first.`);
  if (row.state === "closed") throw badRequest(`The milestone “${row.title}” is closed.`);
  return row.title;
}
