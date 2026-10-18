import { RepoSettingsNav } from "@/components/repo-settings-nav";

// The frame for every repository settings page. The list on the left stays mounted and just moves
// its highlight; moving between pages replaces only the pane beside it (see loading.tsx).
export default async function RepoSettingsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  return (
    <div className="grid w-full grid-cols-1 gap-8 px-4 py-6 sm:px-6 md:grid-cols-[220px_1fr] lg:px-8 xl:px-10">
      <div className="md:sticky md:top-20 md:self-start md:pl-1">
        <RepoSettingsNav base={`/${owner}/${repo}`} />
      </div>
      <div className="mx-auto w-full min-w-0 max-w-4xl py-4">{children}</div>
    </div>
  );
}
