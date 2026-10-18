import type { Metadata } from "next";
import { OAuthSignupPage } from "@/components/oauth-signup-page";

export const metadata: Metadata = { title: "Choose your username", description: "One more step to finish signing up with Google.", robots: { index: false } };

export default async function GoogleSignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <OAuthSignupPage provider="google" next={(await searchParams).next} />;
}
