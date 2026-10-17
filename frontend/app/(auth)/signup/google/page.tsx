import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { send } from "@/lib/api";
import { GOOGLE_PENDING_COOKIE } from "@/lib/session";
import { GoogleUsernameForm } from "@/components/google-username-form";

export const metadata: Metadata = { title: "Choose your username", description: "One more step to finish signing up with Google.", robots: { index: false } };

export default async function GoogleSignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const ticket = (await cookies()).get(GOOGLE_PENDING_COOKIE)?.value;
  if (!ticket) redirect("/signup");
  const pending = await send<{ email: string; name: string; suggestion: string }>("POST", "/auth/google/pending", { ticket }, null);
  if (!pending.ok) redirect("/signup");
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return <GoogleUsernameForm email={pending.data.email} name={pending.data.name} suggestion={pending.data.suggestion} next={safe} />;
}
