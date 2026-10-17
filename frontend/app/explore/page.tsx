import type { Metadata } from "next";
import { ExploreView } from "./explore-view";
import { loadRepos } from "@/lib/source";

export const metadata: Metadata = {
  title: "Explore",
  description: "Public terrain, LiDAR, rainfall and hydraulic model repositories.",
};

export default async function ExplorePage({ searchParams }: { searchParams: Promise<{ topic?: string }> }) {
  const { topic } = await searchParams;
  const { repos } = await loadRepos();
  return <ExploreView repos={repos.filter((r) => r.visibility === "public")} topic={topic?.toLowerCase()} />;
}
