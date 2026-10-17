"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/components/button-status";
import { Download, KeyRound, LogOut, MailCheck, MailWarning, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeChoice } from "@/components/theme-choice";
import { UnitsChoice } from "@/components/units-choice";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { changePasswordAction, deleteAccountAction, disconnectGoogleAction, passkeyRegisterAction, passkeyRegisterOptionsAction, removePasskeyAction, renamePasskeyAction, resendVerificationAction, revokeSessionAction, saveProfileAction } from "@/app/auth-actions";
import { createPasskey, passkeyErrorMessage, passkeysSupported } from "@/lib/webauthn";
import type { ApiIdentities, ApiPasskey, ApiSecurityEvent, ApiSession, ApiTwoFactor } from "@/lib/api";
import { TwoFactorCard } from "@/components/two-factor-card";
import { timeAgo } from "@/lib/format";

type Tab = "profile" | "security";

export type AccountProfile = { handle: string; name: string; email: string; bio: string; emailVerified: boolean };

/** "Chrome on Windows" from a user agent; the CLI and unknown clients get plain names. */
function device(ua: string | null) {
  if (!ua) return "Unknown device";
  if (/craton-cli/i.test(ua)) return "Craton CLI";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export function SettingsView({
  tab,
  profile,
  sessions,
  twoFactor,
  events = [],
  identities = null,
  passkeys = null,
}: {
  tab: Tab;
  profile: AccountProfile | null;
  sessions: ApiSession[];
  twoFactor: ApiTwoFactor | null;
  events?: ApiSecurityEvent[];
  identities?: ApiIdentities | null;
  passkeys?: ApiPasskey[] | null;
}) {
  const me = profile ?? { handle: "priyam", name: "Priya Menon", email: "priya@hydrolab.org", bio: "Hydrologist building open flood models.", emailVerified: true };
  // Unknown (API down, demo) is treated as "has a password": the old behaviour.
  const hasPassword = identities?.hasPassword ?? true;
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight">{tab === "profile" ? "Profile" : "Security"}</h2>
        <p className="mt-2 text-base text-muted-foreground">{tab === "profile" ? "How you appear next to your commits and on your page." : "Your email, password, two-step verification and where you’re signed in."}</p>
      </div>
    <Tabs value={tab}>
      <TabsContent value="profile" className="flex flex-col gap-4">
        <ProfileCard me={me} live={Boolean(profile)} />
        <ThemeChoice />
        <UnitsChoice />
      </TabsContent>
      <TabsContent value="security" className="flex flex-col gap-4">
        <EmailCard me={me} live={Boolean(profile)} />
        {identities && <SignInMethodsCard identities={identities} />}
        {passkeys && <PasskeysCard passkeys={passkeys} />}
        <PasswordCard live={Boolean(profile)} hasPassword={hasPassword} />
        <TwoFactorCard status={twoFactor} live={Boolean(profile)} />
        <SessionsCard sessions={sessions} />
        {profile && <SecurityLogCard events={events} />}
        <DataCard handle={me.handle} live={Boolean(profile)} hasPassword={hasPassword} />
      </TabsContent>
    </Tabs>
    </div>
  );
}

function ProfileCard({ me, live }: { me: AccountProfile; live: boolean }) {
  const [name, setName] = useState(me.name);
  const [bio, setBio] = useState(me.bio);
  const [saved, setSaved] = useState({ name: me.name, bio: me.bio });
  const [saving, startSave] = useTransition();
  const changed = name.trim() !== saved.name || bio.trim() !== saved.bio;
  const initials = (me.name || me.handle).split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");

  function save() {
    if (!live) return void notify.info("Demo mode: nothing is saved.");
    if (!name.trim()) return void notify.error("Your name can’t be empty");
    startSave(async () => {
      const result = await saveProfileAction({ name: name.trim(), bio: bio.trim() });
      if (!result.ok) return void notify.error("Couldn’t save your profile", { description: result.error });
      setSaved({ name: name.trim(), bio: bio.trim() });
      notify.success("Profile saved");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Public profile</CardTitle>
        <CardDescription>This appears on your profile and next to your commits.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6 sm:flex-row">
          <div className="flex flex-col items-center gap-2">
            <Avatar className="size-24">
              <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
            </Avatar>
            <span className="font-mono text-xs text-muted-foreground">@{me.handle}</span>
          </div>
          <FieldGroup className="flex-1">
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} />
            </Field>
            <Field>
              <FieldLabel htmlFor="bio">Bio</FieldLabel>
              <Textarea id="bio" rows={3} value={bio} onChange={(e) => setBio(e.target.value)} maxLength={280} placeholder="What you model, and where" />
              <FieldDescription>{280 - bio.length} characters left.</FieldDescription>
            </Field>
          </FieldGroup>
        </div>
      </CardContent>
      <CardFooter className="border-t border-border">
        <Button onClick={save} loading={saving} disabled={saving || (live && !changed)}>
          Save changes
        </Button>
      </CardFooter>
    </Card>
  );
}

function EmailCard({ me, live }: { me: AccountProfile; live: boolean }) {
  const [sending, startSend] = useTransition();
  function resend() {
    if (!live) return;
    startSend(async () => {
      const result = await resendVerificationAction();
      if (!result.ok) return void notify.error("Couldn’t send the email", { description: result.error });
      notify.success(result.data.alreadyVerified ? "Your email is already confirmed" : `Confirmation email sent to ${me.email}`);
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email</CardTitle>
        <CardDescription>Used to sign in, reset your password and send security alerts.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-mono">{me.email}</span>
          {me.emailVerified ? (
            <Badge variant="outline" className="gap-1">
              <MailCheck className="size-3" aria-hidden /> Confirmed
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
              <MailWarning className="size-3" aria-hidden /> Not confirmed
            </Badge>
          )}
        </div>
        {!me.emailVerified && (
          <Button variant="outline" size="sm" onClick={resend} loading={sending} disabled={sending}>
            {sending ? "Sending…" : "Resend confirmation"}
          </Button>
        )}
      </CardContent>
      {!me.emailVerified && (
        <CardFooter className="border-t border-border text-xs text-muted-foreground">
          Until it’s confirmed you can work in private repositories, but can’t publish public ones or invite people.
        </CardFooter>
      )}
    </Card>
  );
}

const TRANSPORT: Record<string, string> = { internal: "this device", hybrid: "a phone", usb: "a security key", nfc: "a security key", ble: "a security key", smartcard: "a smart card" };

/** Passkeys: sign in with a fingerprint, face, PIN or security key. The private key never leaves the device. */
function PasskeysCard({ passkeys }: { passkeys: ApiPasskey[] }) {
  const router = useRouter();
  const [supported, setSupported] = useState(true);
  useEffect(() => setSupported(passkeysSupported()), []);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [pending, start] = useTransition();

  function add() {
    start(async () => {
      const options = await passkeyRegisterOptionsAction();
      if (!options.ok) return void notify.error("Couldn’t start adding a passkey", { description: options.error });
      try {
        const credential = await createPasskey(options.options as Parameters<typeof createPasskey>[0]);
        const label = name.trim() || `${device(navigator.userAgent)} passkey`;
        const made = await passkeyRegisterAction(credential, label);
        if (!made.ok) return void notify.error("Couldn’t add the passkey", { description: made.error });
        setName("");
        notify.success("Passkey added", { description: "You can now sign in with it." });
        router.refresh();
      } catch (err) {
        const message = passkeyErrorMessage(err);
        if (message) notify.error("No passkey was added", { description: message });
      }
    });
  }

  function rename() {
    if (!renaming) return;
    const target = renaming;
    start(async () => {
      const r = await renamePasskeyAction(target.id, target.value);
      if (!r.ok) return void notify.error("Couldn’t rename it", { description: r.error });
      setRenaming(null);
      router.refresh();
    });
  }

  async function remove(p: ApiPasskey) {
    const r = await removePasskeyAction(p.id);
    if (!r.ok) return void notify.error("Couldn’t remove the passkey", { description: r.error });
    notify.success(`Removed ${p.name}`);
    router.refresh();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passkeys</CardTitle>
        <CardDescription>Sign in with your fingerprint, face, screen lock or a security key, with nothing to type and nothing to phish. The private key stays on your device.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        {passkeys.length > 0 && (
          <ul className="flex flex-col divide-y divide-border border border-border">
            {passkeys.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2.5">
                <div className="flex min-w-0 items-start gap-3">
                  <KeyRound className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0">
                    {renaming?.id === p.id ? (
                      <form
                        className="flex items-center gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          rename();
                        }}
                      >
                        <Input value={renaming.value} onChange={(e) => setRenaming({ id: p.id, value: e.target.value })} className="h-8 w-52" maxLength={60} aria-label="Passkey name" autoFocus />
                        <Button type="submit" size="sm" disabled={pending || !renaming.value.trim()}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                        {p.name}
                        {p.synced && <Badge variant="outline">Synced</Badge>}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Added {timeAgo(p.createdAt)} · {p.lastUsedAt ? `used ${timeAgo(p.lastUsedAt)}` : "not used yet"}
                      {p.transports.length > 0 && ` · ${[...new Set(p.transports.map((t) => TRANSPORT[t] ?? t))].join(", ")}`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setRenaming({ id: p.id, value: p.name })}>
                    Rename
                  </Button>
                  <ConfirmAction
                    trigger={
                      <Button variant="ghost" size="sm" className="text-destructive hover:bg-destructive/10">
                        Remove
                      </Button>
                    }
                    title={`Remove “${p.name}”?`}
                    description="You won’t be able to sign in with it any more. Your other ways of signing in are not affected."
                    confirmLabel="Remove passkey"
                    onConfirm={() => void remove(p)}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
        {supported ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name it, like “Work laptop”…" className="h-8 w-60" maxLength={60} aria-label="Name for the new passkey" autoComplete="off" />
            <Button size="sm" onClick={add} loading={pending} disabled={pending}>
              Add a passkey
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">This browser can’t create passkeys. Open Settings in a current Chrome, Edge, Safari or Firefox to add one.</p>
        )}
      </CardContent>
    </Card>
  );
}

/** Google, with a way to connect or disconnect it. Only drawn when the API answered. */
function SignInMethodsCard({ identities }: { identities: ApiIdentities }) {
  const google = identities.identities.find((i) => i.provider === "google");
  const [removing, startRemove] = useTransition();
  const router = useRouter();
  const search = useSearchParams();
  const note = (
    {
      linked: "Google is connected. You can now sign in with it.",
      taken: "That Google account is already connected to another Craton account.",
      denied: "Google sign-in was cancelled.",
      expired: "That Google sign-in expired. Try again.",
      error: "Couldn’t connect Google. Try again in a moment.",
      off: "Google sign-in isn’t set up on this server.",
      offline: "The Craton API isn’t reachable right now. Try again in a moment.",
    } as Record<string, string>
  )[search.get("google") ?? ""];

  function disconnect() {
    startRemove(async () => {
      const result = await disconnectGoogleAction();
      if (!result.ok) return void notify.error("Couldn’t disconnect Google", { description: result.error });
      notify.success("Google disconnected");
      router.refresh();
    });
  }

  if (!google && !identities.googleAvailable) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in methods</CardTitle>
        <CardDescription>{google ? "You can sign in with your password or with Google." : "Add Google to sign in without typing your password."}</CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {note && (
          <p role="status" className="mb-4 border border-border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
            {note}
          </p>
        )}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">Google</p>
            <p className="truncate text-xs text-muted-foreground">{google ? `Connected as ${google.email}` : "Not connected"}</p>
          </div>
          {google ? (
            <Button variant="outline" size="sm" onClick={disconnect} loading={removing} disabled={removing || !identities.hasPassword}>
              Disconnect
            </Button>
          ) : (
            <a href="/auth/google?link=1" className="inline-flex h-8 items-center border border-border px-3 text-sm font-medium hover:bg-muted">
              Connect Google
            </a>
          )}
        </div>
        {google && !identities.hasPassword && (
          <p className="mt-3 text-xs text-muted-foreground text-pretty">
            Google is the only way into this account, so it can’t be disconnected yet. <a href="/forgot-password" className="underline underline-offset-2 hover:text-foreground">Add a password</a> first: we’ll email you a link to set one.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordCard({ live, hasPassword }: { live: boolean; hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!live) return void notify.info("Demo mode: nothing is saved.");
    if (next.length < 12) return setError("Use at least 12 characters.");
    startSave(async () => {
      const result = await changePasswordAction(current, next);
      if (!result.ok) return setError(result.error);
      setCurrent("");
      setNext("");
      notify.success("Password changed", { description: "Every other browser was signed out." });
      router.refresh();
    });
  }

  if (!hasPassword) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>This account signs in with Google and has no password. If you would like one as well, we will email you a link to set it.</CardDescription>
        </CardHeader>
        <CardFooter className="mt-4 border-t border-border">
          <a href="/forgot-password" className="inline-flex h-8 items-center border border-border px-3 text-sm font-medium hover:bg-muted">
            Add a password
          </a>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate>
        <CardHeader>
          <CardTitle>Password</CardTitle>
          <CardDescription>Changing it signs out every other browser. Tokens for the CLI keep working.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup className="max-w-sm">
            <Field>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <Input id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <Input id="new-password" type="password" autoComplete="new-password" minLength={12} value={next} onChange={(e) => setNext(e.target.value)} required aria-describedby="new-password-hint" aria-invalid={error ? true : undefined} />
              <FieldDescription id="new-password-hint">At least 12 characters.</FieldDescription>
            </Field>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-4 border-t border-border">
          <Button type="submit" loading={saving} disabled={saving || !current || !next}>
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

const EVENT_LABEL: Record<string, string> = {
  passkey_added: "Passkey added",
  passkey_removed: "Passkey removed",
  passkey_rollback: "Passkey refused (its counter went backwards)",
  signed_in: "Signed in",
  sign_in_failed: "Failed sign-in attempt",
  password_changed: "Password changed",
  password_reset_requested: "Password reset requested",
  password_reset: "Password reset",
  token_created: "Access token created",
  token_revoked: "Access token revoked",
  session_revoked: "Browser signed out",
  two_factor_enabled: "Two-step verification turned on",
  two_factor_disabled: "Two-step verification turned off",
  recovery_codes_regenerated: "Recovery codes replaced",
  oauth_linked: "Google connected",
  oauth_unlinked: "Google disconnected",
};
const CONCERNING = new Set(["sign_in_failed", "password_reset_requested", "two_factor_disabled", "passkey_rollback"]);

function SecurityLogCard({ events }: { events: ApiSecurityEvent[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent security activity</CardTitle>
        <CardDescription>Sign-ins and changes to your password, tokens and two-step verification. If you don’t recognise something, change your password and sign out other browsers.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {events.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-6 py-3 text-sm">
                <div className="min-w-0">
                  <p className={CONCERNING.has(e.type) ? "font-medium text-destructive" : "font-medium"}>{EVENT_LABEL[e.type] ?? e.type}</p>
                  <p className="text-xs text-muted-foreground">
                    {[e.detail, e.userAgent ? device(e.userAgent) : null, e.ip].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <time dateTime={e.at} className="text-xs text-muted-foreground tabular-nums" suppressHydrationWarning>{timeAgo(e.at)}</time>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard({ sessions }: { sessions: ApiSession[] }) {
  const [list, setList] = useState(sessions);
  const [busy, setBusy] = useState<number | null>(null);

  async function revoke(s: ApiSession) {
    setBusy(s.id);
    const result = await revokeSessionAction(s.id);
    setBusy(null);
    if (!result.ok) return void notify.error("Couldn’t sign that browser out", { description: result.error });
    setList((l) => l.filter((x) => x.id !== s.id));
    notify.success(`Signed out ${device(s.userAgent)}`);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you’re signed in</CardTitle>
        <CardDescription>Browsers with an active session. Sign out any you don’t recognise, then change your password.</CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        {list.length === 0 ? (
          <p className="px-6 py-4 text-sm text-muted-foreground">No sessions to show.</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium">
                    {device(s.userAgent)}
                    {s.current && <Badge variant="secondary">This browser</Badge>}
                  </p>
                  <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                    {s.ip ?? "Unknown address"} · signed in {timeAgo(s.createdAt)}
                    {s.lastUsedAt ? ` · last active ${timeAgo(s.lastUsedAt)}` : ""}
                  </p>
                </div>
                {!s.current && (
                  <Button variant="outline" size="sm" onClick={() => revoke(s)} loading={busy === s.id} disabled={busy === s.id}>
                    <LogOut data-icon="inline-start" />
                    {busy === s.id ? "Signing out…" : "Sign out"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DataCard({ handle, live, hasPassword = true }: { handle: string; live: boolean; hasPassword?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirmHandle, setConfirmHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();

  function remove(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!live) return void notify.info("Demo mode: nothing is deleted.");
    startDelete(async () => {
      const result = await deleteAccountAction(confirmHandle.trim(), password);
      // On success the action signs out and redirects; only failures come back.
      if (result && !result.ok) setError(result.error);
    });
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
          <CardDescription>A JSON copy of your profile, repositories you own, issues, comments, reviews, stars and tokens (without secrets), and the files of your repositories as a ZIP: the default branch of each, one folder per repository.</CardDescription>
        </CardHeader>
        <CardFooter className="border-t border-border">
          <Button variant="outline" disabled={!live} render={live ? <a href="/settings/export" download /> : undefined}>
            <Download data-icon="inline-start" />
            Export account data
          </Button>
          <Button variant="outline" disabled={!live} render={live ? <a href="/settings/export/repositories" download /> : undefined}>
            <Download data-icon="inline-start" />
            Download my repositories (ZIP)
          </Button>
        </CardFooter>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Delete account</CardTitle>
          <CardDescription>
            Removes your account and every repository you own personally. Issues, comments and reviews you wrote stay in other people’s repositories, shown as @ghost. Organization repositories stay with the organization. This can’t be undone. You get one last email confirming it; backups made before then may keep copies until they expire.
          </CardDescription>
        </CardHeader>
        {open ? (
          <form onSubmit={remove} noValidate>
            <CardContent className="pt-4">
              <FieldGroup className="max-w-sm">
                <Field>
                  <FieldLabel htmlFor="confirm-handle">
                    Type <span className="font-mono">{handle}</span> to confirm
                  </FieldLabel>
                  <Input id="confirm-handle" autoComplete="off" spellCheck={false} value={confirmHandle} onChange={(e) => setConfirmHandle(e.target.value)} />
                </Field>
                {hasPassword && (
                  <Field>
                    <FieldLabel htmlFor="delete-password">Password</FieldLabel>
                    <Input id="delete-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                  </Field>
                )}
                {error && (
                  <p role="alert" className="text-sm text-destructive">
                    {error}
                  </p>
                )}
              </FieldGroup>
            </CardContent>
            <CardFooter className="mt-4 gap-2 border-t border-destructive/20">
              <Button type="submit" variant="destructive" loading={deleting} disabled={deleting || confirmHandle.trim() !== handle || (hasPassword && !password)}>
                <Trash2 data-icon="inline-start" />
                {deleting ? "Deleting…" : "Delete my account"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </CardFooter>
          </form>
        ) : (
          <CardFooter className="border-t border-destructive/20">
            <Button variant="destructive" onClick={() => setOpen(true)}>
              <Trash2 data-icon="inline-start" />
              Delete account…
            </Button>
          </CardFooter>
        )}
      </Card>
    </>
  );
}
