import { AppShell } from "@/components/app-shell";
import { RepoHeader } from "@/components/repo-header";
import { WikiView } from "@/components/wiki-view";
import { wikiPages } from "@/lib/wiki";

export default async function WikiPage({
  params,
  searchParams,
}: {
  params: Promise<{ owner: string; repo: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { owner, repo } = await params;
  const { page } = await searchParams;
  const slug = typeof page === "string" && wikiPages.some((p) => p.slug === page) ? page : "home";

  return (
    <AppShell>
      <RepoHeader owner={owner} repo={repo} />
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <WikiView pages={wikiPages} activeSlug={slug} />
      </div>
    </AppShell>
  );
}
