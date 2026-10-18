// Activity feed across the repositories a viewer can see: pushes and branch changes (ref_log),
// pull requests, issues, comments, reviews and releases, newest first.

import type { Ctx } from "./context.ts";
import { listRepos } from "./repos.ts";
import type { RepoRow } from "./repos.ts";

export type ActivityEvent = {
  type: "commit" | "branch" | "pr" | "comment" | "review" | "issue" | "release";
  actor: string;
  text: string;
  repo: string;
  href: string;
  detail: string;
  at: string;
};

export async function listActivity(ctx: Ctx, userId: number | null, opts: { repo?: RepoRow; actor?: string; limit?: number } = {}): Promise<ActivityEvent[]> {
  const repos = opts.repo ? [opts.repo] : await listRepos(ctx, userId);
  if (!repos.length) return [];
  const byId = new Map(repos.map((r) => [r.id, r]));
  const ids = [...byId.keys()].join(",");
  const limit = Math.min(opts.limit ?? 30, 200);
  const events: ActivityEvent[] = [];
  const name = (id: number) => `${byId.get(id)!.owner}/${byId.get(id)!.name}`;

  const refs = await ctx.db.all(`SELECT rl.repo_id, rl.ref, rl.old_commit, rl.new_commit, rl.actor, rl.at, rl.via, c.message
       FROM ref_log rl LEFT JOIN commits c ON c.id = rl.new_commit AND c.repo_id = rl.repo_id
       WHERE rl.repo_id IN (${ids}) ORDER BY rl.id DESC LIMIT ?`, limit) as { repo_id: number; ref: string; old_commit: string | null; new_commit: string | null; actor: string; at: string; via: string | null; message: string | null }[];
  for (const r of refs) {
    const branch = r.ref.replace(/^branch:/, "");
    const repo = name(r.repo_id);
    const isDefault = byId.get(r.repo_id)!.default_branch === branch;
    // Merges are reported by the pull request itself.
    if (r.via === "merge") continue;
    if (r.via === "import") {
      if (isDefault) events.push({ type: "commit", actor: r.actor, text: "imported the sample project into", repo, href: `/${repo}`, detail: r.message ?? "", at: r.at });
      continue;
    }
    if (!r.new_commit) events.push({ type: "branch", actor: r.actor, text: `deleted branch ${branch} in`, repo, href: `/${repo}/branches`, detail: "", at: r.at });
    else if (!r.old_commit && !isDefault) events.push({ type: "branch", actor: r.actor, text: `created branch ${branch} on`, repo, href: `/${repo}/branches`, detail: r.message ?? "", at: r.at });
    else events.push({ type: "commit", actor: r.actor, text: `pushed to ${branch} in`, repo, href: `/${repo}/commit/${r.new_commit}`, detail: r.message ?? "", at: r.at });
  }

  const pulls = await ctx.db.all(`SELECT p.repo_id, p.number, p.title, p.state, p.created_at, p.updated_at, o.handle FROM pulls p JOIN owners o ON o.id = p.author_id WHERE p.repo_id IN (${ids}) ORDER BY p.updated_at DESC LIMIT ?`, limit) as { repo_id: number; number: number; title: string; state: string; created_at: string; updated_at: string; handle: string }[];
  for (const p of pulls) {
    const repo = name(p.repo_id);
    events.push({ type: "pr", actor: p.handle, text: `opened pull request #${p.number} on`, repo, href: `/${repo}/pull/${p.number}`, detail: p.title, at: p.created_at });
    if (p.state === "merged") events.push({ type: "pr", actor: p.handle, text: `merged pull request #${p.number} into`, repo, href: `/${repo}/pull/${p.number}`, detail: p.title, at: p.updated_at });
  }

  const issues = await ctx.db.all(`SELECT i.repo_id, i.number, i.title, i.created_at, o.handle FROM issues i JOIN owners o ON o.id = i.author_id WHERE i.repo_id IN (${ids}) ORDER BY i.created_at DESC LIMIT ?`, limit) as { repo_id: number; number: number; title: string; created_at: string; handle: string }[];
  for (const i of issues) {
    const repo = name(i.repo_id);
    events.push({ type: "issue", actor: i.handle, text: `opened issue #${i.number} in`, repo, href: `/${repo}/issues/${i.number}`, detail: i.title, at: i.created_at });
  }

  const comments = await ctx.db.all(`SELECT c.repo_id, c.target, c.number, c.body, c.created_at, o.handle FROM comments c JOIN owners o ON o.id = c.author_id WHERE c.repo_id IN (${ids}) ORDER BY c.created_at DESC LIMIT ?`, limit) as { repo_id: number; target: "issue" | "pull"; number: number; body: string; created_at: string; handle: string }[];
  for (const c of comments) {
    const repo = name(c.repo_id);
    const href = c.target === "issue" ? `/${repo}/issues/${c.number}` : `/${repo}/pull/${c.number}`;
    events.push({ type: "comment", actor: c.handle, text: `commented on ${c.target === "issue" ? "issue" : "pull request"} #${c.number} in`, repo, href, detail: c.body, at: c.created_at });
  }

  const reviews = await ctx.db.all(`SELECT r.repo_id, r.number, r.state, r.body, r.created_at, o.handle FROM reviews r JOIN owners o ON o.id = r.author_id WHERE r.repo_id IN (${ids}) ORDER BY r.created_at DESC LIMIT ?`, limit) as { repo_id: number; number: number; state: string; body: string; created_at: string; handle: string }[];
  for (const r of reviews) {
    const repo = name(r.repo_id);
    const verb = r.state === "approved" ? "approved" : r.state === "changes_requested" ? "requested changes on" : "reviewed";
    events.push({ type: "review", actor: r.handle, text: `${verb} pull request #${r.number} in`, repo, href: `/${repo}/pull/${r.number}`, detail: r.body, at: r.created_at });
  }

  const releases = await ctx.db.all(`SELECT r.repo_id, r.tag, r.title, r.created_at, o.handle FROM releases r JOIN owners o ON o.id = r.author_id WHERE r.repo_id IN (${ids}) ORDER BY r.created_at DESC LIMIT ?`, limit) as { repo_id: number; tag: string; title: string; created_at: string; handle: string }[];
  for (const r of releases) {
    const repo = name(r.repo_id);
    events.push({ type: "release", actor: r.handle, text: `published release ${r.tag} of`, repo, href: `/${repo}/releases`, detail: r.title, at: r.created_at });
  }

  return events
    .filter((e) => !opts.actor || e.actor === opts.actor)
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}
