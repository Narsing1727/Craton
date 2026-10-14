import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Sign in", description: "Sign in to Craton." };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; expired?: string; reset?: string }> }) {
  const params = await searchParams;
  const notice = params.reset
    ? "Your password was changed. Sign in with the new one."
    : params.expired
      ? "Your session ended. Sign in again to continue."
      : params.next
        ? "Sign in to continue."
        : undefined;
  return <AuthForm mode="login" next={params.next} notice={notice} demoHint={process.env.NODE_ENV !== "production"} />;
}
