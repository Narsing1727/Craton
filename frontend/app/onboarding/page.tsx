import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { OnboardingFlow } from "./onboarding-flow";

export const metadata: Metadata = { title: "Welcome to Craton" };

export default async function OnboardingPage() {
  const user = await requireUser("/onboarding", { allowUnonboarded: true });
  if (!user) redirect("/login?next=/onboarding");
  if (user.onboardedAt) redirect("/dashboard");
  return (
    <OnboardingFlow
      user={{ handle: user.handle, name: user.name === user.handle ? "" : user.name, role: user.role, orgs: user.writableOwners.filter((o) => o !== user.handle) }}
      server={process.env.CRATON_API_URL ?? "http://localhost:4000"}
    />
  );
}
