import type { Metadata } from "next";
import { AuditLog } from "@/components/audit-log";
import { api } from "@/lib/api";
import { loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Audit log · ${owner}/${repo}` };
}

export default async function RepoAuditPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  const page = summary.live ? await api.auditLog({ kind: "repo", owner, repo }) : null;
  return (
    <div className="min-w-0">
      <div className="max-w-4xl">
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Changes made to this repository, and attempts that were refused: who, what, and whether from a browser or an access token. Request contents are never kept.
        </p>
        <div className="mt-5">
          {page ? (
            <AuditLog scope={{ kind: "repo", owner, repo }} initial={page} csvHref={`/${owner}/${repo}/settings/audit/export`} />
          ) : (
            <p className="border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {summary.live ? "Only administrators of this repository can read its audit log." : "The audit log needs the Craton API, which isn’t running."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
