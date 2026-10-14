import type { Metadata } from "next";
import { TrendingView, type Period } from "./trending-view";
import { loadTrending } from "@/lib/source";

export const metadata: Metadata = {
  title: "Trending",
  description: "Public geospatial repositories ranked by the stars they received recently.",
};

const periods: Period[] = ["day", "week", "month"];

export default async function TrendingPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const requested = (await searchParams).period as Period;
  const period = periods.includes(requested) ? requested : "week";
  // All three periods up front, so switching between them in the page never asks the server again.
  const [day, week, month] = await Promise.all(periods.map((p) => loadTrending(p)));
  return <TrendingView byPeriod={{ day: day.repos, week: week.repos, month: month.repos }} initialPeriod={period} />;
}
