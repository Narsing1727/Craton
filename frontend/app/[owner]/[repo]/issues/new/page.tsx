import type { Metadata } from "next";
import { NewIssueForm } from "./new-issue-form";
import { loadMilestones, loadRepo, loadTemplates } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `New issue · ${owner}/${repo}` };
}

export default async function NewIssuePage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const [summary, milestones, templates] = await Promise.all([loadRepo(owner, repo), loadMilestones(owner, repo), loadTemplates(owner, repo)]);
  // Choosing a milestone is for people who can write; everyone else just describes the problem.
  const canWrite = summary.access === "write" || summary.access === "admin";
  return <NewIssueForm owner={owner} repo={repo} milestones={canWrite ? milestones.filter((m) => m.state === "open").map((m) => m.title) : []} templates={templates.issues} />;
}
