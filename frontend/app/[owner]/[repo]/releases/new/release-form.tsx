"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GitBranch, Lock, Sparkles, Tag } from "lucide-react";
import { notify } from "@/components/button-status";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createReleaseAction } from "@/app/actions";
import { draftNotes, type NoteFile } from "@/lib/releasenotes";

const SEMVER = /^v\d+\.\d+\.\d+(-[0-9a-z.]+)?$/;

export function ReleaseForm({
  owner,
  repo,
  branches,
  defaultBranch,
  latestVersion,
  existing,
  since,
  files,
  live,
}: {
  owner: string;
  repo: string;
  branches: string[];
  defaultBranch: string;
  latestVersion: string | null;
  existing: string[];
  since: { sha: string; message: string; author: string }[];
  files: NoteFile[];
  live: boolean;
}) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [major, minor] = (latestVersion ?? "v0.0.0").slice(1).split(".").map(Number);
  const [tag, setTag] = useState(latestVersion ? `v${major}.${minor + 1}.0` : "v1.0.0");
  const [target, setTarget] = useState(defaultBranch);
  const [pending, setPending] = useState(false);
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [prerelease, setPrerelease] = useState(false);
  const [touched, setTouched] = useState(false);

  const tagError = !SEMVER.test(tag.trim())
    ? "Use a version like v1.3.0 or v1.3.0-rc.1."
    : existing.includes(tag.trim())
      ? `${tag.trim()} already exists.`
      : null;

  function generateNotes() {
    setNotes(draftNotes({ latestVersion, commits: since, files }));
  }

  async function publish(draft: boolean) {
    setTouched(true);
    if (tagError || pending) {
      document.getElementById("release-tag")?.focus();
      return;
    }
    if (live) {
      setPending(true);
      const result = await createReleaseAction(owner, repo, { tag: tag.trim(), target, title: title.trim() || tag.trim(), notes: notes.trim(), prerelease });
      setPending(false);
      if (!result.ok) {
        notify.error("Couldn’t publish the release", { description: result.error });
        return;
      }
    }
    notify.success(draft ? `Saved ${tag.trim()} as a draft` : `Published ${tag.trim()}`, {
      description: draft ? "Only collaborators can see drafts." : "Checksums and the Merkle root are pinned to this release.",
    });
    router.push(`${base}/releases`);
  }

  return (
    <>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void publish(false);
        }}
        className="mx-auto grid grid-cols-1 w-full gap-8 px-4 sm:px-6 py-6 lg:w-[70%] lg:px-0 lg:grid-cols-[1fr_300px]"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <h1 className="text-xl font-semibold">Draft a release</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              A release is an immutable, citable snapshot of the whole dataset.{latestVersion ? ` The latest is ${latestVersion}.` : " This will be the first one."}
            </p>
          </div>

          <FieldGroup>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field data-invalid={touched && tagError ? true : undefined}>
                <FieldLabel htmlFor="release-tag">Tag</FieldLabel>
                <div className="relative">
                  <Tag className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    id="release-tag"
                    value={tag}
                    onChange={(e) => setTag(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={touched && !!tagError}
                    spellCheck={false}
                    autoComplete="off"
                    className="pl-8 font-mono"
                  />
                </div>
                {touched && tagError ? <FieldError>{tagError}</FieldError> : <FieldDescription>Semantic version. Bump the minor for new data.</FieldDescription>}
              </Field>
              <Field>
                <FieldLabel>Target</FieldLabel>
                <Select value={target} onValueChange={(v) => v && setTarget(String(v))}>
                  <SelectTrigger className="w-full font-mono" aria-label="Target branch">
                    <GitBranch className="size-3.5" aria-hidden />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="w-full">
                    <SelectGroup>
                      {branches.map((b) => (
                        <SelectItem key={b} value={b} className="font-mono">
                          {b}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>The release points at this branch’s latest commit.</FieldDescription>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="release-title">Title</FieldLabel>
              <Input
                id="release-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={`e.g. Chalakudy basin model ${tag || "v1.3.0"}: recalibrated floodplain…`}
              />
            </Field>

            <Field>
              <div className="flex items-center justify-between gap-2">
                <FieldLabel htmlFor="release-notes">Release notes</FieldLabel>
                <Button type="button" variant="ghost" size="xs" onClick={generateNotes}>
                  <Sparkles data-icon="inline-start" />
                  Generate from commits
                </Button>
              </div>
              <Textarea
                id="release-notes"
                rows={10}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="What changed in the data and the model, and whether results differ from the previous release."
                className="font-mono text-xs leading-relaxed"
              />
            </Field>

            <Field orientation="horizontal">
              <Checkbox id="prerelease" checked={prerelease} onCheckedChange={(v) => setPrerelease(Boolean(v))} />
              <div className="flex flex-col">
                <FieldLabel htmlFor="prerelease" className="font-normal">Mark as a pre-release</FieldLabel>
                <FieldDescription>For calibration candidates that shouldn’t be cited yet.</FieldDescription>
              </div>
            </Field>
          </FieldGroup>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" href={`${base}/releases`}>
              Cancel
            </Button>
            {!live && (
              <Button type="button" variant="outline" onClick={() => void publish(true)}>
                Save draft
              </Button>
            )}
            <Button type="submit" loading={pending} disabled={pending}>
              <Tag data-icon="inline-start" />
              Publish release
            </Button>
          </div>
        </div>

        <aside className="flex flex-col gap-3 text-sm lg:pt-14">
          <div className="flex flex-col gap-2 border border-border bg-card p-4">
            <p className="flex items-center gap-2 font-medium">
              <Lock className="size-4 text-muted-foreground" aria-hidden />
              Pinned on publish
            </p>
            <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
              <li>SHA-256 checksum for every file</li>
              <li>Merkle root of the whole snapshot</li>
              {live ? <li>The commit it points at, forever</li> : <li>A DOI-ready citation</li>}
            </ul>
            <Badge variant="outline" className="w-fit text-[10px]">Releases can’t be edited after publishing</Badge>
          </div>
        </aside>
      </form>
    </>
  );
}
