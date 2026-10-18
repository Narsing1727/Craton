"use client";

// Settings → Security: where you are signed in, and recent security activity. Each is one quiet row in the page with a
// button that opens the full list in a dialog, grouped by day, the way Google's account pages do it, so the settings page
// does not grow with every browser and every sign-in.

import { useMemo, useState } from "react";
import { Laptop, LogOut, ShieldAlert, ShieldCheck, Smartphone, Terminal } from "lucide-react";
import { notify } from "@/components/button-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { revokeSessionAction } from "@/app/auth-actions";
import type { ApiSecurityEvent, ApiSession } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "Chrome on Windows" from a user agent; the CLI and unknown clients get plain names. */
export function device(ua: string | null) {
  if (!ua) return "Unknown device";
  if (/craton-cli/i.test(ua)) return "Craton CLI";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export const EVENT_LABEL: Record<string, string> = {
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
  oauth_linked: "Sign-in provider connected",
  oauth_unlinked: "Sign-in provider disconnected",
};
/** Events worth a second look: someone failing to get in, or a protection being switched off. */
export const CONCERNING = new Set(["sign_in_failed", "password_reset_requested", "two_factor_disabled", "passkey_rollback"]);

/**
 * The dialog never grows past the screen: its height is capped here, as a style on the element, so it holds whatever the
 * stylesheet has loaded, and the list inside scrolls while the title and the actions stay put.
 */
const DIALOG_BOUNDS = { maxHeight: "min(85dvh, 760px)", width: "min(calc(100vw - 2rem), 36rem)" } as const;

const DeviceIcon = ({ ua, className }: { ua: string | null; className?: string }) => {
  const Icon = ua && /craton-cli/i.test(ua) ? Terminal : ua && /Android|iPhone|iPad/.test(ua) ? Smartphone : Laptop;
  return <Icon className={className} aria-hidden />;
};

/** "Today", "Yesterday", "Monday 12 October", and with the year once it is not this year. In the reader's own time zone. */
function dayLabel(iso: string, now = new Date()) {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: days < 7 ? "long" : undefined, day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/** Items newest first, split into one group per calendar day. */
function byDay<T>(items: T[], at: (item: T) => string): { label: string; items: T[] }[] {
  const groups: { label: string; items: T[] }[] = [];
  for (const item of [...items].sort((a, b) => (at(a) < at(b) ? 1 : -1))) {
    const label = dayLabel(at(item));
    const last = groups.at(-1);
    if (last && last.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

function DayHeading({ children }: { children: React.ReactNode }) {
  return <h3 className="sticky top-0 z-10 bg-popover/95 px-1 pb-2 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground backdrop-blur first:pt-0">{children}</h3>;
}

// ── Where you're signed in ───────────────────────────────────────────────────

export function SessionsCard({ sessions }: { sessions: ApiSession[] }) {
  const [list, setList] = useState(sessions);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | "all" | null>(null);
  const current = list.find((s) => s.current);
  const others = list.filter((s) => !s.current);
  const groups = useMemo(() => byDay(list, (s) => s.lastUsedAt ?? s.createdAt), [list]);

  async function revoke(s: ApiSession) {
    setBusy(s.id);
    const result = await revokeSessionAction(s.id);
    setBusy(null);
    if (!result.ok) return void notify.error("Couldn’t sign that browser out", { description: result.error });
    setList((l) => l.filter((x) => x.id !== s.id));
    notify.success(`Signed out ${device(s.userAgent)}`);
  }

  async function revokeOthers() {
    setBusy("all");
    let failed = 0;
    for (const s of others) {
      const result = await revokeSessionAction(s.id);
      if (result.ok) setList((l) => l.filter((x) => x.id !== s.id));
      else failed++;
    }
    setBusy(null);
    if (failed) notify.error(`Couldn’t sign out ${failed} ${failed === 1 ? "browser" : "browsers"}`);
    else notify.success("Signed out everywhere else");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where you’re signed in</CardTitle>
        <CardDescription>Browsers with an active session. Sign out any you don’t recognise, then change your password.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm">
          {list.length === 0 ? (
            <p className="text-muted-foreground">No sessions to show.</p>
          ) : (
            <>
              <p className="flex items-center gap-2 font-medium">
                <DeviceIcon ua={current?.userAgent ?? null} className="size-4 text-muted-foreground" />
                {current ? device(current.userAgent) : device(list[0].userAgent)}
                {current && <Badge variant="secondary">This browser</Badge>}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">{others.length === 0 ? "No other browsers are signed in." : `And ${others.length} other ${others.length === 1 ? "browser" : "browsers"}.`}</p>
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={list.length === 0}>
          Manage devices
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" style={DIALOG_BOUNDS}>
          <DialogHeader className="border-b border-border p-5 pb-4">
            <DialogTitle>Where you’re signed in</DialogTitle>
            <DialogDescription>
              {list.length} {list.length === 1 ? "browser" : "browsers"} with an active session, most recently used first. Sign out any you don’t recognise, then change your password.
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-4" style={{ overflowY: "auto", overscrollBehavior: "contain" }}>
            {groups.map((g) => (
              <section key={g.label}>
                <DayHeading>{g.label}</DayHeading>
                <ul className="divide-y divide-border">
                  {g.items.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center border border-border text-muted-foreground">
                        <DeviceIcon ua={s.userAgent} className="size-4" />
                      </span>
                      <div className="min-w-0 flex-1 text-sm">
                        <p className="flex flex-wrap items-center gap-2 font-medium">
                          {device(s.userAgent)}
                          {s.current && <Badge variant="secondary">This browser</Badge>}
                        </p>
                        <p className="text-xs text-muted-foreground" suppressHydrationWarning>
                          {s.ip ?? "Unknown address"} · signed in {timeAgo(s.createdAt)}
                          {s.lastUsedAt ? ` · last active ${timeAgo(s.lastUsedAt)}` : ""}
                        </p>
                      </div>
                      {!s.current && (
                        <Button variant="outline" size="sm" onClick={() => void revoke(s)} loading={busy === s.id} disabled={busy !== null}>
                          <LogOut data-icon="inline-start" />
                          Sign out
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          {others.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-border p-4">
              <p className="text-xs text-muted-foreground">Signing out here ends that session at once.</p>
              <Button variant="outline" size="sm" onClick={() => void revokeOthers()} loading={busy === "all"} disabled={busy !== null}>
                Sign out everywhere else
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ── Recent security activity ─────────────────────────────────────────────────

export function SecurityLogCard({ events }: { events: ApiSecurityEvent[] }) {
  const [open, setOpen] = useState(false);
  const [onlyConcerning, setOnlyConcerning] = useState(false);
  const concerning = events.filter((e) => CONCERNING.has(e.type));
  const shown = onlyConcerning ? concerning : events;
  const groups = useMemo(() => byDay(shown, (e) => e.at), [shown]);
  const latest = events[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent security activity</CardTitle>
        <CardDescription>Sign-ins and changes to your password, tokens and two-step verification. If you don’t recognise something, change your password and sign out other browsers.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 text-sm">
          {!latest ? (
            <p className="text-muted-foreground">Nothing recorded yet.</p>
          ) : (
            <>
              <p className="flex items-center gap-2 font-medium">
                {concerning.length > 0 ? <ShieldAlert className="size-4 text-destructive" aria-hidden /> : <ShieldCheck className="size-4 text-muted-foreground" aria-hidden />}
                {concerning.length > 0 ? `${concerning.length} ${concerning.length === 1 ? "thing" : "things"} to check` : "Nothing unusual"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground" suppressHydrationWarning>
                Latest: {EVENT_LABEL[latest.type] ?? latest.type}, {timeAgo(latest.at)}.
              </p>
            </>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)} disabled={events.length === 0}>
          View all activity
        </Button>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex flex-col gap-0 overflow-hidden p-0 sm:max-w-xl" style={DIALOG_BOUNDS}>
          <DialogHeader className="border-b border-border p-5 pb-4">
            <DialogTitle>Recent security activity</DialogTitle>
            <DialogDescription>The latest {events.length} events on your account, newest first. If you don’t recognise something, change your password and sign out other browsers.</DialogDescription>
            <div role="group" aria-label="Show" className="mt-3 inline-flex w-fit border border-border text-xs">
              {[
                { on: false, label: `All (${events.length})` },
                { on: true, label: `Needs a look (${concerning.length})` },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  aria-pressed={onlyConcerning === o.on}
                  onClick={() => setOnlyConcerning(o.on)}
                  className={cn("px-3 py-1.5 transition-colors", onlyConcerning === o.on ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-3 pt-4" style={{ overflowY: "auto", overscrollBehavior: "contain" }}>
            {groups.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing to look at. Failed sign-ins and protections switched off would show here.</p>
            ) : (
              groups.map((g) => (
                <section key={g.label}>
                  <DayHeading>{g.label}</DayHeading>
                  <ul className="divide-y divide-border">
                    {g.items.map((e) => (
                      <li key={e.id} className="flex items-baseline justify-between gap-4 py-3 text-sm">
                        <div className="min-w-0">
                          <p className={CONCERNING.has(e.type) ? "font-medium text-destructive" : "font-medium"}>{EVENT_LABEL[e.type] ?? e.type}</p>
                          <p className="text-xs text-muted-foreground">{[e.detail, e.userAgent ? device(e.userAgent) : null, e.ip].filter(Boolean).join(" · ")}</p>
                        </div>
                        <time dateTime={e.at} className="shrink-0 text-xs tabular-nums text-muted-foreground" title={new Date(e.at).toLocaleString()} suppressHydrationWarning>
                          {clock(e.at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
