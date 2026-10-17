import type { Metadata } from "next";
import { Compass } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/craton-ui";
import { RepoList } from "@/components/repo-list";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { loadStarred } from "@/lib/source";

export const metadata: Metadata = {
  title: "Your stars",
  description: "Repositories and datasets you starred for quick access.",
};

export default async function GlobalStarsPage() {
  await requireUser("/stars");
  const { repos } = await loadStarred();
  return (
    <AppShell>
      <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 xl:px-10">
        <PageHeader
          title="Your stars"
          description="Datasets and models you bookmarked, newest first. Starring also tells maintainers their work is used."
          actions={
            <Button variant="outline" href="/explore">
              <Compass data-icon="inline-start" />
              Find more
            </Button>
          }
        />
        <RepoList
          repos={repos}
          emptyHref="/explore"
          empty={{ title: "No stars yet", description: "Star a repository from its page to keep it one click away.", label: "Explore public data" }}
        />
      </div>
    </AppShell>
  );
}
