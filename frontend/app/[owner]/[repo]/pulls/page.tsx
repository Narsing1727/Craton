import type { Metadata } from "next";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Pull requests · ${owner}/${repo}` };
}

import { PullList, type PullWithRepo } from "@/components/work-lists";
import { loadPulls } from "@/lib/source";

// Demo check results (the API returns real ones per pull request).
const demoChecks: Record<number, PullWithRepo["checks"]> = { 142: "failed", 139: "failed", 131: "passed" };

export default async function PullsPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ state?: string; q?: string }>;
}) {
  const { owner, repo } = await params;
  const initial = await searchParams;
  const { pulls: list, live } = await loadPulls(owner, repo);
  const pulls = list.map((p) => ({ ...p, repo: `${owner}/${repo}`, checks: live ? p.checks : demoChecks[p.id] }));

  return (
    <>
      <h1 className="sr-only">Pull requests · {owner}/{repo}</h1>
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <PullList pulls={pulls} initial={initial} newHref={`/${owner}/${repo}/pulls/new`} />
      </div>
    </>
  );
}
