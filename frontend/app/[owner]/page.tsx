import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ProfileView, type Profile, type ProfileStats } from "./profile-view";
import { activityFeed, repos as demoRepos } from "@/lib/data";
import { contributionsFrom, getContributions } from "@/lib/get-cached-contributions";
import { formatBytes } from "@/lib/format";
import { loadActivity, loadOwner, noData } from "@/lib/source";
import { api } from "@/lib/api";

type Params = { owner: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner } = await params;
  const o = await loadOwner(owner);
  return { title: o ? `${o.name} (@${o.handle})` : owner, description: o?.bio };
}

export default async function ProfilePage({ params }: { params: Promise<Params> }) {
  const { owner } = await params;
  const o = await loadOwner(owner);

  if (!o) {
    await noData(); // 404 when the API is up, an error when it is down, demo only with CRATON_DEMO
    const demo: Profile = {
      handle: owner,
      name: "Priya Menon",
      bio: "Hydraulic modeler & geospatial engineer. Curating open reproducible river basin models, 2D HEC-RAS hydraulics, and cloud-optimized terrain pipelines.",
      headline: "Lead Hydro Modeler",
      org: "hydrolab",
      orgs: ["hydrolab"],
      location: "Kochi, Kerala, India",
      memberSince: "2021",
    };
    const repos = demoRepos.filter((r) => r.owner === owner);
    const stats: ProfileStats = { stored: "14.2 GB", storedHint: "94.2% deduplicated", commits: "1,284", commitsHint: "All signed and Merkle-verified", network: "152", networkHint: "128 followers · 24 following" };
    return <ProfileView profile={demo} repos={repos.length ? repos : demoRepos.slice(0, 4)} activity={activityFeed} contributions={getContributions(owner)} stats={stats} live={false} />;
  }

  // Organizations have their own page.
  if (o.kind === "org") redirect(`/orgs/${o.handle}`);

  const [{ activity }, raw] = await Promise.all([loadActivity(200, o.handle), api.activity({ actor: o.handle, limit: 200 })]);
  // Their own repositories, plus the ones in their orgs they can see.
  const [orgs, rawOwners] = await Promise.all([
    Promise.all((o.orgs ?? []).map((h) => loadOwner(h))),
    Promise.all([o.handle, ...(o.orgs ?? [])].map((h) => api.owner(h))),
  ]);
  const repos = [...o.repositories, ...orgs.flatMap((x) => x?.repositories ?? [])];
  const logical = rawOwners.flatMap((x) => x?.repositories ?? []).reduce((n, r) => n + r.sizeBytes, 0);

  const profile: Profile = {
    handle: o.handle,
    name: o.name,
    bio: o.bio,
    org: o.orgs?.[0],
    orgs: o.orgs ?? [],
    memberSince: new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(o.createdAt)),
  };
  const stats: ProfileStats = {
    stored: formatBytes(logical),
    storedHint: `Across ${repos.length} ${repos.length === 1 ? "repository" : "repositories"}`,
    commits: (o.commitCount ?? 0).toLocaleString("en-US"),
    commitsHint: "Each with a Merkle root the server recomputed",
    network: String(profile.orgs.length),
    networkHint: profile.orgs.join(", ") || "Not in an organization",
  };
  return (
    <ProfileView
      profile={profile}
      repos={repos}
      activity={activity}
      contributions={contributionsFrom((raw ?? []).map((a) => a.at))}
      stats={stats}
      live
    />
  );
}
