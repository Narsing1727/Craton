// For pages that only make sense signed in (the proxy already sent visitors without a cookie to
// /login). If the cookie is there but the API rejects it, clear it and sign in again.

import { redirect } from "next/navigation";
import { apiIsUp, loadUser } from "@/lib/source";

export async function requireUser(next: string, opts: { allowUnonboarded?: boolean } = {}) {
  const user = await loadUser();
  if (!user) {
    // API down: let the page render its offline/demo state instead of looping through /login.
    if (!(await apiIsUp())) return null;
    redirect(`/auth/expired?next=${encodeURIComponent(next)}`);
  }
  if (!user.onboardedAt && !opts.allowUnonboarded) redirect("/onboarding");
  return user;
}
