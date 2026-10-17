"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/components/button-status";
import { Download, ImagePlus, KeyRound, LogOut, MailCheck, MailWarning, Trash2 } from "lucide-react";
import { ConfirmAction } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { UserAvatar } from "@/components/user-avatar";
import { squareAvatar } from "@/lib/image-resize";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { changePasswordAction, deleteAccountAction, disconnectIdentityAction, passkeyRegisterAction, passkeyRegisterOptionsAction, removeAvatarAction, removePasskeyAction, renamePasskeyAction, resendVerificationAction, revokeSessionAction, saveProfileAction, uploadAvatarAction } from "@/app/auth-actions";
import { createPasskey, passkeyErrorMessage, passkeysSupported } from "@/lib/webauthn";
import type { ApiIdentities, ApiPasskey, ApiSecurityEvent, ApiSession, ApiTwoFactor } from "@/lib/api";
import { TwoFactorCard } from "@/components/two-factor-card";
import { timeAgo } from "@/lib/format";
import { SecurityLogCard, SessionsCard, device } from "@/components/security-activity";
import { PROVIDERS, PROVIDER_NAME, providerNotice, type OAuthProvider } from "@/lib/oauth-routes-shared";

type Tab = "profile" | "security";

export type AccountProfile = { handle: string; name: string; email: string; bio: string; emailVerified: boolean; digest?: "off" | "weekly"; website?: string; location?: string; company?: string; pronouns?: string; hasAvatar?: boolean };

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
  const router = useRouter();
  const start = { name: me.name, bio: me.bio, website: me.website ?? "", location: me.location ?? "", company: me.company ?? "", pronouns: me.pronouns ?? "" };
  const [form, setForm] = useState(start);
  const [saved, setSaved] = useState(start);
  const [saving, startSave] = useTransition();
  const [picture, setPicture] = useState({ has: Boolean(me.hasAvatar), version: 0 });
  const [busy, startPicture] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const set = (field: keyof typeof start) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }));
  const trimmed = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v.trim()])) as typeof start;
  const changed = (Object.keys(start) as (keyof typeof start)[]).some((k) => trimmed[k] !== saved[k]);

  function save() {
    if (!live) return void notify.info("Demo mode: nothing is saved.");
    if (!trimmed.name) return void notify.error("Your name can’t be empty");
    startSave(async () => {
      const result = await saveProfileAction(trimmed);
      if (!result.ok) return void notify.error("Couldn’t save your profile", { description: result.error });
      const now = { ...trimmed, website: result.data.website ?? trimmed.website };
      setForm(now);
      setSaved(now);
      notify.success("Profile saved");
    });
  }

  function choose(file: File | undefined) {
    if (!file) return;
    if (!live) return void notify.info("Demo mode: nothing is saved.");
    startPicture(async () => {
      try {
        const blob = await squareAvatar(file);
        const body = new FormData();
        body.set("avatar", new File([blob], "avatar", { type: blob.type }));
        const result = await uploadAvatarAction(body);
        if (!result.ok) return void notify.error("Couldn’t save the picture", { description: result.error });
        setPicture({ has: true, version: Date.now() });
        router.refresh();
        notify.success("Profile picture updated");
      } catch (err) {
        notify.error("Couldn’t use that image", { description: err instanceof Error ? err.message : undefined });
      } finally {
        if (fileInput.current) fileInput.current.value = "";
      }
    });
  }

  function remove() {
    startPicture(async () => {
      const result = await removeAvatarAction();
      if (!result.ok) return void notify.error("Couldn’t remove the picture", { description: result.error });
      setPicture({ has: false, version: Date.now() });
      router.refresh();
      notify.success("Profile picture removed");
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
          <div className="flex flex-col items-center gap-3">
            <UserAvatar key={picture.version} handle={me.handle} name={me.name || me.handle} version={picture.version || undefined} className="size-24" fallbackClassName="text-2xl" />
            <span className="font-mono text-xs text-muted-foreground">@{me.handle}</span>
            <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" className="sr-only" aria-label="Choose a profile picture" onChange={(e) => choose(e.target.files?.[0])} />
            <div className="flex flex-col items-stretch gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()} loading={busy} disabled={busy}>
                <ImagePlus className="size-3.5" aria-hidden /> {picture.has ? "Change picture" : "Upload picture"}
              </Button>
              {picture.has && (
                <Button type="button" variant="ghost" size="sm" onClick={remove} disabled={busy}>
                  Remove
                </Button>
              )}
            </div>
          </div>
          <FieldGroup className="flex-1">
            <Field>
              <FieldLabel htmlFor="name">Name</FieldLabel>
              <Input id="name" value={form.name} onChange={set("name")} autoComplete="name" maxLength={80} />
            </Field>
            <Field>
              <FieldLabel htmlFor="bio">Bio</FieldLabel>
              <Textarea id="bio" rows={3} value={form.bio} onChange={set("bio")} maxLength={280} placeholder="What you model, and where" />
              <FieldDescription>{280 - form.bio.length} characters left.</FieldDescription>
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="company">Company or institute</FieldLabel>
                <Input id="company" value={form.company} onChange={set("company")} autoComplete="organization" maxLength={80} placeholder="IIT Roorkee" />
              </Field>
              <Field>
                <FieldLabel htmlFor="location">Location</FieldLabel>
                <Input id="location" value={form.location} onChange={set("location")} autoComplete="address-level2" maxLength={80} placeholder="Kochi, India" />
              </Field>
              <Field>
                <FieldLabel htmlFor="website">Website</FieldLabel>
                <Input id="website" type="url" inputMode="url" value={form.website} onChange={set("website")} autoComplete="url" maxLength={200} placeholder="https://example.org" />
              </Field>
              <Field>
                <FieldLabel htmlFor="pronouns">Pronouns</FieldLabel>
                <Input id="pronouns" value={form.pronouns} onChange={set("pronouns")} maxLength={40} placeholder="they/them" />
              </Field>
            </div>
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

/** Google and GitHub, each with a way to connect or disconnect it. Only drawn when the API answered. */
function SignInMethodsCard({ identities }: { identities: ApiIdentities }) {
  const [removing, startRemove] = useTransition();
  const router = useRouter();
  const search = useSearchParams();
  const rows = PROVIDERS.map((provider) => ({
    provider,
    name: PROVIDER_NAME[provider],
    linked: identities.identities.find((i) => i.provider === provider),
    available: provider === "google" ? identities.googleAvailable : identities.githubAvailable,
  })).filter((r) => r.linked || r.available);
  const note = PROVIDERS.map((p) => providerNotice(p, search.get(p) ?? undefined, "settings")).find(Boolean);

  function disconnect(provider: "google" | "github", name: string) {
    startRemove(async () => {
      const result = await disconnectIdentityAction(provider);
      if (!result.ok) return void notify.error(`Couldn’t disconnect ${name}`, { description: result.error });
      notify.success(`${name} disconnected`);
      router.refresh();
    });
  }

  if (!rows.length) return null;
  const connected = rows.filter((r) => r.linked);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign-in methods</CardTitle>
        <CardDescription>{connected.length ? `You can sign in with your password or with ${connected.map((r) => r.name).join(" or ")}.` : `Add ${rows.map((r) => r.name).join(" or ")} to sign in without typing your password.`}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        {note && (
          <p role="status" className="border border-border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
            {note}
          </p>
        )}
        {rows.map((r) => {
          // Another way in has to remain: a password, a passkey, or the other provider.
          const canRemove = identities.hasPassword || identities.passkeys > 0 || connected.length > 1;
          return (
            <div key={r.provider}>
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{r.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{r.linked ? `Connected as ${r.linked.email}` : "Not connected"}</p>
                </div>
                {r.linked ? (
                  <Button variant="outline" size="sm" onClick={() => disconnect(r.provider as "google" | "github", r.name)} loading={removing} disabled={removing || !canRemove}>
                    Disconnect
                  </Button>
                ) : (
                  <a href={`/auth/${r.provider}?link=1`} className="inline-flex h-8 items-center border border-border px-3 text-sm font-medium hover:bg-muted">
                    Connect {r.name}
                  </a>
                )}
              </div>
              {r.linked && !canRemove && (
                <p className="mt-3 text-xs text-muted-foreground text-pretty">
                  {r.name} is the only way into this account, so it can’t be disconnected yet. <a href="/forgot-password" className="underline underline-offset-2 hover:text-foreground">Add a password</a> first: we’ll email you a link to set one.
                </p>
              )}
            </div>
          );
        })}
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
