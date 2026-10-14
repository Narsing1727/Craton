// Stars: who starred which repository. repos.stars is kept equal to the number of rows here.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { listRepos, repoJson } from "./repos.ts";

function recount(ctx: Ctx, repoId: number) {
  ctx.db.prepare("UPDATE repos SET stars = (SELECT COUNT(*) FROM stars WHERE repo_id = ?) WHERE id = ?").run(repoId, repoId);
}

export function star(ctx: Ctx, repo: RepoRow, userId: number) {
  ctx.db.prepare("INSERT OR IGNORE INTO stars (user_id, repo_id) VALUES (?, ?)").run(userId, repo.id);
  recount(ctx, repo.id);
}

export function unstar(ctx: Ctx, repo: RepoRow, userId: number) {
  ctx.db.prepare("DELETE FROM stars WHERE user_id = ? AND repo_id = ?").run(userId, repo.id);
  recount(ctx, repo.id);
}

export function hasStarred(ctx: Ctx, repo: RepoRow, userId: number | null) {
  return userId !== null && Boolean(ctx.db.prepare("SELECT 1 FROM stars WHERE user_id = ? AND repo_id = ?").get(userId, repo.id));
}

/** Repositories a person starred that the viewer can see, newest star first. */
export function starredBy(ctx: Ctx, ownerId: number, viewerId: number | null) {
  const visible = new Map(listRepos(ctx, viewerId).map((r) => [r.id, r]));
  const rows = ctx.db.prepare("SELECT repo_id, created_at FROM stars WHERE user_id = ? ORDER BY created_at DESC").all(ownerId) as { repo_id: number; created_at: string }[];
  return rows.filter((r) => visible.has(r.repo_id)).map((r) => ({ ...repoJson(visible.get(r.repo_id)!), starredAt: r.created_at }));
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;
export type TrendingPeriod = keyof typeof PERIOD_DAYS;

/**
 * Public repositories ranked by stars received in the period (then by total stars), with whether
 * the viewer starred each one. Counts come from the stars table, so they're exact.
 */
export function trending(ctx: Ctx, period: TrendingPeriod, viewerId: number | null, limit = 50) {
  const since = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString();
  const gains = new Map(
    (ctx.db.prepare("SELECT repo_id, COUNT(*) AS n FROM stars WHERE created_at >= ? GROUP BY repo_id").all(since) as { repo_id: number; n: number }[]).map((r) => [r.repo_id, r.n]),
  );
  const mine = new Set(viewerId === null ? [] : (ctx.db.prepare("SELECT repo_id FROM stars WHERE user_id = ?").all(viewerId) as { repo_id: number }[]).map((r) => r.repo_id));
  return listRepos(ctx, null) // public only, whoever is asking
    .map((r) => ({ ...repoJson(r), gained: gains.get(r.id) ?? 0, starred: mine.has(r.id) }))
    .sort((a, b) => b.gained - a.gained || b.stars - a.stars)
    .slice(0, limit);
}
