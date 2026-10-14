"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleDot, FileText } from "lucide-react";
import { notify } from "@/components/button-status";
import { labelStyles } from "@/components/work-lists";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Issue } from "@/lib/data";
import { useRepoSummary } from "@/components/repo-context";
import { useSession } from "@/components/session";
import { SignInPrompt } from "@/components/sign-in-prompt";
import { createIssueAction } from "@/app/actions";
import type { ApiIssueTemplate } from "@/lib/api";
import { cn } from "@/lib/utils";

const dataQualityTemplate = `Affected file:
CRS / datum:

What I expected:

What I see instead:

How to reproduce (tool and version):`;

const labels: Issue["label"][] = ["data-quality", "bug", "enhancement", "question"];

export function NewIssueForm({ owner, repo, milestones, templates }: { owner: string; repo: string; milestones: string[]; templates: ApiIssueTemplate[] }) {
  const router = useRouter();
  const base = `/${owner}/${repo}`;
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [file, setFile] = useState("");
  const [mode, setMode] = useState("write");
  const [label, setLabel] = useState<Issue["label"]>("data-quality");
  const me = useSession()?.handle ?? null;
  const [assignee, setAssignee] = useState(me ?? "none");
  const [milestone, setMilestone] = useState("none");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const live = useRepoSummary()?.live ?? false;
  const titleError = !title.trim() ? "Give the issue a short, specific title." : null;

  async function submit() {
    setTouched(true);
    if (titleError || pending) {
      document.getElementById("issue-title")?.focus();
      return;
    }
    if (!live) {
      notify.success("Issue opened", { description: title.trim() });
      router.push(`${base}/issues`);
      return;
    }
    setPending(true);
    const result = await createIssueAction(owner, repo, {
      title: title.trim(),
      body: body.trim(),
      label,
      file: file.trim() || null,
      assignee: assignee === "none" ? null : assignee,
      milestone: milestone === "none" ? null : milestone,
    });
    setPending(false);
    if (!result.ok) {
      notify.error("Couldn’t open the issue", { description: result.error });
      return;
    }
    notify.success(`Opened #${result.data.number}`, { description: title.trim() });
    router.push(`${base}/issues/${result.data.number}`);
  }

  if (live && !me) {
    return (
      <div className="w-full max-w-3xl px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <h1 className="mb-4 text-xl font-semibold">New issue</h1>
        <SignInPrompt action="open an issue" />
      </div>
    );
  }

  return (
    <form
      noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="mx-auto grid grid-cols-1 w-full gap-8 px-4 sm:px-6 py-6 lg:w-[70%] lg:px-0 lg:grid-cols-[1fr_300px]"
      >
        <div className="flex min-w-0 flex-col gap-5">
          <div>
            <h1 className="text-xl font-semibold">New issue</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Report a data-quality problem, ask a question, or request a change.</p>
          </div>

          <FieldGroup>
            <Field data-invalid={touched && titleError ? true : undefined}>
              <FieldLabel htmlFor="issue-title">Title</FieldLabel>
              <Input
                id="issue-title"
                placeholder="e.g. Projection mismatch in catchment.shp near the confluence…"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-invalid={touched && !!titleError}
                className="h-10 text-base"
                autoFocus
              />
              {touched && titleError && <FieldError>{titleError}</FieldError>}
            </Field>

            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor="issue-body">Description</FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  {!body &&
                    (templates.length > 0 ? (
                      templates.map((t) => (
                        <Button
                          key={t.file}
                          type="button"
                          variant="ghost"
                          size="xs"
                          title={t.about || undefined}
                          onClick={() => {
                            setBody(t.body);
                            if (t.label) setLabel(t.label);
                          }}
                        >
                          <FileText data-icon="inline-start" />
                          Use template: {t.name}
                        </Button>
                      ))
                    ) : (
                      label === "data-quality" && (
                        <Button type="button" variant="ghost" size="xs" onClick={() => setBody(dataQualityTemplate)}>
                          <FileText data-icon="inline-start" />
                          Use data-quality template
                        </Button>
                      )
                    ))}
                  <ToggleGroup variant="outline" size="sm" spacing={0} value={[mode]} onValueChange={(v) => v[0] && setMode(v[0])} aria-label="Editor mode">
                    <ToggleGroupItem value="write">Write</ToggleGroupItem>
                    <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
                  </ToggleGroup>
                </div>
              </div>
              {mode === "write" ? (
                <Textarea
                  id="issue-body"
                  rows={12}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  placeholder="What happened, where, and how to reproduce it. Paste CRS details, gauge readings or file paths."
                  className="font-mono text-xs leading-relaxed"
                />
              ) : (
                <div className="min-h-64 border border-border bg-muted/10 p-3 text-sm whitespace-pre-wrap text-muted-foreground">
                  {body || <span className="italic">Nothing to preview yet.</span>}
                </div>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="issue-file">Affected file <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel>
              <Input
                id="issue-file"
                value={file}
                onChange={(e) => setFile(e.target.value)}
                placeholder="terrain/basin_dem.tif"
                className="font-mono"
                spellCheck={false}
                autoComplete="off"
              />
              <FieldDescription>Linked from the issue so reviewers can open the file and its history.</FieldDescription>
            </Field>
          </FieldGroup>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Kbd>Ctrl</Kbd>
              <Kbd>Enter</Kbd> to submit
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" href={`${base}/issues`}>
                Cancel
              </Button>
              <Button type="submit" loading={pending} disabled={pending}>
                <CircleDot data-icon="inline-start" />
                Open issue
              </Button>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-5 text-sm lg:pt-14">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-muted-foreground">Label</span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Label">
              {labels.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={label === l}
                  onClick={() => setLabel(l)}
                  className={cn(
                    "border px-2 py-0.5 text-xs transition-colors cursor-pointer",
                    labelStyles[l],
                    label === l ? "ring-1 ring-foreground/60" : "border-border bg-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>
          <Field>
            <FieldLabel className="text-xs font-medium text-muted-foreground">Assignee</FieldLabel>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger className="w-full" aria-label="Assignee">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="w-full">
                <SelectGroup>
                  {me && <SelectItem value={me}>{me} (you)</SelectItem>}
                  <SelectItem value="none">No one</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {milestones.length > 0 && (
            <Field>
              <FieldLabel className="text-xs font-medium text-muted-foreground">Milestone</FieldLabel>
              <Select value={milestone} onValueChange={setMilestone}>
                <SelectTrigger className="w-full" aria-label="Milestone">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="w-full">
                  <SelectGroup>
                    <SelectItem value="none">No milestone</SelectItem>
                    {milestones.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          )}
        </aside>
    </form>
  );
}
