import type { Metadata } from "next";
import { SharingView } from "./sharing-view";
import { api } from "@/lib/api";
import { loadBranches, loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Sharing · ${owner}/${repo}` };
}

export default async function SharingPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  const [data, { branches }] = await Promise.all([summary.live ? api.shareLinks(owner, repo) : null, loadBranches(owner, repo)]);

  if (!data) {
    return (
      <div className="min-w-0">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold">Sharing</h1>
          <p className="mt-3 border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {summary.live ? "Only administrators of this repository can make and manage share links." : "Share links need the Craton API, which isn’t running."}
          </p>
        </div>
      </div>
    );
  }

  return <SharingView owner={owner} repo={repo} defaultBranch={summary.repo.defaultBranch} branches={branches.map((b) => b.name)} choices={data.expiryChoices} initial={data.links} />;
}
