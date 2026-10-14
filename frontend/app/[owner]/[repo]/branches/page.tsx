import type { Metadata } from "next";
import { BranchesView, type BranchPull } from "./branches-view";
import { loadBranches, loadPulls, loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Branches · ${owner}/${repo}` };
}

export default async function BranchesPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const [summary, { branches }, { pulls }] = await Promise.all([loadRepo(owner, repo), loadBranches(owner, repo), loadPulls(owner, repo)]);

  // The most recent pull request opened from each branch.
  const byBranch: Record<string, BranchPull> = {};
  for (const p of [...pulls].sort((a, b) => a.id - b.id)) byBranch[p.source] = { id: p.id, status: p.status };

  return <BranchesView owner={owner} repo={repo} branches={branches} pulls={byBranch} live={summary.live} defaultBranch={summary.repo.defaultBranch} />;
}
