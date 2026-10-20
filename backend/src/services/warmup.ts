// Getting ready before anyone asks: right after the server starts, it requests the pages' data for the repositories people look at most, the way a visitor
// would (so exactly the same answers, under exactly the same keys, are remembered), and draws their previews. The first visitor then meets a warm server
// instead of paying for every cold read. Runs in the background, one request at a time, never blocks start-up, and never fails it.

import type { Ctx } from "./context.ts";
import { warmCommit } from "../render/previews.ts";
import { getRepoFor } from "./repos.ts";

type Fetcher = { request: (path: string, init?: RequestInit) => Response | Promise<Response> };
type Listed = { owner: string; name: string; defaultBranch?: string }[];

export type WarmResult = { repositories: number; requests: number; ms: number };

/** Warm the explore list, trending, and the data behind the pages of up to `limit` repositories (in the order the explore list gives them). */
export async function warmUp(app: Fetcher, ctx: Ctx, opts: { limit?: number; log?: (line: string) => void } = {}): Promise<WarmResult> {
  const started = performance.now();
  const limit = opts.limit ?? 12;
  let requests = 0;
  const ask = async (path: string) => {
    requests++;
    const res = await app.request(`/v1${path}`);
    const text = await res.text();
    await new Promise((resolve) => setImmediate(resolve)); // real requests go first
    return { ok: res.ok, text };
  };
  try {
    const listRes = await ask("/repos?limit=50");
    let listed: Listed = [];
    try {
      listed = listRes.ok ? (JSON.parse(listRes.text) as Listed) : [];
    } catch {
      listed = [];
    }
    await ask("/trending");
    let done = 0;
    for (const r of listed.slice(0, limit)) {
      const base = `/repos/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`;
      const branch = r.defaultBranch ?? "main";
      // The calls a repository's pages make, in the form they make them.
      await ask(base);
      await ask(`${base}/tree/${encodeURIComponent(branch)}?all=1`);
      await ask(`${base}/commits?changes=1&limit=100&ref=${encodeURIComponent(branch)}`);
      await ask(`${base}/branches`);
      // The pictures and tile layouts of the rasters and shapefiles in the newest commit.
      try {
        const owner = (await ctx.db.get("SELECT id FROM owners WHERE handle = ?", r.owner)) as { id: number } | undefined;
        if (owner) {
          const repo = await getRepoFor(ctx, r.owner, r.name, owner.id);
          const tip = (await ctx.db.get("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?", repo.id, repo.default_branch)) as { commit_id: string } | undefined;
          if (tip) await warmCommit(ctx, repo, tip.commit_id);
        }
      } catch {
        // A repository that cannot be warmed is just not warm.
      }
      done++;
    }
    const result = { repositories: done, requests, ms: Math.round(performance.now() - started) };
    opts.log?.(`Warmed ${result.repositories} ${result.repositories === 1 ? "repository" : "repositories"} (${result.requests} requests) in ${result.ms} ms.`);
    return result;
  } catch (err) {
    opts.log?.(`Warm-up stopped: ${(err as Error).message}`);
    return { repositories: 0, requests, ms: Math.round(performance.now() - started) };
  }
}
