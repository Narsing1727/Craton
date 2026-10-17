import type { Metadata } from "next";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Issues · ${owner}/${repo}` };
}

import { IssueList } from "@/components/work-lists";
import { loadIssues } from "@/lib/source";

export default async function IssuesPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ state?: string; label?: string; q?: string }>;
}) {
  const { owner, repo } = await params;
  const initial = await searchParams;
  const { issues } = await loadIssues(owner, repo);
  const repoIssues = issues.map((i) => ({ ...i, repo: `${owner}/${repo}` }));

  return (
    <>
      <h1 className="sr-only">Issues · {owner}/{repo}</h1>
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <IssueList issues={repoIssues} initial={initial} newHref={`/${owner}/${repo}/issues/new`} milestonesHref={`/${owner}/${repo}/milestones`} />
      </div>
    </>
  );
}
