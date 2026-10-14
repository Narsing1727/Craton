"use client";

// First-run setup, four short steps. Only the first is required; everything else can be done
// later from the dashboard checklist. Each step does its real work as you continue.

import { useState, useTransition } from "react";
import { Building2, Check, FolderGit2, FolderPlus, Sparkles, Terminal, User } from "lucide-react";
import { notify } from "@/components/button-status";
import { CratonLogo } from "@/components/craton-logo";
import { CommandLine, CopyButton } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { createOrgAction, createRepoAction, createTokenAction, inviteMemberAction } from "@/app/actions";
import { finishOnboardingAction, saveProfileAction } from "@/app/auth-actions";
import { cn } from "@/lib/utils";

type Props = {
  user: { handle: string; name: string; role: string | null; orgs: string[] };
  server: string;
};

const ROLES = [
  { id: "modeler", label: "Flood and hydraulic modeling", note: "HEC-RAS, SWMM, MIKE, TUFLOW" },
  { id: "gis", label: "GIS and remote sensing", note: "DEMs, LiDAR, imagery, vectors" },
  { id: "utility", label: "Water utility or agency", note: "Networks, assets, operations" },
  { id: "research", label: "Research or teaching", note: "Reproducible studies and courses" },
  { id: "other", label: "Something else", note: "" },
];

const STEPS = [
  { id: "you", label: "You", icon: User },
  { id: "workspace", label: "Workspace", icon: Building2 },
  { id: "repository", label: "First repository", icon: FolderGit2 },
  { id: "cli", label: "Command line", icon: Terminal },
] as const;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 39);
const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

function Choice({ selected, onSelect, title, note, icon: Icon, badge }: { selected: boolean; onSelect: () => void; title: string; note?: string; icon?: typeof User; badge?: string }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 border p-3 text-left transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
        selected ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/20",
      )}
    >
      {Icon && <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          {title}
          {badge && <span className="border border-border px-1.5 py-px text-[10px] font-normal text-muted-foreground">{badge}</span>}
        </span>
        {note && <span className="text-xs text-muted-foreground text-pretty">{note}</span>}
      </span>
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center border", selected ? "border-foreground bg-foreground text-background" : "border-border")} aria-hidden>
        {selected && <Check className="size-3" />}
      </span>
    </button>
  );
}

export function OnboardingFlow({ user, server }: Props) {
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();

  // Step 1
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<string | null>(user.role);
  // Step 2
  const [workspace, setWorkspace] = useState<string>(user.orgs[0] ?? user.handle);
  const [newOrg, setNewOrg] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [invites, setInvites] = useState("");
  // Step 3
  const [repoMode, setRepoMode] = useState<"sample" | "empty">("sample");
  const [repoName, setRepoName] = useState("");
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  const [crs, setCrs] = useState("EPSG:32643");
  const [repo, setRepo] = useState<string | null>(null);
  // Step 4
  const [token, setToken] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const orgSlug = slugify(orgName);

  function next() {
    setError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function saveProfile() {
    if (!name.trim()) return setError("Add your name so teammates know who pushed what.");
    start(async () => {
      const result = await saveProfileAction({ name: name.trim(), role });
      if (!result.ok) return setError(result.error);
      next();
    });
  }

  function saveWorkspace() {
    if (!newOrg) return next();
    if (!orgSlug) return setError("Give the organization a name.");
    start(async () => {
      const created = await createOrgAction(orgSlug, orgName.trim());
      if (!created.ok) return setError(created.error);
      setWorkspace(orgSlug);
      const handles = invites.split(/[\s,]+/).map((h) => h.replace(/^@/, "").trim().toLowerCase()).filter(Boolean);
      const failed: string[] = [];
      for (const h of handles) {
        const r = await inviteMemberAction(orgSlug, h, "Member");
        if (!r.ok) failed.push(h);
      }
      if (handles.length) {
        const added = handles.length - failed.length;
        if (added) notify.success(`Added ${added} ${added === 1 ? "teammate" : "teammates"} to ${orgSlug}`);
        if (failed.length) notify.error(`Couldn’t add ${failed.join(", ")}`, { description: "They need a Craton account first. Invite them later from the organization’s People page." });
      }
      setNewOrg(false);
      next();
    });
  }

  function createRepository() {
    const nameToUse = repoMode === "sample" ? "sample-basin" : repoName.trim().toLowerCase();
    if (repoMode === "empty" && !NAME.test(nameToUse)) return setError("Use lowercase letters, numbers, dots, dashes or underscores.");
    if (repoMode === "empty" && !/^EPSG:\d{4,6}$/.test(crs.trim())) return setError("Use an EPSG code, e.g. EPSG:32643.");
    start(async () => {
      const result = await createRepoAction({
        owner: workspace,
        name: nameToUse,
        visibility,
        crs: repoMode === "sample" ? "EPSG:32643" : crs.trim(),
        description: repoMode === "sample" ? "Sample flood model: terrain, catchments, a HEC-RAS plan and gauges." : undefined,
        sample: repoMode === "sample",
      });
      if (!result.ok) return setError(result.error);
      setRepo(`${result.data.owner}/${result.data.name}`);
      next();
    });
  }

  function generateToken() {
    start(async () => {
      const result = await createTokenAction("craton-cli", ["repo", "read:org"], 90);
      if (!result.ok) return setError(result.error);
      setToken(result.data.token);
    });
  }

  function finish(to: string) {
    start(() => finishOnboardingAction(to));
  }

  const current = STEPS[step];

  return (
    <main id="main" className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 items-center justify-between border-b border-border px-4 sm:px-6">
        <CratonLogo />
        <span className="text-xs text-muted-foreground">
          Signed in as <span className="font-mono text-foreground">@{user.handle}</span>
        </span>
      </header>

      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-4 py-10 sm:px-6">
        <ol className="grid grid-cols-4 gap-2" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s.id} className="flex flex-col gap-1.5" aria-current={i === step ? "step" : undefined}>
              <span className={cn("h-1", i <= step ? "bg-foreground" : "bg-muted")} />
              <span className={cn("hidden text-[11px] sm:block", i === step ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground tabular-nums">
            Step {step + 1} of {STEPS.length}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {current.id === "you" && "Welcome to Craton"}
            {current.id === "workspace" && "Where will your work live?"}
            {current.id === "repository" && "Start your first repository"}
            {current.id === "cli" && "Connect the command line"}
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            {current.id === "you" && "Two quick questions so Craton fits the work you do."}
            {current.id === "workspace" && "Keep it personal, or create an organization your team can join. You can do both later."}
            {current.id === "repository" && "A repository holds one project’s terrain, vectors and model files, with every version."}
            {current.id === "cli" && "Large files move through the CLI: it uploads only the chunks that changed and verifies every one."}
          </p>
        </div>

        {current.id === "you" && (
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="ob-name">Your name</FieldLabel>
              <Input id="ob-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Priya Menon" autoFocus />
              <FieldDescription>Shown on your commits, reviews and profile.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel id="ob-role">What do you work on?</FieldLabel>
              <div role="radiogroup" aria-labelledby="ob-role" className="flex flex-col gap-2">
                {ROLES.map((r) => (
                  <Choice key={r.id} selected={role === r.id} onSelect={() => setRole(r.id)} title={r.label} note={r.note} />
                ))}
              </div>
            </Field>
          </FieldGroup>
        )}

        {current.id === "workspace" && (
          <div className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="Workspace" className="flex flex-col gap-2">
              <Choice selected={!newOrg && workspace === user.handle} onSelect={() => { setNewOrg(false); setWorkspace(user.handle); }} icon={User} title={`Just me (@${user.handle})`} note="Repositories under your own account. Great for trying things out." />
              {user.orgs.map((o) => (
                <Choice key={o} selected={!newOrg && workspace === o} onSelect={() => { setNewOrg(false); setWorkspace(o); }} icon={Building2} title={o} note="An organization you already belong to." />
              ))}
              <Choice selected={newOrg} onSelect={() => setNewOrg(true)} icon={Building2} title="Create an organization" note="Shared repositories, members and roles, and one storage bill for the team." />
            </div>
            {newOrg && (
              <FieldGroup className="border border-border p-4">
                <Field>
                  <FieldLabel htmlFor="ob-org">Organization name</FieldLabel>
                  <Input id="ob-org" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Kerala Water Resources Lab" autoFocus />
                  <FieldDescription>
                    Address: <span className="font-mono text-foreground">/orgs/{orgSlug || "your-org"}</span>
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ob-invite">
                    Invite teammates <span className="font-normal text-muted-foreground">(optional)</span>
                  </FieldLabel>
                  <Input id="ob-invite" value={invites} onChange={(e) => setInvites(e.target.value)} placeholder="arunn, sarat" autoCapitalize="none" spellCheck={false} />
                  <FieldDescription>Craton usernames, separated by commas. They join as Members.</FieldDescription>
                </Field>
              </FieldGroup>
            )}
          </div>
        )}

        {current.id === "repository" && (
          <div className="flex flex-col gap-3">
            <div role="radiogroup" aria-label="How to start" className="flex flex-col gap-2">
              <Choice
                selected={repoMode === "sample"}
                onSelect={() => setRepoMode("sample")}
                icon={Sparkles}
                badge="Recommended"
                title="Explore a sample project"
                note="A small but complete flood model: a 2 m DEM, catchment shapefiles, a HEC-RAS plan and gauge readings, with a pull request waiting for your review."
              />
              <Choice selected={repoMode === "empty"} onSelect={() => setRepoMode("empty")} icon={FolderPlus} title="Start empty" note="Name it now and push your own files from the command line." />
            </div>
            {repoMode === "empty" && (
              <FieldGroup className="border border-border p-4">
                <Field>
                  <FieldLabel htmlFor="ob-repo">Repository name</FieldLabel>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 font-mono text-sm text-muted-foreground">{workspace}/</span>
                    <Input id="ob-repo" value={repoName} onChange={(e) => setRepoName(e.target.value.toLowerCase())} placeholder="periyar-basin-2026" className="font-mono" autoCapitalize="none" spellCheck={false} autoFocus />
                  </div>
                </Field>
                <Field>
                  <FieldLabel htmlFor="ob-crs">Required coordinate system</FieldLabel>
                  <Input id="ob-crs" value={crs} onChange={(e) => setCrs(e.target.value)} className="font-mono" spellCheck={false} />
                  <FieldDescription>Every push is checked against it, so layers never drift into another CRS.</FieldDescription>
                </Field>
              </FieldGroup>
            )}
            <div role="radiogroup" aria-label="Visibility" className="grid grid-cols-2 gap-2">
              <Choice selected={visibility === "private"} onSelect={() => setVisibility("private")} title="Private" note="Only you and people you add." />
              <Choice selected={visibility === "public"} onSelect={() => setVisibility("public")} title="Public" note="Anyone can view and clone." />
            </div>
          </div>
        )}

        {current.id === "cli" && (
          <div className="flex flex-col gap-4">
            {!token ? (
              <div className="flex flex-col items-start gap-2 border border-border p-4">
                <p className="text-sm font-medium">1. Create a token for your machine</p>
                <p className="text-xs text-muted-foreground">It lets the CLI push as you. It&apos;s shown once and expires in 90 days; revoke it any time in Settings.</p>
                <Button size="sm" onClick={generateToken} disabled={pending}>
                  Create token
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-2 border border-border p-4">
                <p className="text-sm font-medium">1. Your token</p>
                <div className="flex items-center gap-1 border border-border bg-muted/30 py-0.5 pl-2 pr-0.5">
                  <code className="min-w-0 flex-1 truncate font-mono text-xs">{token}</code>
                  <CopyButton value={token} label="Copy token" />
                </div>
                <p className="text-xs text-muted-foreground">Copy it now. You won&apos;t see it again.</p>
              </div>
            )}
            <div className="flex flex-col gap-2 border border-border p-4">
              <p className="text-sm font-medium">2. Install and sign in</p>
              <CommandLine command="cd backend && npm install && npm link" />
              <CommandLine command={`craton auth login --token ${token ?? "<token>"} --server ${server}`} />
            </div>
            <div className="flex flex-col gap-2 border border-border p-4">
              <p className="text-sm font-medium">{repo ? "3. Get your repository" : "3. Clone any repository"}</p>
              <CommandLine command={`craton clone ${repo ?? "hydrolab/chalakudy-basin"}`} />
              <p className="text-xs text-muted-foreground">Then edit files in QGIS or HEC-RAS as usual, and <span className="font-mono text-foreground">craton add . &amp;&amp; craton commit -m &quot;…&quot; &amp;&amp; craton push</span>.</p>
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              Tip: press <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd> anywhere in Craton to search or jump to any repository, file or page.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
            {error}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
          <div>
            {step > 0 && (
              <Button variant="ghost" size="sm" onClick={() => { setError(null); setStep((s) => s - 1); }} disabled={pending}>
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {step > 0 && current.id !== "cli" && (
              <Button variant="ghost" size="sm" onClick={next} disabled={pending}>
                Skip
              </Button>
            )}
            {current.id === "you" && (
              <Button onClick={saveProfile} disabled={pending}>
                Continue
              </Button>
            )}
            {current.id === "workspace" && (
              <Button onClick={saveWorkspace} disabled={pending}>
                {pending ? (newOrg ? "Creating…" : "Saving…") : newOrg ? "Create organization" : "Continue"}
              </Button>
            )}
            {current.id === "repository" && (
              <Button onClick={createRepository} disabled={pending}>
                {pending ? (repoMode === "sample" ? "Setting up the sample…" : "Creating…") : repoMode === "sample" ? "Create sample project" : "Create repository"}
              </Button>
            )}
            {current.id === "cli" && (
              <>
                <Button variant="ghost" size="sm" onClick={() => finish("/dashboard")} disabled={pending}>
                  I&apos;ll do this later
                </Button>
                <Button onClick={() => finish(repo ? `/${repo}` : "/dashboard")} disabled={pending}>
                  {repo ? "Open my repository" : "Go to dashboard"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
