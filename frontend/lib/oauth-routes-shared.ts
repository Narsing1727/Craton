// The providers a person can sign in with, and how each is named in the interface. No server-only imports, so client components can use it.
/** "sso" is an organization's own identity provider; it only takes part in signing in, not in Settings' list of connections. */
export type OAuthProvider = "google" | "github" | "sso";
export const PROVIDERS: OAuthProvider[] = ["google", "github"];
export const PROVIDER_NAME: Record<OAuthProvider, string> = { google: "Google", github: "GitHub", sso: "Single sign-on" };

/** What each ?<provider>= answer from a sign-in means, in words (the sign-in page and Settings both use these). */
export function providerNotice(provider: OAuthProvider, answer: string | undefined, where: "signin" | "settings"): string | undefined {
  if (!answer) return undefined;
  const n = PROVIDER_NAME[provider];
  const common: Record<string, string> = {
    denied: where === "signin" ? `${n} sign-in was cancelled. You can try again, or sign in with your password.` : `${n} sign-in was cancelled.`,
    expired: where === "signin" ? `That ${n} sign-in expired or came from another browser. Try again.` : `That ${n} sign-in expired. Try again.`,
    unverified: `An account with that email exists, but its address was never confirmed. Confirm it from the email we sent (or reset the password), then use ${n} again.`,
    noemail: provider === "sso" ? "Your identity provider didn’t send an email address. Ask its administrator to include the email scope." : `${n} has no verified email address on your account, so it can’t be used to sign in. Verify one with ${n} and try again.`,
    domain: "That address isn’t at a domain your organization has verified, so its single sign-on can’t vouch for it.",
    error: where === "signin" ? `Couldn’t sign in with ${n}. Try again in a moment.` : `Couldn’t connect ${n}. Try again in a moment.`,
    offline: "The Craton API isn’t reachable right now. Try again in a moment.",
    off: `${n} sign-in isn’t set up on this server.`,
    linked: `${n} is connected. You can now sign in with it.`,
    taken: `That ${n} account is already connected to another Craton account.`,
  };
  return common[answer];
}
