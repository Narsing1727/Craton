import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { CircleDot } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/craton-ui";
import { ScopeTabs } from "@/components/scope-tabs";
import { IssueList } from "@/components/work-lists";
import { Button } from "@/components/ui/button";
import { myIssues as demoIssues } from "@/lib/work";
import { loadAllIssues, loadUser } from "@/lib/source";

export const metadata: Metadata = {
  title: "Your issues",
  description: "Issues assigned to you, created by you, or mentioning you across every repository.",
};

type Row = (typeof demoIssues)[number];
const scopeLabels = { assigned: "Assigned to you", created: "Created by you", mentioned: "Mentioning you" };
type Scope = keyof typeof scopeLabels;
const scopeFilter = (me: string): Record<Scope, (i: Row) => boolean> => ({
  assigned: (i) => i.assignee === me,
  created: (i) => i.author === me,
  mentioned: (i) => Boolean(i.mentioned),
});

export default async function MyIssuesPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; state?: string; label?: string; q?: string }>;
}) {
  await requireUser("/issues");
  const params = await searchParams;
  const scope: Scope = params.scope && params.scope in scopeLabels ? (params.scope as Scope) : "assigned";
  const [live, user] = await Promise.all([loadAllIssues(), loadUser()]);
  const me = user?.handle ?? "";
  // Live issues: mentions are @handle in the description.
  const myIssues: Row[] = live
    ? live.map((i) => ({ ...i, assignee: i.assignee ?? "", mentioned: Boolean(i.body?.includes(`@${me}`)) }))
    : demoIssues;
  const filters = scopeFilter(me);
  const list = myIssues.filter(filters[scope]);
  const newHref = live?.[0] ? `/${live[0].repo}/issues/new` : "/hydrolab/chalakudy-basin/issues/new";

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
        <PageHeader
          title="Your issues"
          description="Data-quality problems, questions and requests across every repository you work in."
          actions={
            <Button href={newHref}>
              <CircleDot data-icon="inline-start" />
              New issue
            </Button>
          }
          className="border-b-0 pb-0"
        />
        <ScopeTabs
          label="Issue scope"
          active={scope}
          tabs={(Object.keys(scopeLabels) as Scope[]).map((id) => ({
            id,
            label: scopeLabels[id],
            href: id === "assigned" ? "/issues" : `/issues?scope=${id}`,
            count: myIssues.filter(filters[id]).filter((i) => i.status === "open").length,
          }))}
        />
        <IssueList key={scope} issues={list} showRepo initial={params} />
      </div>
    </AppShell>
  );
}
