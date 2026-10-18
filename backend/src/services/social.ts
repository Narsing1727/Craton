// Stars: who starred which repository. repos.stars is kept equal to the number of rows here.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { readableBy, repoJson } from "./repos.ts";

async function recount(ctx: Ctx, repoId: number) {
  await ctx.db.run("UPDATE repos SET stars = (SELECT COUNT(*) FROM stars WHERE repo_id = ?) WHERE id = ?", repoId, repoId);
}

export async function star(ctx: Ctx, repo: RepoRow, userId: number) {
  await ctx.db.run("INSERT INTO stars (user_id, repo_id) VALUES (?, ?) ON CONFLICT DO NOTHING", userId, repo.id);
  await recount(ctx, repo.id);
}

export async function unstar(ctx: Ctx, repo: RepoRow, userId: number) {
  await ctx.db.run("DELETE FROM stars WHERE user_id = ? AND repo_id = ?", userId, repo.id);
  await recount(ctx, repo.id);
}

export async function hasStarred(ctx: Ctx, repo: RepoRow, userId: number | null) {
  return userId !== null && Boolean(await ctx.db.get("SELECT 1 FROM stars WHERE user_id = ? AND repo_id = ?", userId, repo.id));
}

/** Repositories a person starred that the viewer can see, newest star first. */
export async function starredBy(ctx: Ctx, ownerId: number, viewerId: number | null) {
  const access = readableBy(viewerId);
  const rows = await ctx.db.all<RepoRow & { starred_at: string }>(
    `SELECT r.*, o.handle AS owner, s.created_at AS starred_at FROM stars s JOIN repos r ON r.id = s.repo_id JOIN owners o ON o.id = r.owner_id
      WHERE s.user_id = ? AND ${access.sql} ORDER BY s.created_at DESC`,
    ownerId, ...access.params,
  );
  return rows.map((r) => ({ ...repoJson(r), starredAt: r.starred_at }));
}

const PERIOD_DAYS = { day: 1, week: 7, month: 30 } as const;
export type TrendingPeriod = keyof typeof PERIOD_DAYS;

/**
 * Public repositories ranked by stars received in the period (then by total stars), with whether
 * the viewer starred each one. Counts come from the stars table, so they're exact.
 */
export async function trending(ctx: Ctx, period: TrendingPeriod, viewerId: number | null, limit = 50) {
  const since = new Date(Date.now() - PERIOD_DAYS[period] * 86_400_000).toISOString();
  // Public only, whoever is asking; ranked and cut to the limit by the database.
  const rows = await ctx.db.all<RepoRow & { gained: number }>(
    `SELECT r.*, o.handle AS owner, COALESCE(g.n, 0) AS gained
       FROM repos r JOIN owners o ON o.id = r.owner_id
       LEFT JOIN (SELECT repo_id, COUNT(*) AS n FROM stars WHERE created_at >= ? GROUP BY repo_id) g ON g.repo_id = r.id
      WHERE r.visibility = 'public' ORDER BY COALESCE(g.n, 0) DESC, r.stars DESC, r.id LIMIT ?`,
    since, limit,
  );
  const mine = new Set(viewerId === null || !rows.length ? [] : (await ctx.db.all<{ repo_id: number }>(`SELECT repo_id FROM stars WHERE user_id = ? AND repo_id IN (${rows.map(() => "?").join(",")})`, viewerId, ...rows.map((r) => r.id))).map((r) => r.repo_id));
  return rows.map((r) => ({ ...repoJson(r), gained: r.gained, starred: mine.has(r.id) }));
}
