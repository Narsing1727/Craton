import type { Metadata } from "next";
import { CollaboratorsView } from "./collaborators-view";
import { api } from "@/lib/api";
import { loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Collaborators · ${owner}/${repo}` };
}

export default async function CollaboratorsPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  const list = summary.live ? await api.collaborators(owner, repo) : null;
  const pendingInvites = summary.live && summary.access === "admin" ? ((await api.invites(owner, repo)) ?? []) : [];

  if (!list) {
    return (
      <div className="min-w-0">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold">Collaborators</h1>
          <p className="mt-3 border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {summary.live ? "Only people who can write to this repository can see who has access to it." : "Collaborators need the Craton API, which isn’t running."}
          </p>
        </div>
      </div>
    );
  }
  return <CollaboratorsView owner={owner} repo={repo} initial={list} invites={pendingInvites} isAdmin={summary.access === "admin"} />;
}
