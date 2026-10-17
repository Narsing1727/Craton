import type { Metadata } from "next";
import { ReviewsView } from "./reviews-view";
import { loadModelReviews, loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Model review · ${owner}/${repo}` };
}

export default async function ReviewsPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const [summary, reviews] = await Promise.all([loadRepo(owner, repo), loadModelReviews(owner, repo)]);
  return <ReviewsView owner={owner} repo={repo} reviews={reviews} canWrite={summary.access === "write" || summary.access === "admin"} defaultRef={summary.repo.defaultBranch ?? "main"} />;
}
