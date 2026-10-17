"use server";

// Sign in, sign up, sign out, password reset and onboarding. Session tokens from the API are kept
// in an httpOnly cookie (lib/session.ts); the browser never sees them.

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { fetchUser, send, type ApiUser } from "@/lib/api";
import { cookies } from "next/headers";
import { clearSession, getSessionToken, GOOGLE_PENDING_COOKIE, MFA_COOKIE, setSession } from "@/lib/session";

/** `mfaTicket`: the password was right and a code from the authenticator app is the next step. `restart`: that step expired, go back to the password. */
export type FormResult = { ok: false; error: string; field?: string; restart?: boolean } | { ok: true; message?: string; mfaTicket?: string };

/** Only same-site paths: never redirect to another origin after sign-in. */
function safeNext(next: string | null | undefined, fallback: string) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

export async function loginAction(_: FormResult | null, form: FormData): Promise<FormResult> {
  const login = String(form.get("login") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!login || !password) return { ok: false, error: "Enter your username or email and your password." };
  const result = await send<{ token?: string; mfaRequired?: boolean; ticket?: string }>("POST", "/auth/login", { login, password }, null);
  if (!result.ok) return { ok: false, error: result.offline ? result.error : result.code === "account_locked" || result.code === "rate_limited" ? result.error : "That username or password isn’t right." };
  if (result.data.mfaRequired && result.data.ticket) return { ok: true, mfaTicket: result.data.ticket };
  return finishSignIn(result.data.token!, String(form.get("next") ?? ""));
}

async function finishSignIn(token: string, next: string): Promise<never> {
  await setSession(token);
  (await cookies()).delete(MFA_COOKIE); // a ticket left over from a Google sign-in
  const me = await fetchUser(token);
  redirect(me?.onboardedAt ? safeNext(next, "/dashboard") : "/onboarding");
}

/** Second step of signing in: the code from the authenticator app (or a recovery code). */
export async function loginMfaAction(_: FormResult | null, form: FormData): Promise<FormResult> {
  const ticket = String(form.get("ticket") ?? "");
  const code = String(form.get("code") ?? "").trim();
  if (!code) return { ok: false, error: "Enter the 6-digit code from your authenticator app.", field: "code" };
  const result = await send<{ token: string }>("POST", "/auth/login/2fa", { ticket, code }, null);
  if (!result.ok) {
    if (result.code === "invalid_ticket") return { ok: false, error: result.error, restart: true };
    return { ok: false, error: result.error, field: result.code === "invalid_code" ? "code" : undefined, restart: result.error.includes("no tries left") || undefined };
  }
  return finishSignIn(result.data.token, String(form.get("next") ?? ""));
}

/** Signing in with a passkey: the options (a one-time challenge), then the device's answer. No username is needed. */
export async function passkeyLoginOptionsAction() {
  const r = await send<{ challenge: string; rpId: string; timeout?: number; userVerification?: "preferred"; allowCredentials?: [] }>("POST", "/auth/passkey/options", {}, null);
  return r.ok ? ({ ok: true as const, options: r.data }) : ({ ok: false as const, error: r.error });
}

export async function passkeyLoginAction(credential: unknown, next: string): Promise<FormResult> {
  const r = await send<{ token?: string; mfaRequired?: boolean; ticket?: string }>("POST", "/auth/passkey/login", { credential }, null);
  if (!r.ok) return { ok: false, error: r.error };
  // The device did not verify the person and the account has two-step verification: the code is the next step.
  if (r.data.mfaRequired && r.data.ticket) return { ok: true, mfaTicket: r.data.ticket };
  return finishSignIn(r.data.token!, next);
}

export async function signupAction(_: FormResult | null, form: FormData): Promise<FormResult> {
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(username)) return { ok: false, field: "username", error: "Use lowercase letters, numbers and single dashes (up to 39)." };
  if (password.length < 12) return { ok: false, field: "password", error: "Use at least 12 characters." };
  const result = await send<{ token: string }>("POST", "/auth/signup", { username, email, password }, null);
  if (!result.ok) {
    const field = /taken/i.test(result.error) ? "username" : /email/i.test(result.error) ? "email" : undefined;
    return { ok: false, field, error: result.error };
  }
  await setSession(result.data.token);
  redirect("/onboarding");
}

/** First sign-in with Google or GitHub: the person picks a username (permanent, it is in every URL), then the account exists. */
export async function completeOAuthSignupAction(_: FormResult | null, form: FormData): Promise<FormResult> {
  const provider = String(form.get("provider")) === "github" ? "github" : "google";
  const label = provider === "github" ? "GitHub" : "Google";
  const username = String(form.get("username") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/.test(username)) return { ok: false, field: "username", error: "Use lowercase letters, numbers and single dashes (up to 39)." };
  const jar = await cookies();
  const ticket = jar.get(GOOGLE_PENDING_COOKIE)?.value;
  if (!ticket) return { ok: false, error: `That step expired. Continue with ${label} again.`, restart: true };
  const result = await send<{ token: string }>("POST", `/auth/${provider}/complete`, { ticket, username, name: name || undefined }, null);
  if (!result.ok) {
    if (result.code === "invalid_ticket") return { ok: false, error: result.error, restart: true };
    return { ok: false, field: /taken|reserved|username/i.test(result.error) ? "username" : undefined, error: result.error };
  }
  jar.delete(GOOGLE_PENDING_COOKIE);
  await setSession(result.data.token);
  redirect(safeNext(String(form.get("next") ?? ""), "/onboarding"));
}

/** Settings → Security: take Google or GitHub off the account (the API refuses while it is the only way in). */
export async function disconnectIdentityAction(provider: "google" | "github") {
  const result = await send<null>("DELETE", `/user/identities/${provider === "github" ? "github" : "google"}`);
  if (result.ok) revalidatePath("/settings");
  return result;
}

// ── Passkeys (Settings → Security) ───────────────────────────────────────

export async function passkeyRegisterOptionsAction() {
  const r = await send<Record<string, unknown>>("POST", "/user/passkeys/options");
  return r.ok ? ({ ok: true as const, options: r.data }) : ({ ok: false as const, error: r.error });
}
export async function passkeyRegisterAction(credential: unknown, name: string) {
  const r = await send<{ id: string; name: string }>("POST", "/user/passkeys", { credential, name });
  if (r.ok) revalidatePath("/settings");
  return r;
}
export async function renamePasskeyAction(id: string, name: string) {
  const r = await send<unknown>("PATCH", `/user/passkeys/${encodeURIComponent(id)}`, { name });
  if (r.ok) revalidatePath("/settings");
  return r;
}
export async function removePasskeyAction(id: string) {
  const r = await send<null>("DELETE", `/user/passkeys/${encodeURIComponent(id)}`);
  if (r.ok) revalidatePath("/settings");
  return r;
}

export async function logoutAction() {
  const token = await getSessionToken();
  if (token) await send("POST", "/auth/logout", undefined, token);
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function forgotPasswordAction(_: FormResult | null, form: FormData): Promise<FormResult> {
  const login = String(form.get("login") ?? "").trim();
  if (!login) return { ok: false, error: "Enter the email or username on your account." };
  const result = await send("POST", "/auth/forgot", { login }, null);
  if (!result.ok && result.offline) return { ok: false, error: result.error };
  // The same answer whether or not the account exists.
  return { ok: true, message: login };
}

export async function resetPasswordAction(_: FormResult | null, form: FormData): Promise<FormResult> {
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  if (password.length < 12) return { ok: false, field: "password", error: "Use at least 12 characters." };
  const result = await send<{ handle: string }>("POST", "/auth/reset", { token, password }, null);
  if (!result.ok) return { ok: false, error: result.error };
  // Every session was signed out; sign this browser back in with the new password.
  const login = await send<{ token: string }>("POST", "/auth/login", { login: result.data.handle, password }, null);
  if (login.ok) {
    await setSession(login.data.token);
    redirect("/dashboard");
  }
  redirect("/login?reset=1");
}

// ── Onboarding ───────────────────────────────────────────────────────────

export async function saveProfileAction(input: { name?: string; bio?: string; role?: string | null }) {
  const result = await send<ApiUser>("PATCH", "/user", input);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

export async function finishOnboardingAction(next: string) {
  await send<ApiUser>("PATCH", "/user", { onboarded: true });
  revalidatePath("/", "layout");
  redirect(safeNext(next, "/dashboard"));
}

// ── Account security (Settings → Security) ───────────────────────────────

export async function changePasswordAction(current: string, next: string) {
  if (next.length < 12) return { ok: false as const, error: "Use at least 12 characters." };
  return send<{ ok: true }>("POST", "/user/password", { current, next });
}

export async function revokeSessionAction(id: number) {
  const result = await send<null>("DELETE", `/user/sessions/${id}`);
  if (result.ok) revalidatePath("/settings");
  return result;
}

export async function resendVerificationAction() {
  return send<{ ok: true; alreadyVerified?: boolean }>("POST", "/user/verify/resend");
}

/** From the link in the confirmation email. Works signed in or out. */
export async function verifyEmailAction(token: string) {
  const result = await send<{ handle: string }>("POST", "/auth/verify", { token }, null);
  if (result.ok) revalidatePath("/", "layout");
  return result;
}

/** Permanently delete the account (the API asks for the handle and password), then sign out. */
export async function deleteAccountAction(handle: string, password: string) {
  const result = await send<null>("DELETE", "/user", { handle, password });
  if (!result.ok) return result;
  await clearSession();
  revalidatePath("/", "layout");
  redirect("/?deleted=1");
}


// ── Two-step verification (Settings → Security) ──
/** Start setup: the secret to scan, as a QR code drawn here on the server and as text for typing in. */
export async function twoFactorSetupAction(password: string) {
  const r = await send<{ secret: string; otpauthUrl: string; account: string }>("POST", "/user/2fa/setup", { password });
  if (!r.ok) return r;
  const qr = await QRCode.toString(r.data.otpauthUrl, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } });
  return { ok: true as const, data: { secret: r.data.secret, account: r.data.account, qr } };
}
export async function twoFactorEnableAction(code: string) {
  const r = await send<{ recoveryCodes: string[] }>("POST", "/user/2fa/enable", { code });
  if (r.ok) revalidatePath("/settings");
  return r;
}
export async function twoFactorDisableAction(password: string, code: string) {
  const r = await send<{ ok: true }>("POST", "/user/2fa/disable", { password, code });
  if (r.ok) revalidatePath("/settings");
  return r;
}
export async function twoFactorRecoveryAction(password: string, code: string) {
  const r = await send<{ recoveryCodes: string[] }>("POST", "/user/2fa/recovery-codes", { password, code });
  if (r.ok) revalidatePath("/settings");
  return r;
}
