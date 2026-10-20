"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CloudUpload, FileWarning, FolderGit2, Globe, Link2, Lock, Upload } from "lucide-react";
import { notify } from "@/components/button-status";
import { AppShell } from "@/components/app-shell";
import { CommandLine } from "@/components/craton-actions";
import { PageHeader } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { DataTypeBadge } from "@/components/data-type-badge";
import Loader from "@/components/kokonutui/loader";
import type { DataType, Repo } from "@/lib/data";
import { createRepoAction } from "@/app/actions";
import { cn } from "@/lib/utils";

const NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/;

const typeByExt: Record<string, DataType> = {
  tif: "DEM", tiff: "DEM", vrt: "DEM", img: "DEM",
  shp: "Shapefile", gpkg: "Shapefile", geojson: "Shapefile",
  las: "LiDAR", laz: "LiDAR",
  nc: "NetCDF", zarr: "Zarr",
  hdf: "HEC-RAS", p01: "HEC-RAS", g01: "HEC-RAS", u01: "HEC-RAS",
  inp: "SWMM",
};

type Picked = { name: string; size: number; type?: DataType; warning?: string };

function formatBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Detect data types and flag incomplete shapefile sets before anything is uploaded. */
function inspect(files: File[]): Picked[] {
  const names = new Set(files.map((f) => f.name.toLowerCase()));
  return files.map((f) => {
    const lower = f.name.toLowerCase();
    const ext = lower.split(".").pop() ?? "";
    let warning: string | undefined;
    if (ext === "shp") {
      const stem = lower.slice(0, -4);
      const missing = ["dbf", "shx"].filter((e) => !names.has(`${stem}.${e}`));
      if (missing.length) warning = `Missing .${missing.join(" and .")}: add the full shapefile set`;
      else if (!names.has(`${stem}.prj`)) warning = "No .prj file: the CRS will be taken from repository settings";
    }
    return { name: f.name, size: f.size, type: typeByExt[ext], warning };
  });
}

export function NewRepoView({
  importMode,
  repos,
  owners,
  defaultOwner,
  live,
  defaultVisibility = "public",
  starters = [],
  server,
}: {
  importMode: boolean;
  repos: Repo[];
  owners: string[];
  defaultOwner: string;
  live: boolean;
  /** What the person chose in Settings → Preferences. */
  defaultVisibility?: "public" | "private";
  /** README starters from the API (empty when it isn't reachable). */
  starters?: { id: string; name: string; about: string }[];
  server: string;
}) {
  const [mode, setMode] = useState(importMode ? "import" : "create");
  const [owner, setOwner] = useState(defaultOwner);
  const [pending, setPending] = useState(false);
  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [visibility, setVisibility] = useState<string>(defaultVisibility);
  const [starter, setStarter] = useState("none");
  const [crs, setCrs] = useState("EPSG:32643");
  const [source, setSource] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const nameError = !trimmed
    ? "Enter a repository name."
    : !NAME.test(trimmed)
      ? "Use lowercase letters, numbers, dots, dashes or underscores."
      : repos.some((r) => r.owner === owner && r.name === trimmed)
        ? `${owner}/${trimmed} already exists.`
        : null;
  const sourceError = mode === "import" && !/^(https?|s3|gs):\/\/\S+$/.test(source.trim()) ? "Enter an https://, s3:// or gs:// URL." : null;

  const importUnavailable = live && mode === "import";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (nameError || sourceError || pending || importUnavailable) {
      document.getElementById(nameError ? "repo-name" : "import-url")?.focus();
      return;
    }
    if (live) {
      setPending(true);
      const result = await createRepoAction({ owner, name: trimmed, description: description.trim(), visibility: visibility as "public" | "private", crs: crs.trim(), card: starter === "none" ? undefined : starter });
      setPending(false);
      if (!result.ok) {
        // Limits come with the way forward: confirm the email, or keep this one public.
        const action =
          result.code === "email_unverified"
            ? { label: "Open settings", onClick: () => window.location.assign("/settings/security") }
            : result.code === "private_repo_limit"
              ? { label: "Make it public", onClick: () => setVisibility("public") }
              : undefined;
        notify.error("Couldn’t create the repository", { description: result.error, action, duration: action ? 10_000 : undefined });
        return;
      }
    }
    setCreated(`${owner}/${trimmed}`);
    notify.success(`Created ${owner}/${trimmed}`, {
      description: mode === "import" ? "Import runs in the background. We’ll notify you when it finishes." : undefined,
    });
  }

  function addFiles(list: FileList | null) {
    if (!list?.length) return;
    setPicked(inspect(Array.from(list)));
  }

  const flagged = picked.filter((p) => p.warning).length;

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 sm:px-6 py-8">
        <PageHeader
          title={created ? "Repository created" : mode === "import" ? "Import a repository" : "Create a repository"}
          description={
            created
              ? "Push your first files with the CLI, or check them in the browser first."
              : "A repository holds a project’s terrain, vectors and model files with their full version history."
          }
        />

        {!created ? (
          <form onSubmit={onCreate} noValidate className="flex flex-col gap-6">
            <ToggleGroup
              variant="outline"
              spacing={0}
              value={[mode]}
              onValueChange={(v) => v[0] && setMode(v[0])}
              aria-label="Start from"
              className="w-full"
            >
              <ToggleGroupItem value="create" className="flex-1">
                <FolderGit2 aria-hidden /> Start empty
              </ToggleGroupItem>
              <ToggleGroupItem value="import" className="flex-1">
                <Upload aria-hidden /> Import from a URL
              </ToggleGroupItem>
            </ToggleGroup>

            <FieldGroup>
              <Field data-invalid={touched && !!nameError ? true : undefined}>
                <FieldLabel htmlFor="repo-name">Owner and name</FieldLabel>
                <div className="flex items-center gap-2">
                  <Select value={owner} onValueChange={(v) => v && setOwner(String(v))}>
                    <SelectTrigger className="w-40" aria-label="Owner">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {owners.map((o) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <span className="text-muted-foreground" aria-hidden>/</span>
                  <Input
                    id="repo-name"
                    name="name"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="e.g. periyar-basin-2026…"
                    value={name}
                    aria-invalid={touched && !!nameError}
                    aria-describedby="repo-name-help"
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => setTouched(true)}
                    className="font-mono"
                  />
                </div>
                {touched && nameError ? (
                  <FieldError id="repo-name-help">{nameError}</FieldError>
                ) : (
                  <FieldDescription id="repo-name-help">
                    {trimmed && !nameError ? (
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="size-3.5 text-chart-1" aria-hidden /> {owner}/{trimmed} is available.
                      </span>
                    ) : (
                      "Short, lowercase and specific: the basin or project, not the file type."
                    )}
                  </FieldDescription>
                )}
              </Field>

              {mode === "import" && (
                <Field data-invalid={touched && !!sourceError ? true : undefined}>
                  <FieldLabel htmlFor="import-url">Source URL</FieldLabel>
                  <Input
                    id="import-url"
                    name="source"
                    type="url"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="s3://bucket/basin/ or https://…"
                    value={source}
                    aria-invalid={touched && !!sourceError}
                    onChange={(e) => setSource(e.target.value)}
                    className="font-mono"
                  />
                  {touched && sourceError ? (
                    <FieldError>{sourceError}</FieldError>
                  ) : (
                    <FieldDescription>A folder on S3, Google Cloud Storage or any HTTPS server. History starts from this snapshot.</FieldDescription>
                  )}
                  {importUnavailable && (
                    <p className="border border-border bg-muted/30 p-3 text-xs text-muted-foreground text-pretty">
                      Importing from a URL isn’t available on this server yet. Start empty, then run <code className="font-mono text-foreground">craton add</code> and{" "}
                      <code className="font-mono text-foreground">craton push</code> from a machine that has the files.
                    </p>
                  )}
                </Field>
              )}

              <Field>
                <FieldLabel htmlFor="desc">Description <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
                <Textarea id="desc" name="description" placeholder="Calibrated HEC-RAS model and terrain data for…" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>README starter</FieldLabel>
                  <Select value={starter} onValueChange={setStarter}>
                    <SelectTrigger className="w-full" aria-label="README starter">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="w-full">
                      <SelectGroup>
                        <SelectItem value="none">No README (empty repository)</SelectItem>
                        {starters.map((t) => (
                          <SelectItem key={t.id} value={t.id}>
                            {t.name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="crs">Required CRS</FieldLabel>
                  <Input id="crs" name="crs" value={crs} onChange={(e) => setCrs(e.target.value)} className="font-mono" spellCheck={false} />
                  <FieldDescription>Commits in another CRS fail the checks.</FieldDescription>
                </Field>
              </div>

              <FieldSet>
                <FieldLegend>Visibility</FieldLegend>
                <RadioGroup value={visibility} onValueChange={(v) => setVisibility(String(v))} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    { id: "public", icon: Globe, label: "Public", note: "Anyone can see and fork it. Shared chunks are free for everyone." },
                    { id: "private", icon: Lock, label: "Private", note: "Only you and people you invite. Counts toward your plan." },
                  ].map((o) => (
                    <FieldLabel
                      key={o.id}
                      htmlFor={`v-${o.id}`}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 border p-3 transition-colors",
                        visibility === o.id ? "border-foreground/40 bg-muted/30" : "border-border hover:bg-muted/20",
                      )}
                    >
                      <RadioGroupItem value={o.id} id={`v-${o.id}`} className="mt-0.5" />
                      <span className="flex flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 font-medium">
                          <o.icon className="size-3.5" aria-hidden /> {o.label}
                        </span>
                        <span className="text-sm font-normal text-muted-foreground text-pretty">{o.note}</span>
                      </span>
                    </FieldLabel>
                  ))}
                </RadioGroup>
              </FieldSet>
            </FieldGroup>

            <div className="flex items-center gap-2 border-t border-border pt-5">
              <Button type="submit" loading={pending} disabled={pending || importUnavailable}>
                {mode === "import" ? "Import repository" : "Create repository"}
              </Button>
              <Button variant="ghost" href="/dashboard">
                Cancel
              </Button>
            </div>
            {pending && (
              <Loader
                title={mode === "import" ? "Importing repository" : "Creating repository"}
                subtitle={mode === "import" ? "Fetching objects from the source and verifying checksums" : "Setting up the content store and default branch"}
                size="sm"
                className="py-2"
              />
            )}
          </form>
        ) : (
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Push from your project folder</CardTitle>
                <CardDescription>Only chunks Craton hasn’t seen before are uploaded.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <CommandLine command={`craton init ${created.split("/")[1]} --remote ${server}/${created}`} />
                <CommandLine command={`cd ${created.split("/")[1]} && craton add .`} />
                <CommandLine command={'craton commit -m "Initial import"'} />
                <CommandLine command="craton push" />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Check files before you push</CardTitle>
                <CardDescription>Files stay on your computer. Craton only reads their names and sizes here.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    addFiles(e.dataTransfer.files);
                  }}
                  className={cn(
                    "flex cursor-pointer flex-col items-center gap-2 border border-dashed p-8 text-center transition-colors",
                    dragging ? "border-foreground/50 bg-muted/40" : "border-border bg-muted/20 hover:bg-muted/30",
                  )}
                >
                  <CloudUpload className="size-7 text-muted-foreground" aria-hidden />
                  <span className="text-sm">Drop DEM, shapefile, LiDAR or model files, or click to choose</span>
                  <span className="text-xs text-muted-foreground">.tif, .shp + .dbf + .shx, .laz, .nc, .hdf, .p01, .inp</span>
                </button>
                <input ref={fileInput} type="file" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} aria-label="Choose files" />

                {picked.length > 0 && (
                  <>
                    <ul className="flex flex-col divide-y divide-border border border-border" aria-live="polite">
                      {picked.map((f) => (
                        <li key={f.name} className="flex items-start gap-2.5 px-3 py-2 text-sm">
                          {f.warning ? (
                            <FileWarning className="mt-0.5 size-4 shrink-0 text-chart-3" aria-label="Needs attention" />
                          ) : (
                            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-chart-1" aria-label="Ready" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-mono text-xs">{f.name}</p>
                            {f.warning && <p className="text-xs text-foreground">{f.warning}</p>}
                          </div>
                          {f.type && <DataTypeBadge type={f.type} />}
                          <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatBytes(f.size)}</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {picked.length} {picked.length === 1 ? "file" : "files"} · {formatBytes(picked.reduce((n, f) => n + f.size, 0))}
                      {flagged > 0 ? ` · ${flagged} need attention before they can be versioned` : " · all ready to push"}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center gap-2">
              <Button href={created ? `/${created}` : "/dashboard"}>Go to repository</Button>
              <Button variant="ghost" onClick={() => { setCreated(null); setPicked([]); setName(""); setTouched(false); }}>
                Create another
              </Button>
            </div>
          </div>
        )}
        {!created && (
          <p className="text-xs text-muted-foreground">
            Moving from Git LFS or DVC? <Link href="/docs" className="text-foreground underline underline-offset-2">Read the migration guide</Link>.
          </p>
        )}
      </div>
    </AppShell>
  );
}
