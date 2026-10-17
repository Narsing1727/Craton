import type { Metadata } from "next";
import { NewPullView } from "./new-pull-view";
import { commits as demoCommits } from "@/lib/data";
import { loadBranches, loadChecks, loadCompare, loadRepo, loadTemplates } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `New pull request · ${owner}/${repo}` };
}

export default async function NewPullRequestPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ base?: string; head?: string; compare?: string }>;
}) {
  const { owner, repo } = await params;
  const query = await searchParams;
  const [summary, { branches }] = await Promise.all([loadRepo(owner, repo), loadBranches(owner, repo)]);
  const names = branches.map((b) => b.name);
  const valid = (b?: string) => (b && names.includes(b) ? b : undefined);
  const baseBranch = valid(query.base) ?? summary.repo.defaultBranch;
  const compareBranch = valid(query.head ?? query.compare) ?? names.find((n) => n !== baseBranch) ?? baseBranch;

  if (!summary.live) {
    const head = branches.find((b) => b.name === compareBranch);
    const ahead = baseBranch === compareBranch ? 0 : Math.max(head?.ahead ?? 1, 1);
    const list = demoCommits.slice(0, Math.min(ahead, demoCommits.length));
    return (
      <NewPullView
        owner={owner}
        repo={repo}
        branches={names}
        baseBranch={baseBranch}
        compareBranch={compareBranch}
        summary={{ ahead, behind: head?.behind ?? 0, commits: list, files: new Set(list.flatMap((c) => c.files.map((f) => f.name))).size, conflicts: [] }}
        checks={compareBranch === "levee-scenario" || compareBranch === "lidar-2024-update" ? "failed" : "passed"}
        live={false}
      />
    );
  }

  const [result, runs, templates] = await Promise.all([baseBranch === compareBranch ? null : loadCompare(owner, repo, baseBranch, compareBranch), loadChecks(owner, repo), loadTemplates(owner, repo)]);
  const headSha = branches.find((b) => b.name === compareBranch)?.sha;
  const run = (runs ?? []).find((r) => r.commit === headSha);

  return (
    <NewPullView
      owner={owner}
      repo={repo}
      branches={names}
      baseBranch={baseBranch}
      compareBranch={compareBranch}
      summary={{ ahead: result?.ahead ?? 0, behind: result?.behind ?? 0, commits: result?.commits ?? [], files: result?.files.length ?? 0, conflicts: result?.conflicts ?? [] }}
      checks={run?.status ?? null}
      template={templates.pull ?? ""}
      live
    />
  );
}
