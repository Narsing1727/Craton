"use client";

// Settings → Notifications: which emails Craton sends, one switch each, saved the moment it is flipped. Messages about the
// account itself (a password reset, a new sign-in, two-step verification changing) are listed but are not optional.

import { useState, useTransition } from "react";
import { notify } from "@/components/button-status";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { saveProfileAction } from "@/app/auth-actions";
import type { ApiUser } from "@/lib/api";

type Choices = NonNullable<ApiUser["notify"]>;

const ROWS: { key: keyof Choices; title: string; about: string }[] = [
  { key: "review_requests", title: "Review requests", about: "Someone asks you to review a pull request, or CODEOWNERS names you for a change." },
  { key: "checks_failed", title: "Failed checks on your pushes", about: "A check fails on a commit you pushed, with what failed and a link to it." },
  { key: "repo_access", title: "Repositories shared with you", about: "Someone gives you access to a repository." },
  { key: "webhook_paused", title: "Webhooks paused", about: "A webhook on a repository you administer is paused after repeated failed deliveries." },
  { key: "storage", title: "Storage nearly full", about: "An account you own reaches most of its storage allowance." },
];

const ALWAYS = ["A new browser signs in to your account", "Two-step verification is turned on or off", "A password reset or email confirmation you asked for", "Your account is deleted"];

export function NotificationsView({ email, emailVerified, digest, choices, live }: { email: string; emailVerified: boolean; digest: "off" | "weekly"; choices: Choices; live: boolean }) {
  return (
    <div className="flex flex-col gap-8">
      <div>
        <h2 className="text-3xl font-semibold tracking-tight">Notifications</h2>
        <p className="mt-2 text-base text-muted-foreground">Which emails Craton sends to {email}.</p>
      </div>
      <div className="flex flex-col gap-4">
        <EmailChoices initial={choices} live={live} />
        <Weekly email={email} emailVerified={emailVerified} digest={digest} live={live} />
        <Card>
          <CardHeader>
            <CardTitle>Always sent</CardTitle>
            <CardDescription>These protect your account, so they cannot be turned off.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              {ALWAYS.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="mt-2 size-1 shrink-0 bg-muted-foreground" />
                  {line}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function EmailChoices({ initial, live }: { initial: Choices; live: boolean }) {
  const [choices, setChoices] = useState(initial);
  const [saving, startSave] = useTransition();
  function change(key: keyof Choices, on: boolean) {
    if (!live) return void notify.info("Demo mode: nothing is saved.");
    const before = choices;
    setChoices({ ...choices, [key]: on });
    startSave(async () => {
      const result = await saveProfileAction({ notify: { [key]: on } });
      if (!result.ok) {
        setChoices(before);
        notify.error("Couldn’t change that", { description: result.error });
      }
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Email me when</CardTitle>
        <CardDescription>Everything is on until you switch it off. What needs your attention is always in your inbox, whatever you choose here.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        {ROWS.map((row) => (
          <label key={row.key} className="flex cursor-pointer items-center justify-between gap-6 py-3 first:pt-0 last:pb-0">
            <span className="text-sm">
              <span className="block font-medium">{row.title}</span>
              <span className="mt-0.5 block text-muted-foreground">{row.about}</span>
            </span>
            <Switch checked={choices[row.key]} onCheckedChange={(v) => change(row.key, Boolean(v))} disabled={saving} aria-label={row.title} />
          </label>
        ))}
      </CardContent>
    </Card>
  );
}

/** The weekly email summary: off unless switched on here; the first one comes a week later. */
function Weekly({ email, emailVerified, digest, live }: { email: string; emailVerified: boolean; digest: "off" | "weekly"; live: boolean }) {
  const [on, setOn] = useState(digest === "weekly");
  const [saving, startSave] = useTransition();
  function change(next: boolean) {
    if (!live) return void notify.info("Demo mode: nothing is saved.");
    startSave(async () => {
      const result = await saveProfileAction({ digest: next ? "weekly" : "off" });
      if (!result.ok) return void notify.error("Couldn’t change that", { description: result.error });
      setOn(next);
      notify.success(next ? "You’ll get a weekly summary" : "Weekly summary turned off");
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly summary</CardTitle>
        <CardDescription>One email a week with what is still unread in your inbox, and nothing when there is nothing. The first comes a week after you turn it on, and every message has a one-click unsubscribe.</CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-center justify-between gap-4">
          <span className="text-sm">
            Email {email} a weekly summary
            {!emailVerified && <span className="mt-0.5 block text-xs text-muted-foreground">Only a confirmed address receives it. Confirm yours first.</span>}
          </span>
          <Switch checked={on} onCheckedChange={(v) => change(Boolean(v))} disabled={saving} aria-label="Email me a weekly summary" />
        </label>
      </CardContent>
    </Card>
  );
}
