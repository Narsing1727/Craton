"use client";

// Add files to a repository from the browser, like dropping them into a Drive folder: choose or
// drop files or a whole folder, see which will replace what is already there, pick the branch, and
// watch it upload. One commit comes out of it. Large datasets still belong in `craton push`, which
// resumes and verifies every chunk; the dialog says so rather than failing late.

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileUp, FolderUp, Upload, X } from "lucide-react";
import { notify } from "@/components/button-status";
import { CommandLine } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useSession } from "@/components/session";
import { useCanWrite, useRepoSummary } from "@/components/repo-context";
import { pathsAction } from "@/app/actions";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 200;

type Picked = { file: File; path: string };
/** One credential the server's scan found: where, and what kind. The secret itself never comes back. */
type SecretFinding = { path: string; line: number; kind: string; preview: string; live?: boolean };

/** Every file under a dropped folder, with its path relative to the drop. */
async function readEntry(entry: FileSystemEntry, prefix = ""): Promise<Picked[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [{ file, path: `${prefix}${entry.name}` }];
  }
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: FileSystemEntry[] = [];
  // readEntries returns a batch at a time; keep asking until it's empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    all.push(...batch);
  }
  return (await Promise.all(all.map((e) => readEntry(e, `${prefix}${entry.name}/`)))).flat();
}

async function fromDrop(e: React.DragEvent): Promise<Picked[]> {
  const items = [...e.dataTransfer.items].filter((i) => i.kind === "file");
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => Boolean(x));
  if (entries.length) return (await Promise.all(entries.map((en) => readEntry(en)))).flat();
  return [...e.dataTransfer.files].map((file) => ({ file, path: file.name }));
}

/** "· 3.1 MB of 7.4 MB · 1.2 MB/s · about 4 s left", once enough has gone to say anything useful. */
function flowLine(flow: { loaded: number; total: number; startedAt: number } | null, now: number): string {
  if (!flow || flow.loaded <= 0) return "";
  const seconds = Math.max(0.001, (now - flow.startedAt) / 1000);
  const rate = flow.loaded / seconds;
  const parts = [`${formatBytes(flow.loaded)} of ${formatBytes(flow.total)}`];
  if (seconds >= 1.5) {
    parts.push(`${formatBytes(rate)}/s`);
    const left = (flow.total - flow.loaded) / rate;
    if (Number.isFinite(left) && left >= 2) parts.push(left < 90 ? `about ${Math.round(left)} s left` : `about ${Math.round(left / 60)} min left`);
  }
  return ` · ${parts.join(" · ")}`;
}

export function UploadDialog({
  owner,
  repo,
  branches,
  defaultBranch,
  currentRef,
  expected,
  folder = "",
  empty = false,
}: {
  owner: string;
  repo: string;
  branches: string[];
  defaultBranch: string;
  /** The branch being looked at; a commit id when someone is viewing history (then only a new branch makes sense). */
  currentRef: string;
  /** The full commit id at the tip of `currentRef`, so a branch that moved is caught. */
  expected?: string;
  /** The folder being looked at, "" for the top. */
  folder?: string;
  /** The repository has no commits yet: the first upload creates the default branch itself. */
  empty?: boolean;
}) {
  const router = useRouter();
  const user = useSession();
  const [open, setOpen] = React.useState(false);
  const [picked, setPicked] = React.useState<Picked[]>([]);
  const [target, setTarget] = React.useState(folder);
  const onBranch = empty || branches.includes(currentRef);
  const [newBranch, setNewBranch] = React.useState(!onBranch);
  const [branchName, setBranchName] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [existing, setExisting] = React.useState<Set<string> | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [progress, setProgress] = React.useState<number | null>(null);
  /** Bytes sent and the whole size, with when the upload started, for the rate and the time left. */
  const [flow, setFlow] = React.useState<{ loaded: number; total: number; startedAt: number } | null>(null);
  const [now, setNow] = React.useState(0);
  const request = React.useRef<XMLHttpRequest | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  /** The secret scan stopped the upload: what it found, and (for an administrator) the reason for going ahead anyway. */
  const [secrets, setSecrets] = React.useState<SecretFinding[] | null>(null);
  const [allowReason, setAllowReason] = React.useState("");
  const isAdmin = useRepoSummary()?.access === "admin";
  const filesInput = React.useRef<HTMLInputElement>(null);
  const folderInput = React.useRef<HTMLInputElement>(null);

  const canWrite = useCanWrite();
  const uploading = progress !== null;

  // Which files are already in the repository, so the list can say "replaces" before anyone commits.
  React.useEffect(() => {
    if (!open || existing) return;
    let cancelled = false;
    pathsAction(owner, repo, onBranch ? currentRef : defaultBranch).then((r) => {
      if (!cancelled && r.ok) setExisting(new Set(r.files.map((f) => f.path)));
    });
    return () => {
      cancelled = true;
    };
  }, [open, existing, owner, repo, currentRef, defaultBranch, onBranch]);

  if (!canWrite) return null;

  const cleanFolder = target.trim().replace(/^\/+|\/+$/g, "");
  const destination = (p: Picked) => (cleanFolder ? `${cleanFolder}/${p.path}` : p.path);
  const total = picked.reduce((n, p) => n + p.file.size, 0);
  const tooMany = picked.length > MAX_FILES;
  const tooBig = total > MAX_BYTES;
  const replaces = existing ? picked.filter((p) => existing.has(destination(p))).length : 0;
  const branchProblem = newBranch && !/^[a-z0-9][a-z0-9._/-]{0,99}$/.test(branchName.trim()) ? "Use lowercase letters, numbers, dots, dashes and slashes." : null;
  const ready = picked.length > 0 && !tooMany && !tooBig && !branchProblem && !uploading;

  function add(list: Picked[]) {
    setError(null);
    setSecrets(null);
    setPicked((current) => {
      const byPath = new Map(current.map((p) => [p.path, p]));
      for (const p of list) byPath.set(p.path, p); // choosing the same path again replaces it
      return [...byPath.values()];
    });
  }

  // A clock for the time-left line while an upload runs.
  React.useEffect(() => {
    if (progress === null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [progress === null]);

  function cancelUpload() {
    request.current?.abort();
  }

  function reset() {
    setFlow(null);
    setPicked([]);
    setMessage("");
    setProgress(null);
    setError(null);
    setSecrets(null);
    setAllowReason("");
    setExisting(null);
    setTarget(folder);
    setBranchName("");
    setNewBranch(!onBranch);
  }

  function submit(e: React.FormEvent, allowSecrets?: string) {
    e.preventDefault();
    if (!ready) return;
    setError(null);
    setSecrets(null);
    const form = new FormData();
    if (allowSecrets) form.append("allowSecrets", allowSecrets);
    for (const p of picked) form.append("file", p.file, p.file.name);
    form.append("paths", JSON.stringify(picked.map((p) => p.path)));
    form.append("folder", cleanFolder);
    form.append("message", message.trim());
    if (newBranch) {
      form.append("branch", branchName.trim());
      form.append("from", onBranch ? currentRef : defaultBranch);
    } else {
      form.append("branch", currentRef);
      if (expected) form.append("expected", expected);
    }
    // XMLHttpRequest, because fetch can't report how much of an upload has gone.
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    const startedAt = Date.now();
    xhr.open("POST", `/${owner}/${repo}/upload`);
    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      setProgress(ev.loaded / ev.total);
      setFlow({ loaded: ev.loaded, total: ev.total, startedAt });
      setNow(Date.now());
    };
    xhr.onabort = () => {
      request.current = null;
      setProgress(null);
      setFlow(null);
      setError("Cancelled. Nothing was added.");
    };
    xhr.onerror = () => {
      request.current = null;
      setProgress(null);
      setFlow(null);
      setError("The connection dropped before the upload finished. Nothing was added; try again.");
    };
    xhr.onload = () => {
      request.current = null;
      let body: { error?: { message?: string; code?: string; details?: { findings?: SecretFinding[] } }; files?: unknown[]; commit?: string; branch?: string; unchanged?: string[]; newBytes?: number; storedBytes?: number } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) {
        const n = body.files?.length ?? picked.length;
        const unchangedNote = body.unchanged?.length ? `${body.unchanged.length} ${body.unchanged.length === 1 ? "was" : "were"} already there and unchanged.` : null;
        // What the upload added to storage once compressed; chunks the repository already had cost nothing.
        const storedNote =
          body.newBytes && body.storedBytes !== undefined
            ? `Stored ${formatBytes(body.storedBytes)} for ${formatBytes(body.newBytes)} of new data${body.storedBytes < body.newBytes ? ` (${Math.round((1 - body.storedBytes / body.newBytes) * 100)}% smaller)` : ""}.`
            : null;
        notify.success(`Uploaded ${n} ${n === 1 ? "file" : "files"}`, {
          description: [storedNote, unchangedNote].filter(Boolean).join(" ") || undefined,
          action: body.commit ? { label: "View commit", onClick: () => router.push(`/${owner}/${repo}/commit/${body.commit}`) } : undefined,
        });
        setOpen(false);
        reset();
        // A new branch is a different view; stay on the page we were on otherwise.
        if (newBranch && body.branch) router.push(`/${owner}/${repo}?ref=${encodeURIComponent(body.branch)}`);
        else router.refresh();
        return;
      }
      setProgress(null);
      setFlow(null);
      if (body.error?.code === "secret_detected" && body.error.details?.findings?.length) {
        setSecrets(body.error.details.findings);
        return;
      }
      setError(body.error?.message ?? (xhr.status === 413 ? "That’s too much for the browser. Use the CLI: craton push." : `The upload failed (${xhr.status}).`));
    };
    setProgress(0);
    xhr.send(form);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Upload data-icon="inline-start" />
        Upload files
      </Button>
      <Dialog open={open} onOpenChange={(o) => (uploading ? undefined : (setOpen(o), !o && reset()))}>
        <DialogContent className="sm:max-w-xl">
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Upload files</DialogTitle>
              <DialogDescription>
                Adds one commit to {newBranch ? "a new branch" : <span className="font-mono">{currentRef}</span>}. For large datasets, use <span className="font-mono">craton push</span>, which resumes and verifies every chunk.
              </DialogDescription>
            </DialogHeader>

            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setDragging(false);
                add(await fromDrop(e));
              }}
              className={cn("flex flex-col items-center gap-3 border border-dashed px-4 py-6 text-center transition-colors", dragging ? "border-foreground bg-muted/40" : "border-border bg-muted/20")}
            >
              <FileUp className="size-6 text-muted-foreground" aria-hidden />
              <p className="text-sm">Drop files or a folder here</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => filesInput.current?.click()}>
                  <FileUp data-icon="inline-start" />
                  Choose files
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => folderInput.current?.click()}>
                  <FolderUp data-icon="inline-start" />
                  Choose a folder
                </Button>
              </div>
              <input
                ref={filesInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  add([...(e.target.files ?? [])].map((file) => ({ file, path: file.name })));
                  e.target.value = "";
                }}
              />
              <input
                ref={folderInput}
                type="file"
                hidden
                // @ts-expect-error webkitdirectory is widely supported but not in React's types
                webkitdirectory=""
                onChange={(e) => {
                  add([...(e.target.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name })));
                  e.target.value = "";
                }}
              />
            </div>

            {picked.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground" aria-live="polite">
                  <span>
                    {picked.length} {picked.length === 1 ? "file" : "files"} · {formatBytes(total)}
                    {replaces > 0 && <span className="text-foreground"> · {replaces} will replace what’s there</span>}
                  </span>
                  <button type="button" className="underline underline-offset-2 hover:text-foreground" disabled={uploading} onClick={() => setPicked([])}>
                    Clear
                  </button>
                </p>
                <ul className="max-h-44 divide-y divide-border overflow-auto border border-border" aria-label="Files to upload">
                  {picked.map((p) => (
                    <li key={p.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                      <span className="min-w-0 flex-1 truncate font-mono">{destination(p)}</span>
                      {existing?.has(destination(p)) && <span className="shrink-0 text-muted-foreground">replaces</span>}
                      <span className="shrink-0 tabular-nums text-muted-foreground">{formatBytes(p.file.size)}</span>
                      <button type="button" aria-label={`Remove ${p.path}`} className="shrink-0 text-muted-foreground hover:text-foreground" disabled={uploading} onClick={() => setPicked((c) => c.filter((x) => x !== p))}>
                        <X className="size-3.5" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                {(tooBig || tooMany) && (
                  <div role="alert" className="flex flex-col gap-2 border border-border bg-muted/30 p-3 text-xs">
                    <p className="text-pretty">
                      {tooBig ? `That’s ${formatBytes(total)}; the browser takes up to ${formatBytes(MAX_BYTES)} at a time.` : `That’s ${picked.length} files; the browser takes up to ${MAX_FILES} at a time.`} The command line
                      sends only the chunks the repository doesn’t have yet, compresses rasters and tables for the trip, and picks up where it stopped if the connection drops:
                    </p>
                    <CommandLine command={`craton clone ${owner}/${repo}`} />
                    <p className="text-muted-foreground">Then copy the files into that folder and run:</p>
                    <CommandLine command='craton add . && craton commit -m "Add data" && craton push' />
                  </div>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Into the folder</span>
                <Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="(top level)" className="font-mono" disabled={uploading} autoComplete="off" spellCheck={false} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-muted-foreground">Commit message (optional)</span>
                <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Add the 2024 survey" maxLength={200} disabled={uploading} autoComplete="off" />
              </label>
            </div>

            <fieldset className="flex flex-col gap-2 text-sm" disabled={uploading}>
              <legend className="mb-1 text-muted-foreground">Where it goes</legend>
              {onBranch && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="dest" checked={!newBranch} onChange={() => setNewBranch(false)} />
                  Straight onto <span className="font-mono">{currentRef}</span>
                </label>
              )}
              {!empty && (
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="dest" checked={newBranch} onChange={() => setNewBranch(true)} />
                  A new branch, to review before merging
                </label>
              )}
              {newBranch && (
                <div className="ml-6 flex flex-col gap-1">
                  <Input value={branchName} onChange={(e) => setBranchName(e.target.value.toLowerCase())} placeholder="add-2024-survey" className="font-mono" aria-label="New branch name" aria-invalid={Boolean(branchName && branchProblem)} autoComplete="off" spellCheck={false} />
                  {branchName && branchProblem && <span className="text-xs text-destructive">{branchProblem}</span>}
                </div>
              )}
            </fieldset>

            {uploading && (
              <div className="flex flex-col gap-1" role="status">
                <progress className="h-1.5 w-full [&::-moz-progress-bar]:bg-foreground [&::-webkit-progress-bar]:bg-muted [&::-webkit-progress-value]:bg-foreground" value={progress ?? 0} max={1} aria-label="Upload progress" />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {progress !== null && progress >= 1 ? "Adding the commit…" : `Uploading ${Math.round((progress ?? 0) * 100)}%${flowLine(flow, now)}`}
                </span>
              </div>
            )}
            {secrets && (
              <div role="alert" className="flex flex-col gap-2 border border-destructive/40 bg-destructive/10 p-3 text-xs">
                <p className="font-medium text-destructive">Nothing was added: {secrets.length === 1 ? "a credential was" : `${secrets.length} credentials were`} found in the files.</p>
                <ul className="flex flex-col gap-1">
                  {secrets.map((f, i) => (
                    <li key={`${f.path}:${f.line}:${i}`} className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono">
                        {f.path}:{f.line}
                      </span>
                      <span>
                        {f.live ? "a live " : ""}
                        {f.kind}
                      </span>
                      <span className="font-mono text-muted-foreground">{f.preview}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-pretty text-muted-foreground">
                  History can’t be edited afterwards. Take {secrets.length === 1 ? "it" : "them"} out of the files, and replace {secrets.length === 1 ? "it" : "them"} at the source if {secrets.length === 1 ? "it was" : "they were"} real. A line that is only an example can carry{" "}
                  <span className="font-mono">craton:allow-secret</span>.
                </p>
                {isAdmin && (
                  <div className="flex flex-col gap-1.5 border-t border-destructive/30 pt-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-muted-foreground">As an administrator you can add them anyway. Say why; it is written to the audit log.</span>
                      <Input value={allowReason} onChange={(e) => setAllowReason(e.target.value)} placeholder="Why this is safe" aria-label="Reason for adding the files anyway" maxLength={200} autoComplete="off" />
                    </label>
                    <div>
                      <Button type="button" variant="outline" size="sm" disabled={allowReason.trim().length < 5} onClick={(ev) => submit(ev as unknown as React.FormEvent, allowReason.trim())}>
                        Add anyway
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {error && (
              <p role="alert" className="border border-destructive/40 bg-destructive/10 p-2.5 text-xs text-destructive text-pretty">
                {error}
              </p>
            )}

            <DialogFooter>
              {uploading ? (
                <Button type="button" variant="ghost" disabled={progress !== null && progress >= 1} onClick={cancelUpload}>
                  Cancel upload
                </Button>
              ) : (
                <Button type="button" variant="ghost" onClick={() => (setOpen(false), reset())}>
                  Cancel
                </Button>
              )}
              <Button type="submit" loading={uploading} disabled={!ready}>
                <Upload data-icon="inline-start" />
                {picked.length ? `Upload ${picked.length} ${picked.length === 1 ? "file" : "files"}` : "Upload"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
