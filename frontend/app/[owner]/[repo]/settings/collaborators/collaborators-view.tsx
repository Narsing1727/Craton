"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/button-status";
import { ConfirmAction } from "@/components/craton-actions";
import { Initials } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inviteByEmailAction, removeCollaboratorAction, revokeInviteAction, setCollaboratorAction } from "@/app/actions";
import type { ApiCollaborator, ApiInvite } from "@/lib/api";
import { timeAgo } from "@/lib/format";

type Role = ApiCollaborator["role"];
const ROLES: { value: Role; about: string }[] = [
  { value: "Read", about: "Look at files and history, download, open issues and comment." },
  { value: "Write", about: "Also push and merge, manage issues, upload files and lock files." },
  { value: "Admin", about: "Also change settings and decide who else has access." },
];

export function CollaboratorsView({ owner, repo, initial, invites: initialInvites = [], isAdmin }: { owner: string; repo: string; initial: ApiCollaborator[]; invites?: ApiInvite[]; isAdmin: boolean }) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [people, setPeople] = React.useState(initial);
  const [invites, setInvites] = React.useState(initialInvites);
  const [handle, setHandle] = React.useState("");
  const [role, setRole] = React.useState<Role>("Write");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    if (!handle.trim()) return void setError("Type a username, or an email address to invite someone who has no account yet.");
    setPending(true);
    setError(null);
    if (handle.includes("@") && !handle.trim().startsWith("@")) {
      const sent = await inviteByEmailAction(owner, repo, handle.trim(), role);
      setPending(false);
      if (!sent.ok) return void setError(sent.error);
      if (sent.data.added) {
        notify.success(`${sent.data.handle} already had an account and now has access`, { description: "They were told by email." });
      } else if (sent.data.invite) {
        const inv = sent.data.invite;
        setInvites((cur) => [{ id: inv.id, email: inv.email, role: inv.role as Role, invitedBy: "you", createdAt: new Date().toISOString(), expiresAt: inv.expiresAt }, ...cur.filter((x) => x.email.toLowerCase() !== inv.email.toLowerCase())]);
        notify.success(`Invitation sent to ${inv.email}`, { description: "The link works once and expires in 14 days." });
      }
      setHandle("");
      router.refresh();
      return;
    }
    const r = await setCollaboratorAction(owner, repo, handle, role);
    setPending(false);
    if (!r.ok) return void setError(r.error);
    setPeople(r.data);
    notify.success(`${handle.replace(/^@/, "").trim()} can now ${role === "Read" ? "read" : role === "Write" ? "write to" : "administer"} this repository`, { description: "They were told by email." });
    setHandle("");
    router.refresh();
  }

  async function change(p: ApiCollaborator, next: Role) {
    if (next === p.role) return;
    const before = people;
    setPeople(people.map((x) => (x.handle === p.handle ? { ...x, role: next } : x)));
    const r = await setCollaboratorAction(owner, repo, p.handle, next);
    if (!r.ok) {
      setPeople(before);
      return void notify.error("Couldn’t change the role", { description: r.error });
    }
    setPeople(r.data);
    notify.success(`${p.handle} is now ${next}`);
  }

  async function remove(p: ApiCollaborator) {
    const r = await removeCollaboratorAction(owner, repo, p.handle);
    if (!r.ok) return void notify.error("Couldn’t remove them", { description: r.error });
    setPeople(r.data);
    notify.success(`${p.handle} no longer has access`);
    router.refresh();
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="pb-2">
          <h1 className="text-3xl font-semibold tracking-tight">Collaborators</h1>
          <p className="mt-2 text-base text-muted-foreground">People who can work on this repository without belonging to {owner}. Their access applies to this repository only.</p>
        </div>

        {isAdmin && (
          <Card>
            <form onSubmit={add} noValidate>
              <CardHeader>
                <CardTitle>Add a person</CardTitle>
                <CardDescription>A username gives access straight away. An email address with no account behind it gets a one-time invitation link. You need a confirmed email address yourself.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="collab-handle">Username or email address</FieldLabel>
                    <Input id="collab-handle" value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="their-username, or name@example.org" autoComplete="off" spellCheck={false} className="max-w-xs font-mono" aria-invalid={error ? true : undefined} />
                  </Field>
                  <Field>
                    <FieldLabel>Role</FieldLabel>
                    <Select value={role} onValueChange={(v) => v && setRole(v as Role)}>
                      <SelectTrigger className="w-40" aria-label="Role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.value}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>{ROLES.find((r) => r.value === role)?.about}</FieldDescription>
                  </Field>
                </FieldGroup>
                {error && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    {error}
                  </p>
                )}
              </CardContent>
              <CardFooter>
                <Button type="submit" loading={pending} disabled={pending}>
                  Add collaborator
                </Button>
              </CardFooter>
            </form>
          </Card>
        )}

        {isAdmin && invites.length > 0 && (
          <section aria-labelledby="invites-heading" className="flex flex-col gap-2">
            <h2 id="invites-heading" className="text-sm font-medium">Waiting for a reply</h2>
            <ul className="flex flex-col divide-y divide-border border border-border bg-card">
              {invites.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{i.email}</p>
                    <p className="text-xs text-muted-foreground">{i.role} · invited {timeAgo(i.createdAt)} · link expires {new Date(i.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</p>
                  </div>
                  <ConfirmAction
                    trigger={<Button variant="ghost" size="sm" aria-label={`Withdraw the invitation to ${i.email}`}>Withdraw</Button>}
                    title={`Withdraw the invitation to ${i.email}?`}
                    description="The link in their email stops working."
                    confirmLabel="Withdraw"
                    onConfirm={async () => {
                      const r = await revokeInviteAction(owner, repo, i.id);
                      if (!r.ok) return void notify.error("Couldn’t withdraw it", { description: r.error });
                      setInvites((cur) => cur.filter((x) => x.id !== i.id));
                    }}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="who-heading" className="flex flex-col gap-2">
          <h2 id="who-heading" className="text-sm font-medium">
            Who has access
          </h2>
          <ul className="flex flex-col divide-y divide-border border border-border bg-card">
            <li className="flex items-center gap-3 px-4 py-3">
              <Initials name={owner} className="size-7" />
              <span className="min-w-0 flex-1 text-sm font-medium">{owner}</span>
              <span className="text-xs text-muted-foreground">Owner</span>
            </li>
            {people.map((p) => (
              <li key={p.handle} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Initials name={p.name || p.handle} className="size-7" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{p.handle}</p>
                  {p.name && p.name !== p.handle && <p className="truncate text-xs text-muted-foreground">{p.name}</p>}
                </div>
                {isAdmin ? (
                  <>
                    <Select value={p.role} onValueChange={(v) => v && void change(p, v as Role)}>
                      <SelectTrigger size="sm" className="w-28" aria-label={`Role of ${p.handle}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {ROLES.map((r) => (
                            <SelectItem key={r.value} value={r.value}>
                              {r.value}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <ConfirmAction
                      trigger={
                        <Button variant="ghost" size="sm" aria-label={`Remove ${p.handle}`}>
                          Remove
                        </Button>
                      }
                      title={`Remove ${p.handle}?`}
                      description="They lose access to this repository now, and any file locks they hold are released."
                      confirmLabel="Remove"
                      onConfirm={() => remove(p)}
                    />
                  </>
                ) : (
                  <span className="text-xs text-muted-foreground">{p.role}</span>
                )}
              </li>
            ))}
            {people.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No one else yet.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}
