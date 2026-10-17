"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Send, Trash2 } from "lucide-react";
import { notify } from "@/components/button-status";
import { ConfirmAction, CopyButton } from "@/components/craton-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { createWebhookAction, deleteWebhookAction, deliveriesAction, pingWebhookAction, redeliverAction, updateWebhookAction } from "@/app/actions";
import type { ApiDelivery, ApiWebhook } from "@/lib/api";
import { timeAgo } from "@/lib/format";

const EVENT_LABELS: Record<string, string> = {
  push: "Push",
  pull_request: "Pull request opened, merged or closed",
  release: "Release published",
  issue: "Issue opened, closed or reopened",
  lock: "File locked or unlocked",
};

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

// headers: webhook-id, webhook-timestamp, webhook-signature. body: the raw request body.
export function verify(secret, headers, body) {
  const age = Math.abs(Date.now() / 1000 - Number(headers["webhook-timestamp"]));
  if (age > 300) return false; // reject old deliveries (replays)
  const key = Buffer.from(secret.replace("whsec_", ""), "base64");
  const signed = headers["webhook-id"] + "." + headers["webhook-timestamp"] + "." + body;
  const expected = "v1," + createHmac("sha256", key).update(signed).digest("base64");
  return String(headers["webhook-signature"]).split(" ").some((s) => {
    const a = Buffer.from(s), b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}`;

export type RecentDelivery = { status: "pending" | "succeeded" | "failed"; code: number | null; event: string; at: string };

export function WebhooksView({ owner, repo, events, initial, recent = {} }: { owner: string; repo: string; events: string[]; initial: ApiWebhook[]; recent?: Record<number, RecentDelivery[]> }) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [url, setUrl] = React.useState("");
  const [chosen, setChosen] = React.useState<string[]>(["push"]);
  const [pending, setPending] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [secret, setSecret] = React.useState<string | null>(null);

  // The API decides what is allowed (https only, no private addresses) and says so in its error.
  const urlError = !/^https?:\/\/[^\s/]+/i.test(url.trim()) ? "Enter a full URL, like https://example.org/hooks/craton." : null;
  const eventError = chosen.length === 0 ? "Choose at least one event." : null;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (urlError || eventError || pending) return;
    setPending(true);
    const r = await createWebhookAction(owner, repo, { url: url.trim(), events: chosen });
    setPending(false);
    if (!r.ok) {
      notify.error("Couldn’t add the webhook", { description: r.error });
      return;
    }
    setSecret(r.data.secret);
    setUrl("");
    setTouched(false);
    notify.success("Webhook added", { description: "A test event is on its way." });
    router.refresh();
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="pb-2">
          <h1 className="text-3xl font-semibold tracking-tight">Webhooks</h1>
          <p className="mt-2 text-base text-muted-foreground">Craton sends a signed HTTPS POST to your server when something happens here, and retries if it can’t get through.</p>
        </div>

        {secret && (
          <div className="flex flex-col gap-3 border border-border bg-muted/30 p-4" role="status">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Copy the signing secret now. It isn’t shown again.</p>
              <CopyButton value={secret} label="Copy secret" variant="outline" size="sm">
                Copy secret
              </CopyButton>
            </div>
            <code className="select-all break-all border border-border bg-background px-2 py-1.5 font-mono text-xs">{secret}</code>
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">How to verify a delivery</summary>
              <p className="mt-2 text-muted-foreground">
                Each request carries <code className="font-mono text-xs">webhook-id</code>, <code className="font-mono text-xs">webhook-timestamp</code> and{" "}
                <code className="font-mono text-xs">webhook-signature</code> (the <a className="underline" href="https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md">Standard Webhooks</a> scheme). Sign the raw body, compare in constant time, and reject old timestamps.
              </p>
              <pre className="mt-2 max-h-72 overflow-auto border border-border bg-background p-3 font-mono text-xs">{VERIFY_SNIPPET}</pre>
            </details>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setSecret(null)}>
              I’ve saved it
            </Button>
          </div>
        )}

        <Card>
          <form onSubmit={create} noValidate>
            <CardHeader>
              <CardTitle>Add a webhook</CardTitle>
              <CardDescription>The URL must be public and use https. Craton won’t send to private or internal addresses.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field data-invalid={touched && urlError ? true : undefined}>
                  <FieldLabel htmlFor="hook-url">Payload URL</FieldLabel>
                  <Input id="hook-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.org/hooks/craton" autoComplete="off" spellCheck={false} aria-invalid={touched && !!urlError} />
                  {touched && urlError && <FieldError>{urlError}</FieldError>}
                </Field>
                <Field data-invalid={touched && eventError ? true : undefined}>
                  <FieldLabel>Events</FieldLabel>
                  <div className="flex flex-col gap-2">
                    {events.map((ev) => (
                      <label key={ev} htmlFor={`ev-${ev}`} className="flex cursor-pointer items-center gap-2.5 text-sm">
                        <Checkbox id={`ev-${ev}`} checked={chosen.includes(ev)} onCheckedChange={(v) => setChosen((cur) => (v ? [...cur, ev] : cur.filter((x) => x !== ev)))} />
                        <span>
                          <span className="font-mono text-xs">{ev}</span>
                          <span className="text-muted-foreground"> · {EVENT_LABELS[ev] ?? ev}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {touched && eventError && <FieldError>{eventError}</FieldError>}
                  <FieldDescription>A test (“ping”) event is always sent when you add a webhook.</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="border-t border-border">
              <Button type="submit" size="sm" loading={pending} disabled={pending}>
                Add webhook
              </Button>
            </CardFooter>
          </form>
        </Card>

        {initial.length === 0 ? (
          <p className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No webhooks yet. Add one above to get a signed POST when someone pushes, opens a pull request, publishes a release, opens or closes an issue, or locks a file.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {initial.map((h) => (
              <HookRow key={h.id} owner={owner} repo={repo} hook={h} recent={recent[h.id] ?? []} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "succeeded" ? "text-chart-1" : status === "failed" ? "text-destructive" : "text-muted-foreground";
  return (
    <Badge variant="outline" className={`capitalize ${tone}`}>
      {status === "succeeded" ? "Delivered" : status === "pending" ? "Retrying" : status}
    </Badge>
  );
}

/** The last ten deliveries as small marks, newest at the left, with the same facts in words for everyone. */
function RecentStrip({ deliveries }: { deliveries: RecentDelivery[] }) {
  if (deliveries.length === 0) return null;
  const ok = deliveries.filter((d) => d.status === "succeeded").length;
  const failed = deliveries.filter((d) => d.status === "failed").length;
  const summary = `${ok} of the last ${deliveries.length} delivered${failed ? `, ${failed} failed` : ""}`;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <span className="flex gap-0.5" role="img" aria-label={summary}>
        {deliveries.map((d, i) => (
          <span
            key={i}
            title={`${d.event}: ${d.status === "succeeded" ? "delivered" : d.status === "pending" ? "retrying" : "failed"}${d.code ? ` (${d.code})` : ""}, ${timeAgo(d.at)}`}
            className={`h-3 w-1.5 ${d.status === "succeeded" ? "bg-chart-1" : d.status === "failed" ? "bg-destructive" : "bg-muted-foreground/50"}`}
          />
        ))}
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">{summary}</span>
    </div>
  );
}

function HookRow({ owner, repo, hook, recent }: { owner: string; repo: string; hook: ApiWebhook; recent: RecentDelivery[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [deliveries, setDeliveries] = React.useState<ApiDelivery[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [active, setActive] = React.useState(hook.active);

  const load = React.useCallback(async () => {
    const r = await deliveriesAction(owner, repo, hook.id);
    if (r.ok) setDeliveries(r.deliveries);
    else setError(r.error);
  }, [owner, repo, hook.id]);

  React.useEffect(() => {
    if (open && !deliveries && !error) void load();
  }, [open, deliveries, error, load]);

  async function toggle(next: boolean) {
    setActive(next);
    const r = await updateWebhookAction(owner, repo, hook.id, { active: next });
    if (!r.ok) {
      setActive(!next);
      notify.error("Couldn’t update the webhook", { description: r.error });
    }
  }

  async function test() {
    const r = await pingWebhookAction(owner, repo, hook.id);
    if (!r.ok) return void notify.error("Couldn’t send the test", { description: r.error });
    notify.success("Test event sent");
    if (open) window.setTimeout(() => void load(), 1200);
  }

  async function replay(id: number) {
    const r = await redeliverAction(owner, repo, hook.id, id);
    if (!r.ok) return void notify.error("Couldn’t resend", { description: r.error });
    notify.success("Resending");
    window.setTimeout(() => void load(), 1200);
  }

  async function remove() {
    const r = await deleteWebhookAction(owner, repo, hook.id);
    if (!r.ok) return void notify.error("Couldn’t delete the webhook", { description: r.error });
    notify.info("Webhook deleted");
    router.refresh();
  }

  return (
    <li className="border border-border bg-card">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm">{hook.url}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {hook.events.map((ev) => (
              <Badge key={ev} variant="outline" className="font-mono">
                {ev}
              </Badge>
            ))}
            {hook.lastDelivery ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <StatusBadge status={hook.lastDelivery.status} /> {timeAgo(hook.lastDelivery.at)}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground">Nothing sent yet</span>
            )}
          </div>
          <RecentStrip deliveries={recent} />
          {!active && hook.pausedReason && <p className="mt-1.5 text-xs text-destructive text-pretty">{hook.pausedReason} Resume it once the receiver works.</p>}
        </div>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={active} onCheckedChange={(v) => void toggle(Boolean(v))} aria-label={active ? "Pause this webhook" : "Resume this webhook"} />
          {active ? "Active" : "Paused"}
        </label>
        <Button variant="outline" size="sm" onClick={() => void test()}>
          <Send data-icon="inline-start" />
          Send test
        </Button>
        <ConfirmAction
          trigger={
            <Button variant="ghost" size="icon-sm" aria-label="Delete webhook">
              <Trash2 />
            </Button>
          }
          title="Delete this webhook?"
          description="Nothing more will be sent to this URL, and its delivery log is removed."
          confirmLabel="Delete webhook"
          onConfirm={() => void remove()}
        />
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 border-t border-border px-4 py-2 text-left text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground">
        <ChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
        Recent deliveries
      </button>
      {open && (
        <div className="border-t border-border">
          {error ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{error}</p>
          ) : !deliveries ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
          ) : deliveries.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">Nothing has been sent yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {deliveries.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <StatusBadge status={d.status} />
                  <span className="font-mono text-xs">{d.event}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {d.attempts} {d.attempts === 1 ? "attempt" : "attempts"}
                    {d.responseCode ? ` · HTTP ${d.responseCode}` : ""}
                  </span>
                  <span className="text-xs text-muted-foreground">{timeAgo(d.createdAt)}</span>
                  {d.error && d.status !== "succeeded" && <span className="w-full text-xs text-muted-foreground sm:w-auto sm:flex-1 sm:truncate">{d.error}</span>}
                  <Button variant="ghost" size="xs" className="ml-auto" onClick={() => void replay(d.id)}>
                    Resend
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}
