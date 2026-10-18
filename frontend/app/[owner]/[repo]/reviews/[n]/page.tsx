import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewView } from "./review-view";
import { loadModelReview, loadRepo } from "@/lib/source";

type Params = { owner: string; repo: string; n: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo, n } = await params;
  return { title: `Model review #${n} · ${owner}/${repo}` };
}

export default async function ReviewPage({ params }: { params: Promise<Params> }) {
  const { owner, repo, n } = await params;
  const number = Number(n);
  if (!Number.isInteger(number) || number < 1) notFound();
  const [summary, review] = await Promise.all([loadRepo(owner, repo), loadModelReview(owner, repo, number)]);
  if (!review) notFound();
  return <ReviewView owner={owner} repo={repo} review={review} canWrite={summary.access === "write" || summary.access === "admin"} />;
}
