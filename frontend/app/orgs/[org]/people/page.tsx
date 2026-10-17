import type { Metadata } from "next";
import { PeopleView, type Person } from "./people-view";
import { orgMembers } from "@/lib/data";
import { loadCommits, loadOwner, noData } from "@/lib/source";

export async function generateMetadata({ params }: { params: Promise<{ org: string }> }): Promise<Metadata> {
  const { org } = await params;
  return { title: `People · ${org}` };
}

export default async function OrgPeoplePage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const owner = await loadOwner(org);
  if (!owner) await noData();
  if (!owner?.members) return <PeopleView org={org} initial={orgMembers} live={false} />;

  // How many of the org's repositories each member has committed to.
  const authors = await Promise.all(owner.repositories.map(async (r) => new Set((await loadCommits(r.owner, r.name, r.defaultBranch)).commits.map((c) => c.authorHandle))));
  const people: Person[] = owner.members.map((m) => ({
    handle: m.handle,
    name: m.name,
    role: m.role as Person["role"],
    repos: authors.filter((set) => set.has(m.handle)).length,
  }));
  return <PeopleView org={org} initial={people} live />;
}
