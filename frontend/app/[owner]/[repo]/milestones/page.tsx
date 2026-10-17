import type { Metadata } from "next";
import { MilestonesView } from "./milestones-view";
import { loadMilestones, loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Milestones · ${owner}/${repo}` };
}

export default async function MilestonesPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const [summary, milestones] = await Promise.all([loadRepo(owner, repo), loadMilestones(owner, repo)]);
  // "Today" is decided here, once, so the server and the browser agree on what is overdue.
  const today = new Date().toISOString().slice(0, 10);
  return <MilestonesView owner={owner} repo={repo} milestones={milestones} canWrite={summary.access === "write" || summary.access === "admin"} today={today} />;
}
