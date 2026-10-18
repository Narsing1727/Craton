"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Link2, Trash2 } from "lucide-react";
import { notify } from "@/components/button-status";
import { ConfirmAction, CopyButton } from "@/components/craton-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createShareLinkAction, revokeShareLinkAction } from "@/app/actions";
import type { ApiShareLink } from "@/lib/api";
import { timeAgo } from "@/lib/format";

const dayLabel = (d: number) => (d === 1 ? "1 day" : `${d} days`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function SharingView({ owner, repo, defaultBranch, branches, choices, initial }: { owner: string; repo: string; defaultBranch: string; branches: string[]; choices: number[]; initial: ApiShareLink[] }) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [days, setDays] = React.useState(String(choices.includes(7) ? 7 : choices[0]));
  const [ref, setRef] = React.useState(defaultBranch);
  const [note, setNote] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [fresh, setFresh] = React.useState<{ url: string; expiresAt: string } | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    const r = await createShareLinkAction(owner, repo, { expiresInDays: Number(days), note: note.trim(), ref });
    setPending(false);
    if (!r.ok) return void notify.error("Couldn’t make the link", { description: r.error });
    setFresh({ url: r.data.url, expiresAt: r.data.expiresAt });
    setNote("");
    router.refresh();
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="pb-2">
          <h1 className="text-3xl font-semibold tracking-tight">Sharing</h1>
          <p className="mt-2 text-base text-muted-foreground">Send someone a link to a snapshot of this repository. They can look at the files and download them without a Craton account.</p>
        </div>

        {fresh && (
          <div className="flex flex-col gap-3 border border-border bg-muted/30 p-4" role="status">
            <p className="text-sm font-medium">Copy the link now. For safety it isn’t shown again.</p>
            <div className="flex items-center gap-2 border border-border bg-background p-2">
              <code className="min-w-0 flex-1 select-all break-all font-mono text-xs">{fresh.url}</code>
              <CopyButton value={fresh.url} label="Copy link" variant="outline" size="sm">
                Copy link
              </CopyButton>
            </div>
            <p className="text-xs text-muted-foreground">Works until {when(fresh.expiresAt)}. Anyone who has it can read this snapshot, so send it only to the people you mean to.</p>
            <Button variant="ghost" size="sm" className="self-start" onClick={() => setFresh(null)}>
              I’ve copied it
            </Button>
          </div>
        )}

        <Card>
          <form onSubmit={create}>
            <CardHeader>
              <CardTitle>Make a link</CardTitle>
              <CardDescription>It shows the repository exactly as it is now, so it never starts showing newer work by surprise. It stops working on its own, and you can switch it off any time.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel>What to share</FieldLabel>
                  <Select value={ref} onValueChange={(v) => v && setRef(String(v))}>
                    <SelectTrigger className="w-64 font-mono" aria-label="Branch to share">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {branches.map((b) => (
                          <SelectItem key={b} value={b} className="font-mono">
                            {b}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <FieldDescription>The latest version of this branch, frozen when you make the link.</FieldDescription>
                </Field>
                <Field>
                  <FieldLabel>Works for</FieldLabel>
                  <Select value={days} onValueChange={(v) => v && setDays(String(v))}>
                    <SelectTrigger className="w-40" aria-label="How long the link works">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {choices.map((d) => (
                          <SelectItem key={d} value={String(d)}>
                            {dayLabel(d)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="share-note">A note for yourself (optional)</FieldLabel>
                  <Input id="share-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} placeholder="For the water authority’s review" autoComplete="off" />
                  <FieldDescription>Shown to the person you share it with, and in your list below.</FieldDescription>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="border-t border-border">
              <Button type="submit" size="sm" loading={pending} disabled={pending}>
                <Link2 data-icon="inline-start" />
                Make link
              </Button>
            </CardFooter>
          </form>
        </Card>

        {initial.length === 0 ? (
          <p className="border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">No links yet. The ones you make appear here, with when they expire and how often they’ve been opened.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border border border-border bg-card">
            {initial.map((l) => (
              <LinkRow key={l.id} owner={owner} repo={repo} link={l} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function LinkRow({ owner, repo, link }: { owner: string; repo: string; link: ApiShareLink }) {
  const router = useRouter();
  const expired = !link.revokedAt && new Date(link.expiresAt).getTime() <= Date.now();
  const status = link.revokedAt ? "Revoked" : expired ? "Expired" : "Active";

  async function revoke() {
    const r = await revokeShareLinkAction(owner, repo, link.id);
    if (!r.ok) return void notify.error("Couldn’t switch the link off", { description: r.error });
    notify.info("Link switched off", { description: "It no longer opens." });
    router.refresh();
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium">{link.note || "Untitled link"}</span>
          <Badge variant={link.active ? "default" : "outline"}>{status}</Badge>
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          <span className="font-mono">{link.ref}</span> at <span className="font-mono">{link.commit.slice(0, 7)}</span> · made {timeAgo(link.createdAt)} by @{link.createdBy} ·{" "}
          {link.active ? `works until ${when(link.expiresAt)}` : link.revokedAt ? `switched off ${timeAgo(link.revokedAt)}` : `expired ${timeAgo(link.expiresAt)}`} ·{" "}
          {link.uses === 0 ? "never opened" : `opened ${link.uses} ${link.uses === 1 ? "time" : "times"}${link.lastUsedAt ? `, last ${timeAgo(link.lastUsedAt)}` : ""}`}
        </p>
      </div>
      {link.active && (
        <ConfirmAction
          trigger={
            <Button variant="outline" size="sm">
              <Trash2 data-icon="inline-start" />
              Switch off
            </Button>
          }
          title="Switch this link off?"
          description="Anyone who has it will see “this link doesn’t exist or has expired”. You can make a new one any time."
          confirmLabel="Switch off"
          onConfirm={() => void revoke()}
        />
      )}
    </li>
  );
}
