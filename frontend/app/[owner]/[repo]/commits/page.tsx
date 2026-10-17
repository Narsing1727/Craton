import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CommitsView } from "./commits-view";
import { loadBranches, loadCommits, loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Commits · ${owner}/${repo}` };
}

export default async function CommitsPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ ref?: string }> }) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  const branch = (await searchParams).ref || summary.repo.defaultBranch;
  const [{ commits, live }, { branches }] = await Promise.all([loadCommits(owner, repo, branch), loadBranches(owner, repo)]);
  if (summary.live && !live) notFound(); // unknown branch

  return (
    <CommitsView
      key={branch}
      owner={owner}
      repo={repo}
      commits={commits}
      branches={branches.map((b) => b.name)}
      branch={branch}
      defaultBranch={summary.repo.defaultBranch}
    />
  );
}
