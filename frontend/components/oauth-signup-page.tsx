// The page after a first sign-in with a provider: look the pending ticket up and show the username form.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { send } from "@/lib/api";
import { GOOGLE_PENDING_COOKIE } from "@/lib/session";
import type { OAuthProvider } from "@/lib/oauth-routes-shared";
import { OAuthUsernameForm } from "@/components/oauth-username-form";

export async function OAuthSignupPage({ provider, next }: { provider: OAuthProvider; next?: string }) {
  const ticket = (await cookies()).get(GOOGLE_PENDING_COOKIE)?.value;
  if (!ticket) redirect("/signup");
  const pending = await send<{ email: string; name: string; suggestion: string }>("POST", `/auth/${provider}/pending`, { ticket }, null);
  if (!pending.ok) redirect("/signup");
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : undefined;
  return <OAuthUsernameForm provider={provider} email={pending.data.email} name={pending.data.name} suggestion={pending.data.suggestion} next={safe} />;
}
