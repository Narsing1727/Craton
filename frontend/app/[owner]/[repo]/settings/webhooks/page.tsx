import type { Metadata } from "next";
import { WebhooksView } from "./webhooks-view";
import { api } from "@/lib/api";
import { loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Webhooks · ${owner}/${repo}` };
}

export default async function WebhooksPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const summary = await loadRepo(owner, repo);
  const data = summary.live ? await api.webhooks(owner, repo) : null;

  if (!data) {
    return (
      <div className="min-w-0">
        <div className="max-w-3xl">
          <h1 className="text-xl font-semibold">Webhooks</h1>
          <p className="mt-3 border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
            {summary.live
              ? "Only administrators of this repository can see and manage its webhooks, because they include signing secrets and the addresses they call."
              : "Webhooks need the Craton API, which isn’t running."}
          </p>
        </div>
      </div>
    );
  }

  // The last ten deliveries of each webhook, newest first, so a broken receiver shows at a glance.
  const recent: Record<number, { status: "pending" | "succeeded" | "failed"; code: number | null; event: string; at: string }[]> = {};
  await Promise.all(
    data.webhooks.map(async (h) => {
      const list = (await api.webhookDeliveries(owner, repo, h.id)) ?? [];
      recent[h.id] = list.slice(0, 10).map((d) => ({ status: d.status, code: d.responseCode, event: d.event, at: d.deliveredAt ?? d.createdAt }));
    }),
  );

  return <WebhooksView owner={owner} repo={repo} events={data.events} initial={data.webhooks} recent={recent} />;
}
