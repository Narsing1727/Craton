"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Trash2, UserPlus } from "lucide-react";
import { notify } from "@/components/button-status";
import { AppShell } from "@/components/app-shell";
import { OrgHeader } from "@/components/org-header";
import { ConfirmAction } from "@/components/craton-actions";
import { EmptyState, Initials } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Member } from "@/lib/data";
import { inviteMemberAction, removeMemberAction, setMemberRoleAction } from "@/app/actions";

export type Person = Member & { pending?: boolean };
const roleNotes: Record<Member["role"], string> = {
  Owner: "Billing, settings and every repository",
  Maintainer: "Manage repositories and teams",
  Member: "Access through their teams",
};

function RoleSelect({ value, onChange, label }: { value: Member["role"]; onChange: (r: Member["role"]) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Member["role"])}>
      <SelectTrigger size="sm" className="w-32" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        <SelectGroup>
          {(Object.keys(roleNotes) as Member["role"][]).map((r) => (
            <SelectItem key={r} value={r}>
              {r}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function PeopleView({ org, initial, live, domains }: { org: string; initial: Person[]; live: boolean; domains?: string[] }) {
  const [people, setPeople] = useState<Person[]>(initial);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState("");
  const [invite, setInvite] = useState("");
  const [role, setRole] = useState<Member["role"]>("Member");
  const [touched, setTouched] = useState(false);

  const value = invite.trim().replace(/^@/, "").toLowerCase();
  const error = !value ? "Enter a username or email." : people.some((p) => p.handle === value) ? `${value} is already a member.` : null;
  const q = query.trim().toLowerCase();
  const shown = people.filter((p) => !q || p.name.toLowerCase().includes(q) || p.handle.includes(q));
  const owners = people.filter((p) => p.role === "Owner").length;

  /** Replace the list with the server's, keeping each person's repository count. */
  function sync(members: { handle: string; name: string; role: string }[]) {
    setPeople((current) => members.map((m) => ({ handle: m.handle, name: m.name, role: m.role as Member["role"], repos: current.find((c) => c.handle === m.handle)?.repos ?? 0 })));
  }

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (error || pending) return;
    if (live) {
      setPending(true);
      const result = await inviteMemberAction(org, value, role);
      setPending(false);
      if (!result.ok) {
        notify.error(`Couldn’t add ${value}`, { description: result.error });
        return;
      }
      sync(result.data);
      notify.success(`Added ${value} to ${org}`, { description: `${role}: ${roleNotes[role].toLowerCase()}.` });
    } else {
      setPeople((p) => [...p, { handle: value, name: value, role, repos: 0, pending: true }]);
      notify.success(`Invited ${value} to ${org}`, { description: `${role}: ${roleNotes[role].toLowerCase()}.` });
    }
    setInvite("");
    setTouched(false);
  }

  async function changeRole(person: Person, next: Member["role"]) {
    if (live) {
      const result = await setMemberRoleAction(org, person.handle, next);
      if (!result.ok) {
        notify.error("Couldn’t change the role", { description: result.error });
        return;
      }
      sync(result.data);
    } else {
      setPeople((all) => all.map((x) => (x.handle === person.handle ? { ...x, role: next } : x)));
    }
    notify.success(`${person.handle} is now ${next === "Owner" ? "an" : "a"} ${next}`);
  }

  async function remove(person: Person) {
    if (live) {
      const result = await removeMemberAction(org, person.handle);
      if (!result.ok) {
        notify.error(`Couldn’t remove ${person.handle}`, { description: result.error });
        return;
      }
      sync(result.data);
      notify.success(`Removed ${person.handle} from ${org}`, {
        action: { label: "Undo", onClick: () => void inviteMemberAction(org, person.handle, person.role).then((r) => r.ok && sync(r.data)) },
      });
      return;
    }
    setPeople((p) => p.filter((x) => x.handle !== person.handle));
    notify.success(`Removed ${person.handle} from ${org}`, {
      action: { label: "Undo", onClick: () => setPeople((p) => [...p, person]) },
    });
  }

  return (
    <AppShell>
      <OrgHeader org={org} domains={domains} />
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-col gap-4 border border-border bg-card p-4">
          <div>
            <h2 className="text-sm font-semibold">Invite to {org}</h2>
            <p className="text-xs text-muted-foreground">{live ? "Add someone who already has a Craton account by their username." : "Members get access through the teams you add them to."}</p>
          </div>
          <form onSubmit={sendInvite} noValidate>
            <Field data-invalid={touched && error ? true : undefined}>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="Username or email"
                  placeholder="Username or email…"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  aria-invalid={touched && !!error}
                  autoComplete="off"
                  spellCheck={false}
                  className="max-w-xs flex-1"
                />
                <RoleSelect value={role} onChange={setRole} label="Role for invite" />
                <Button type="submit" size="sm" loading={pending} disabled={pending}>
                  <UserPlus data-icon="inline-start" />
                  {live ? "Add member" : "Send invite"}
                </Button>
              </div>
              {touched && error ? <FieldError>{error}</FieldError> : <FieldDescription>{roleNotes[role]}.</FieldDescription>}
            </Field>
          </form>
        </div>

        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold tabular-nums">
              {people.length} people <span className="font-normal text-muted-foreground">· {owners} owners</span>
            </h2>
            <InputGroup className="h-8 w-full max-w-xs">
              <InputGroupAddon>
                <Search aria-hidden />
              </InputGroupAddon>
              <InputGroupInput type="search" aria-label="Filter people" placeholder="Filter by name or username…" value={query} onChange={(e) => setQuery(e.target.value)} />
            </InputGroup>
          </div>

          {shown.length === 0 ? (
            <EmptyState icon={Search} title="No one matches" action={<Button variant="outline" size="sm" onClick={() => setQuery("")}>Clear filter</Button>} />
          ) : (
            <ul className="flex flex-col divide-y divide-border border border-border bg-card">
              {shown.map((p) => (
                <li key={p.handle} className="flex items-center gap-3 px-4 py-3">
                  <Initials name={p.handle} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      <Link href={`/${p.handle}`} className="hover:underline">{p.name}</Link>
                      <span className="text-xs font-normal text-muted-foreground">@{p.handle}</span>
                      {p.pending && <Badge variant="outline">Pending</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">{p.repos} repositories · {roleNotes[p.role]}</p>
                  </div>
                  <RoleSelect
                    value={p.role}
                    label={`Role for ${p.handle}`}
                    onChange={(r) => {
                      if (p.role === "Owner" && r !== "Owner" && owners === 1) {
                        notify.error("An organization needs at least one owner", { description: "Make someone else an owner first." });
                        return;
                      }
                      void changeRole(p, r);
                    }}
                  />
                  <ConfirmAction
                    trigger={
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.handle}`} className="text-muted-foreground hover:text-destructive" disabled={p.role === "Owner" && owners === 1}>
                        <Trash2 />
                      </Button>
                    }
                    title={`Remove ${p.handle} from ${org}?`}
                    description="They lose access to every private repository in the organization. Their commits stay in history."
                    confirmLabel="Remove member"
                    onConfirm={() => void remove(p)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
