"use client";

import { use, useState } from "react";
import { Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { RepoHeader } from "@/components/repo-header";
import { RepoSettingsNav } from "@/components/repo-settings-nav";
import { ConfirmAction } from "@/components/craton-actions";
import { Initials } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Role = "Admin" | "Write" | "Triage" | "Read";
type Person = { handle: string; name: string; role: Role; isOwner?: boolean; pending?: boolean };

const roleNotes: Record<Role, string> = {
  Admin: "Everything, including settings and deletion",
  Write: "Push, open and merge pull requests",
  Triage: "Manage issues and pull requests, no pushes",
  Read: "Clone, pull and comment",
};

function RoleSelect({ value, onChange, label }: { value: Role; onChange: (r: Role) => void; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Role)}>
      <SelectTrigger size="sm" className="w-28" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="w-64">
        <SelectGroup>
          {(Object.keys(roleNotes) as Role[]).map((r) => (
            <SelectItem key={r} value={r} title={roleNotes[r]}>
              {r}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export default function RepoCollaboratorsPage({ params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = use(params);
  const base = `/${owner}/${repo}`;
  const [people, setPeople] = useState<Person[]>([
    { handle: "priyam", name: "Priya Menon", role: "Admin", isOwner: true },
    { handle: "arunn", name: "Arun Nair", role: "Write" },
    { handle: "sarat", name: "Sara Thomas", role: "Write" },
    { handle: "vikramr", name: "Vikram Rao", role: "Read" },
  ]);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<Role>("Write");
  const [touched, setTouched] = useState(false);

  const value = handle.trim().replace(/^@/, "").toLowerCase();
  const error = !value
    ? "Enter a username or email."
    : people.some((p) => p.handle === value)
      ? `${value} already has access.`
      : null;

  function invite(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (error) return;
    setPeople((p) => [...p, { handle: value, name: value, role, pending: true }]);
    toast.success(`Invited ${value}`, { description: `${role} access once they accept.` });
    setHandle("");
    setTouched(false);
  }

  function remove(person: Person) {
    setPeople((p) => p.filter((x) => x.handle !== person.handle));
    toast.success(`Removed ${person.handle}`, {
      action: { label: "Undo", onClick: () => setPeople((p) => [...p, person]) },
    });
  }

  return (
    <AppShell>
      <RepoHeader owner={owner} repo={repo} />
      <div className="grid grid-cols-1 w-full gap-8 px-4 sm:px-6 lg:px-8 xl:px-10 py-6 md:grid-cols-[220px_1fr]">
        <RepoSettingsNav base={base} active="collaborators" />

        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          <div className="border-b border-border pb-3">
            <h1 className="text-xl font-semibold">Collaborators</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">People with direct access. Organization members also inherit their team’s access.</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Invite someone</CardTitle>
              <CardDescription>They’ll get an email and appear here as pending until they accept.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={invite} noValidate>
                <Field data-invalid={touched && error ? true : undefined}>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="Username or email"
                      placeholder="Username or email…"
                      value={handle}
                      onChange={(e) => setHandle(e.target.value)}
                      aria-invalid={touched && !!error}
                      autoComplete="off"
                      spellCheck={false}
                      className="max-w-xs flex-1"
                    />
                    <RoleSelect value={role} onChange={setRole} label="Role for invite" />
                    <Button type="submit" size="sm">
                      <UserPlus data-icon="inline-start" />
                      Invite
                    </Button>
                  </div>
                  {touched && error ? <FieldError>{error}</FieldError> : <FieldDescription>{roleNotes[role]}.</FieldDescription>}
                </Field>
              </form>
            </CardContent>
          </Card>

          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-medium text-muted-foreground tabular-nums">{people.length} people with access</h2>
            <ul className="flex flex-col divide-y divide-border border border-border bg-card">
              {people.map((p) => (
                <li key={p.handle} className="flex items-center gap-3 px-4 py-3">
                  <Initials name={p.handle} className="size-8" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 text-sm font-medium">
                      {p.name}
                      <span className="text-xs font-normal text-muted-foreground">@{p.handle}</span>
                      {p.isOwner && <Badge variant="secondary">Owner</Badge>}
                      {p.pending && <Badge variant="outline">Pending</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">{roleNotes[p.role]}</p>
                  </div>
                  {p.isOwner ? (
                    <Badge variant="outline">{p.role}</Badge>
                  ) : (
                    <>
                      <RoleSelect
                        value={p.role}
                        label={`Role for ${p.handle}`}
                        onChange={(r) => {
                          setPeople((all) => all.map((x) => (x.handle === p.handle ? { ...x, role: r } : x)));
                          toast.success(`${p.handle} now has ${r} access`);
                        }}
                      />
                      <ConfirmAction
                        trigger={
                          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.handle}`} className="text-muted-foreground hover:text-destructive">
                            <Trash2 />
                          </Button>
                        }
                        title={`Remove ${p.handle}?`}
                        description={`${p.name} loses access to ${owner}/${repo} immediately. Their commits stay in history.`}
                        confirmLabel="Remove"
                        onConfirm={() => remove(p)}
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
