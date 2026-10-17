import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { NewRepoView } from "./new-repo-view";
import { loadRepos, loadUser } from "@/lib/source";
import { api } from "@/lib/api";

export const metadata: Metadata = {
  title: "New repository",
  description: "Create a repository for a project’s terrain, vectors and model files.",
};

export default async function NewRepoPage({ searchParams }: { searchParams: Promise<{ import?: string }> }) {
  await requireUser("/new");
  const [params, { repos, live }, user, starters] = await Promise.all([searchParams, loadRepos(), loadUser(), api.readmeTemplates()]);
  const owners = live && user ? user.writableOwners : ["hydrolab", "priyam", "deltares"];
  // Orgs first: most projects belong to a team.
  const defaultOwner = owners.find((o) => o !== user?.handle) ?? owners[0];
  return (
    <NewRepoView
      importMode={Boolean(params.import)}
      repos={repos}
      owners={owners}
      defaultOwner={defaultOwner}
      live={live}
      defaultVisibility={user?.defaultVisibility ?? "public"}
      starters={starters ?? []}
      server={process.env.CRATON_API_URL ?? "http://localhost:4000"}
    />
  );
}
