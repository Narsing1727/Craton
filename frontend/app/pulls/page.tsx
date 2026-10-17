import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { GitPullRequest } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/craton-ui";
import { ScopeTabs } from "@/components/scope-tabs";
import { PullList } from "@/components/work-lists";
import { Button } from "@/components/ui/button";
import { myPulls as demoPulls } from "@/lib/work";
import { loadAllPulls, loadUser } from "@/lib/source";

export const metadata: Metadata = {
  title: "Your pull requests",
  description: "Reviews waiting on you and pull requests you opened, across every repository.",
};

type Row = (typeof demoPulls)[number];
const scopeLabels = { review: "Review requested", created: "Created by you", all: "All involving you" };
type Scope = keyof typeof scopeLabels;
const scopeFilter = (me: string): Record<Scope, (p: Row) => boolean> => ({
  review: (p) => Boolean(p.reviewRequested),
  created: (p) => p.author === me,
  all: () => true,
});

export default async function MyPullsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; state?: string; q?: string }>;
}) {
  await requireUser("/pulls");
  const params = await searchParams;
  const scope: Scope = params.scope && params.scope in scopeLabels ? (params.scope as Scope) : "review";
  const [live, user] = await Promise.all([loadAllPulls(), loadUser()]);
  const me = user?.handle ?? "";
  // Review requested: someone asked you by name and you haven't reviewed it since.
  const myPulls: Row[] = live
    ? live.map((p) => ({ ...p, reviewRequested: p.status !== "merged" && p.status !== "closed" && Boolean(p.reviewRequests?.includes(me)) }))
    : demoPulls;
  const filters = scopeFilter(me);
  const list = myPulls.filter(filters[scope]);
  const newHref = live?.[0] ? `/${live[0].repo}/pulls/new` : "/hydrolab/chalakudy-basin/pulls/new";

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
        <PageHeader
          title="Your pull requests"
          description="Dataset changes waiting for your review, and the ones you proposed."
          actions={
            <Button href={newHref}>
              <GitPullRequest data-icon="inline-start" />
              New pull request
            </Button>
          }
          className="border-b-0 pb-0"
        />
        <ScopeTabs
          label="Pull request scope"
          active={scope}
          tabs={(Object.keys(scopeLabels) as Scope[]).map((id) => ({
            id,
            label: scopeLabels[id],
            href: id === "review" ? "/pulls" : `/pulls?scope=${id}`,
            count: myPulls.filter(filters[id]).filter((p) => p.status !== "merged" && p.status !== "closed").length,
          }))}
        />
        <PullList key={scope} pulls={list} showRepo initial={params} />
      </div>
    </AppShell>
  );
}
