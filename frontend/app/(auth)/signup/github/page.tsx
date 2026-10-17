import type { Metadata } from "next";
import { OAuthSignupPage } from "@/components/oauth-signup-page";

export const metadata: Metadata = { title: "Choose your username", description: "One more step to finish signing up with GitHub.", robots: { index: false } };

export default async function GithubSignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <OAuthSignupPage provider="github" next={(await searchParams).next} />;
}
