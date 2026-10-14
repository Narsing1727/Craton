import type { Metadata } from "next";
import { RepoSettingsView } from "./settings-view";
import { loadBranches, loadRepo } from "@/lib/source";
import { api } from "@/lib/api";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Settings · ${owner}/${repo}` };
}

export default async function RepoSettingsPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const [summary, { branches }, licenses, locks] = await Promise.all([loadRepo(owner, repo), loadBranches(owner, repo), api.licenses(), api.locks(owner, repo)]);
  const ownersText = summary.live ? ((await api.raw(owner, repo, summary.repo.defaultBranch || "main", "CODEOWNERS")) ?? "") : "";
  return (
    <RepoSettingsView
      owner={owner}
      repo={repo}
      repoData={summary.repo}
      branches={branches.map((b) => b.name)}
      settings={{ requireChecks: summary.requireChecks, requireReview: summary.requireReview, requireOwnerReview: summary.requireOwnerReview, crs: summary.crs, verticalDatum: summary.verticalDatum, nodata: summary.nodata }}
      licenses={(licenses ?? []).map((l) => ({ id: l.id, name: l.name }))}
      live={summary.live}
      locks={locks ?? []}
      codeOwners={{ text: ownersText, branch: summary.repo.defaultBranch || "main", head: summary.head?.sha }}
    />
  );
}
