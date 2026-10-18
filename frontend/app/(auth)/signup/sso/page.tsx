import type { Metadata } from "next";
import { OAuthSignupPage } from "@/components/oauth-signup-page";

export const metadata: Metadata = { title: "Choose your username", description: "One more step to finish signing up with single sign-on.", robots: { index: false } };

export default async function SsoSignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  return <OAuthSignupPage provider="sso" next={(await searchParams).next} />;
}
