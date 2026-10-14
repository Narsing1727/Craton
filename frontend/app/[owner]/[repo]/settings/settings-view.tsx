"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Lock, Trash2 } from "lucide-react";
import { notify } from "@/components/button-status";
import { ConfirmAction, TypeToConfirm } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Repo } from "@/lib/data";
import { deleteRepoAction, unlockFileAction, updateRepoAction } from "@/app/actions";
import type { ApiLock } from "@/lib/api";
import { CodeOwnersCard } from "@/components/code-owners-card";

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const TOPIC = /^[a-z0-9][a-z0-9-]{0,29}$/;
const NO_LICENSE = "__none";

/** The same normalisation the API applies: lowercase, spaces to dashes, no repeats. */
function parseTopics(text: string) {
  const out: string[] = [];
  for (const raw of text.split(",")) {
    const t = raw.trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export type RepoSettings = {
  requireChecks: boolean;
  requireReview: boolean;
  requireOwnerReview: boolean;
  crs: string;
  verticalDatum: number | null;
  nodata: number | null;
};

export function RepoSettingsView({
  owner,
  repo,
  repoData,
  branches,
  settings,
  licenses,
  live,
  locks = [],
  codeOwners,
}: {
  owner: string;
  repo: string;
  repoData: Repo;
  branches: string[];
  settings: RepoSettings;
  licenses: { id: string; name: string }[];
  live: boolean;
  /** File locks held in this repository, oldest first. */
  locks?: ApiLock[];
  codeOwners?: { text: string; branch: string; head?: string };
}) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;

  const [repoName, setRepoName] = useState(repo);
  const [description, setDescription] = useState(repoData.description);
  const [defaultBranch, setDefaultBranch] = useState(repoData.defaultBranch || "main");
  const [visibility, setVisibility] = useState<"public" | "private">(repoData.visibility);
  const [transferTo, setTransferTo] = useState("deltares");
  const [protection, setProtection] = useState({ checks: settings.requireChecks, review: settings.requireReview, owners: settings.requireOwnerReview, stale: live });
  const [crs, setCrs] = useState(settings.crs);
  const [datum, setDatum] = useState(settings.verticalDatum === null ? "" : String(settings.verticalDatum));
  const [nodata, setNodata] = useState(settings.nodata === null ? "" : String(settings.nodata));
  const [heldLocks, setHeldLocks] = useState(locks);
  const [lockText, setLockText] = useState((repoData.lockPatterns ?? []).join("\n"));
  const [savedLock, setSavedLock] = useState((repoData.lockPatterns ?? []).join("\n"));
  const [license, setLicense] = useState(repoData.license ?? "");
  const [topicsText, setTopicsText] = useState((repoData.topics ?? []).join(", "));
  const [saved, setSaved] = useState({ description: repoData.description, defaultBranch: repoData.defaultBranch || "main", license: repoData.license ?? "", topics: (repoData.topics ?? []).join(", "), crs: settings.crs, datum, nodata });
  const topics = parseTopics(topicsText);
  const topicsError = topics.length > 10 ? "Use at most ten topics." : topics.find((t) => !TOPIC.test(t)) ? `“${topics.find((t) => !TOPIC.test(t))}” isn’t valid. Use lowercase letters, numbers and dashes.` : null;

  const nameError = !NAME.test(repoName.trim()) ? "Use lowercase letters, numbers, dots, dashes or underscores." : null;
  const nameChanged = repoName.trim() !== repo;
  const detailsChanged = description !== saved.description || defaultBranch !== saved.defaultBranch || license !== saved.license || topics.join(", ") !== parseTopics(saved.topics).join(", ");
  const crsError = !/^EPSG:\d{4,6}$/.test(crs.trim()) ? "Use an EPSG code, e.g. EPSG:32643." : null;
  const datumError = datum.trim() && !/^\d{4,6}$/.test(datum.trim()) ? "Use a vertical EPSG code, e.g. 3855, or leave empty." : null;
  const nodataError = nodata.trim() && Number.isNaN(Number(nodata)) ? "Use a number, e.g. -9999, or leave empty." : null;
  const checksChanged = crs !== saved.crs || datum !== saved.datum || nodata !== saved.nodata;

  /** PATCH the repository; returns false (and says why) when the API refuses. */
  async function save(patch: Parameters<typeof updateRepoAction>[2], success: string, description?: string) {
    if (live) {
      const result = await updateRepoAction(owner, repo, patch);
      if (!result.ok) {
        notify.error("Couldn’t save", { description: result.error });
        return false;
      }
      router.refresh();
    }
    notify.success(success, description ? { description } : undefined);
    return true;
  }

  return (
    <>
      <div className="min-w-0">
        <div className="flex min-w-0 max-w-3xl flex-col gap-6">
          <div className="pb-2">
            <h1 className="text-3xl font-semibold tracking-tight">General</h1>
            <p className="mt-2 text-base text-muted-foreground">Name, description, default branch and protection rules.</p>
          </div>

          <Card>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (nameError || !nameChanged) return;
                const next = repoName.trim();
                if (await save({ name: next }, `Renamed to ${owner}/${next}`, live ? `Point clones at it with: craton remote add origin http://localhost:4000/${owner}/${next}` : "Old links and clones redirect automatically.")) {
                  if (live) router.push(`/${owner}/${next}/settings`);
                }
              }}
            >
              <CardHeader>
                <CardTitle>Repository name</CardTitle>
                <CardDescription>{live ? "Links and clones use the new name from now on." : "Web links and existing clones redirect to the new name."}</CardDescription>
              </CardHeader>
              <CardContent>
                <Field data-invalid={nameError ? true : undefined}>
                  <FieldLabel htmlFor="repo-name" className="sr-only">Repository name</FieldLabel>
                  <div className="flex max-w-md items-center gap-2">
                    <span className="font-mono text-sm text-muted-foreground">{owner}/</span>
                    <Input
                      id="repo-name"
                      value={repoName}
                      onChange={(e) => setRepoName(e.target.value)}
                      aria-invalid={!!nameError}
                      spellCheck={false}
                      autoComplete="off"
                      className="font-mono"
                    />
                  </div>
                  {nameError && <FieldError>{nameError}</FieldError>}
                </Field>
              </CardContent>
              <CardFooter className="border-t border-border">
                <Button type="submit" variant="outline" size="sm" disabled={!nameChanged || !!nameError}>
                  Rename
                </Button>
              </CardFooter>
            </form>
          </Card>

          <Card>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (topicsError) return;
                if (await save({ description, defaultBranch, license, topics }, "Settings saved")) setSaved((s) => ({ ...s, description, defaultBranch, license, topics: topics.join(", ") }));
              }}
            >
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>Shown on the repository page and in search.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="repo-desc">Description</FieldLabel>
                    <Textarea id="repo-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                  </Field>
                  <Field>
                    <FieldLabel>Default branch</FieldLabel>
                    <Select value={defaultBranch} onValueChange={(v) => v && setDefaultBranch(String(v))}>
                      <SelectTrigger className="w-56 font-mono" aria-label="Default branch">
                        <GitBranch className="size-3.5" aria-hidden />
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
                    <FieldDescription>New pull requests target this branch.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel>Licence</FieldLabel>
                    <Select value={license || NO_LICENSE} onValueChange={(v) => setLicense(v === NO_LICENSE ? "" : String(v))}>
                      <SelectTrigger className="w-full max-w-md" aria-label="Licence">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value={NO_LICENSE}>No licence chosen</SelectItem>
                          {licenses.map((l) => (
                            <SelectItem key={l.id} value={l.id}>
                              {l.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    <FieldDescription>Tells people what they may do with the data. Shown on the repository and in its citation.</FieldDescription>
                  </Field>
                  <Field data-invalid={topicsError ? true : undefined}>
                    <FieldLabel htmlFor="repo-topics">Topics</FieldLabel>
                    <Input id="repo-topics" value={topicsText} onChange={(e) => setTopicsText(e.target.value)} placeholder="flood-modelling, hec-ras, kerala" autoComplete="off" aria-invalid={!!topicsError} />
                    {topicsError ? (
                      <FieldError>{topicsError}</FieldError>
                    ) : (
                      <FieldDescription>Comma-separated, up to ten. Helps people find the repository in Explore.</FieldDescription>
                    )}
                    {topics.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {topics.map((t) => (
                          <Badge key={t} variant="outline" className="font-mono">
                            {t}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </Field>
                </FieldGroup>
              </CardContent>
              <CardFooter className="border-t border-border">
                <Button type="submit" size="sm" disabled={!detailsChanged || !!topicsError}>
                  Save changes
                </Button>
              </CardFooter>
            </form>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Protection for {defaultBranch}</CardTitle>
              <CardDescription>What has to be true before anything merges into the default branch.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                {[
                  { key: "checks" as const, label: "Require checks to pass", note: "CRS, vertical datum and integrity checks must be green." },
                  { key: "review" as const, label: "Require an approving review", note: "At least one collaborator who didn’t write the change." },
                  { key: "owners" as const, label: "Require approval from code owners", note: "Every owner named in CODEOWNERS for a changed file must approve the latest version." },
                  { key: "stale" as const, label: "Dismiss approvals on new commits", note: "A new push needs a fresh review." },
                ].map((rule) => rule.key === "stale" && live ? (
                  <Field key={rule.key} orientation="horizontal">
                    <div className="flex flex-1 flex-col">
                      <FieldLabel className="flex items-center gap-2">
                        {rule.label} <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="size-3" aria-hidden />Always on</Badge>
                      </FieldLabel>
                      <FieldDescription>Approvals count only for the commit they were given on.</FieldDescription>
                    </div>
                  </Field>
                ) : (
                  <Field key={rule.key} orientation="horizontal">
                    <div className="flex flex-1 flex-col">
                      <FieldLabel htmlFor={`rule-${rule.key}`}>{rule.label}</FieldLabel>
                      <FieldDescription>{rule.note}</FieldDescription>
                    </div>
                    <Switch
                      id={`rule-${rule.key}`}
                      checked={protection[rule.key]}
                      onCheckedChange={async (v) => {
                        const on = Boolean(v);
                        setProtection((p) => ({ ...p, [rule.key]: on }));
                        const patch = rule.key === "checks" ? { requireChecks: on } : rule.key === "review" ? { requireReview: on } : rule.key === "owners" ? { requireOwnerReview: on } : {};
                        if (!(await save(patch, `${rule.label}: ${on ? "on" : "off"}`))) setProtection((p) => ({ ...p, [rule.key]: !on }));
                      }}
                    />
                  </Field>
                ))}
                <Field orientation="horizontal">
                  <div className="flex flex-1 flex-col">
                    <FieldLabel className="flex items-center gap-2">
                      History is append-only <Badge variant="outline" className="gap-1 text-[10px]"><Lock className="size-3" aria-hidden />Always on</Badge>
                    </FieldLabel>
                    <FieldDescription>Craton never rewrites history. A rollback is recorded as a new commit, so audits stay intact.</FieldDescription>
                  </div>
                </Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <form
              noValidate
              onSubmit={async (e) => {
                e.preventDefault();
                if (crsError || datumError || nodataError) return;
                const patch = { crs: crs.trim(), verticalDatum: datum.trim() ? Number(datum) : null, nodata: nodata.trim() ? Number(nodata) : null };
                if (await save(patch, "Check settings saved", "The next push is checked against them.")) setSaved((s) => ({ ...s, crs, datum, nodata }));
              }}
            >
              <CardHeader>
                <CardTitle>Checks</CardTitle>
                <CardDescription>Every push is validated against these. Layers in another CRS or datum fail the check.</CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field data-invalid={crsError ? true : undefined}>
                      <FieldLabel htmlFor="check-crs">Required CRS</FieldLabel>
                      <Input id="check-crs" value={crs} onChange={(e) => setCrs(e.target.value)} className="font-mono" spellCheck={false} autoComplete="off" aria-invalid={!!crsError} />
                      {crsError && <FieldError>{crsError}</FieldError>}
                    </Field>
                    <Field data-invalid={datumError ? true : undefined}>
                      <FieldLabel htmlFor="check-datum">Vertical datum (EPSG)</FieldLabel>
                      <Input id="check-datum" value={datum} onChange={(e) => setDatum(e.target.value)} inputMode="numeric" placeholder="Not enforced" className="font-mono" autoComplete="off" aria-invalid={!!datumError} />
                      {datumError && <FieldError>{datumError}</FieldError>}
                    </Field>
                    <Field data-invalid={nodataError ? true : undefined}>
                      <FieldLabel htmlFor="check-nodata">Nodata value</FieldLabel>
                      <Input id="check-nodata" value={nodata} onChange={(e) => setNodata(e.target.value)} inputMode="decimal" placeholder="Not enforced" className="font-mono" autoComplete="off" aria-invalid={!!nodataError} />
                      {nodataError && <FieldError>{nodataError}</FieldError>}
                    </Field>
                  </div>
                </FieldGroup>
              </CardContent>
              <CardFooter className="border-t border-border">
                <Button type="submit" size="sm" disabled={!checksChanged || !!crsError || !!datumError || !!nodataError}>
                  Save check settings
                </Button>
              </CardFooter>
            </form>
          </Card>

          <Card>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const patterns = lockText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
                if (await save({ lockPatterns: patterns }, "File lock rules saved", "A push that changes a matching file without holding its lock is refused.")) setSavedLock(lockText);
              }}
            >
              <CardHeader>
                <CardTitle>Files that must be locked</CardTitle>
                <CardDescription>
                  One pattern per line. A push that changes a matching file is refused unless its author holds the lock, so two people can’t edit a binary that can’t be merged at the same time.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Field>
                  <FieldLabel htmlFor="lock-patterns" className="sr-only">Lock patterns</FieldLabel>
                  <Textarea id="lock-patterns" value={lockText} onChange={(e) => setLockText(e.target.value)} rows={4} spellCheck={false} placeholder={"*.gdb\nmodel/*.p0*\nmodel/**/*.hdf"} className="font-mono text-xs" />
                  <FieldDescription>A name without a slash matches at any depth (<span className="font-mono">*.gdb</span>); with a slash it starts at the repository root. <span className="font-mono">**</span> crosses folders.</FieldDescription>
                </Field>
              </CardContent>
              <CardFooter className="border-t border-border">
                <Button type="submit" size="sm" disabled={lockText === savedLock}>
                  Save lock rules
                </Button>
              </CardFooter>
            </form>
          </Card>

          {live && codeOwners && <CodeOwnersCard owner={owner} repo={repo} initial={codeOwners.text} branch={codeOwners.branch} head={codeOwners.head} canWrite />}

          {heldLocks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Locks held now</CardTitle>
                <CardDescription>Files someone has locked for editing. Old ones are listed first; release one if its holder has moved on.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border border-t border-border">
                  {[...heldLocks].sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0)).map((l) => (
                    <li key={l.path} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs">{l.path}</p>
                        <p className="text-xs text-muted-foreground">
                          @{l.holder} · {l.ageDays ?? 0} {l.ageDays === 1 ? "day" : "days"}{l.stale ? " · stale" : ""}{l.reason ? ` · ${l.reason}` : ""}
                        </p>
                      </div>
                      <ConfirmAction
                        trigger={<Button variant="outline" size="sm">Release</Button>}
                        title={`Release @${l.holder}’s lock?`}
                        description={`${l.path} becomes editable by everyone again. @${l.holder} may still have unpushed changes to it.`}
                        confirmLabel="Release lock"
                        onConfirm={async () => {
                          const r = await unlockFileAction(owner, repo, l.path, true);
                          if (!r.ok) return void notify.error("Couldn’t release the lock", { description: r.error });
                          setHeldLocks((cur) => cur.filter((x) => x.path !== l.path));
                          notify.success(`Released ${l.path.split("/").pop()}`);
                        }}
                      />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-destructive">Danger zone</h2>
            <div className="flex flex-col divide-y divide-destructive/20 border border-destructive/40">
              <DangerRow
                title="Change visibility"
                note={`This repository is ${visibility}.`}
                action={
                  <ConfirmAction
                    trigger={
                      <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
                        Make {visibility === "public" ? "private" : "public"}
                      </Button>
                    }
                    title={`Make ${owner}/${repo} ${visibility === "public" ? "private" : "public"}?`}
                    description={
                      visibility === "public"
                        ? "Only people with access will see it. Anyone who already cloned it keeps their copy, and it counts toward your plan’s private repositories."
                        : "Anyone will be able to see and clone it. Its chunks become shared public data that others can reference for free."
                    }
                    confirmLabel={`Make ${visibility === "public" ? "private" : "public"}`}
                    onConfirm={async () => {
                      const next = visibility === "public" ? "private" : "public";
                      if (await save({ visibility: next }, `Repository is now ${next}`)) setVisibility(next);
                    }}
                  />
                }
              />
              {!live && <DangerRow
                title="Transfer ownership"
                note="Move this repository to another organization where you’re an admin."
                action={
                  <TypeToConfirm
                    trigger={
                      <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:bg-destructive/10">
                        Transfer
                      </Button>
                    }
                    title="Transfer repository"
                    description="Issues, pull requests, checks and history move with it. Links redirect."
                    expected={`${owner}/${repo}`}
                    confirmLabel="Transfer repository"
                    onConfirm={() => notify.success(`Transfer to ${transferTo} requested`, { description: `An admin of ${transferTo} must accept it.` })}
                  >
                    <Field>
                      <FieldLabel>New owner</FieldLabel>
                      <Select value={transferTo} onValueChange={setTransferTo}>
                        <SelectTrigger className="w-full" aria-label="New owner">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="w-full">
                          <SelectGroup>
                            <SelectItem value="deltares">deltares</SelectItem>
                            <SelectItem value="openterrain">openterrain</SelectItem>
                            <SelectItem value="priyam">priyam (personal)</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                  </TypeToConfirm>
                }
              />}
              <DangerRow
                title="Delete this repository"
                note="Removes history, issues and pull requests. Chunks shared with other repositories are kept for them."
                action={
                  <TypeToConfirm
                    trigger={
                      <Button variant="destructive" size="sm">
                        <Trash2 data-icon="inline-start" />
                        Delete repository
                      </Button>
                    }
                    title={`Delete ${owner}/${repo}?`}
                    description="This can’t be undone. Anyone who cloned it keeps their local copy."
                    expected={`${owner}/${repo}`}
                    confirmLabel="Delete this repository"
                    onConfirm={async () => {
                      if (live) {
                        const result = await deleteRepoAction(owner, repo);
                        if (!result.ok) {
                          notify.error("Couldn’t delete the repository", { description: result.error });
                          return;
                        }
                      }
                      notify.success(`Deleted ${owner}/${repo}`);
                      router.push("/dashboard");
                    }}
                  />
                }
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function DangerRow({ title, note, action }: { title: string; note: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
      <div>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground text-pretty">{note}</p>
      </div>
      {action}
    </div>
  );
}
