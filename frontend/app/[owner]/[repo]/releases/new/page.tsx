import type { Metadata } from "next";
import { ReleaseForm } from "./release-form";
import { loadBranches, loadCommits, loadReleases, loadRepo } from "@/lib/source";
import { api } from "@/lib/api";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `New release · ${owner}/${repo}` };
}

export default async function NewReleasePage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  const [{ branches }, { releases }, { commits }] = await Promise.all([
    loadBranches(owner, repo),
    loadReleases(owner, repo),
    loadCommits(owner, repo, summary.repo.defaultBranch),
  ]);
  const latest = releases.find((r) => r.latest) ?? releases[0];

  // Commits on the default branch since the latest release (for generated notes).
  const cut = latest ? commits.findIndex((c) => c.sha.startsWith(latest.sha)) : -1;
  const since = (cut === -1 ? commits.slice(0, 3) : commits.slice(0, cut)).map((c) => ({ sha: c.sha, message: c.message, author: c.authorHandle }));

  // The files those commits touched, with how much of each changed file was rewritten.
  const compare = summary.live && latest ? await api.compare(owner, repo, latest.sha, summary.repo.defaultBranch).catch(() => null) : null;
  const files = (compare?.changes ?? []).map((c) => ({
    path: c.path,
    change: c.change,
    chunksRewritten: c.change === "modified" ? c.chunks.added : undefined,
    chunksTotal: c.change === "modified" ? c.chunks.added + c.chunks.shared : undefined,
  }));

  return (
    <ReleaseForm
      owner={owner}
      repo={repo}
      branches={branches.map((b) => b.name)}
      defaultBranch={summary.repo.defaultBranch}
      latestVersion={latest?.version ?? null}
      existing={releases.map((r) => r.version)}
      since={since}
      files={files}
      live={summary.live}
    />
  );
}
