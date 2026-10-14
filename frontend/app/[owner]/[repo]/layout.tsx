import { notFound } from "next/navigation";
import { RepoProvider } from "@/components/repo-context";
import { AppShell } from "@/components/app-shell";
import { RepoHeader } from "@/components/repo-header";
import { GoToFile } from "@/components/go-to-file";
import { apiIsUp, loadRepo } from "@/lib/source";

export default async function RepoLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ owner: string; repo: string }>;
}) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  // With the API running, an unknown repository is a real 404 rather than demo data.
  if (!summary.live && (await apiIsUp())) notFound();

  return (
    <RepoProvider
      value={{
        live: summary.live,
        repo: summary.repo,
        openIssues: summary.openIssues,
        openPulls: summary.openPulls,
        branchCount: summary.branchCount,
        commitCount: summary.commitCount,
        starred: summary.starred,
        access: summary.access,
      }}
    >
      <AppShell>
        <RepoHeader owner={owner} repo={repo} />
        {children}
        <GoToFile owner={owner} repo={repo} />
      </AppShell>
    </RepoProvider>
  );
}
