"use client";

// Settings → Code owners: edit the CODEOWNERS file in the browser, see what it would do (the server checks each name
// and counts the files each person would own), and save it as a commit on the default branch.

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/button-status";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { previewOwnersAction } from "@/app/actions";
import type { ApiOwnersPreview } from "@/lib/api";

export function CodeOwnersCard({ owner, repo, initial, branch, head, canWrite }: { owner: string; repo: string; initial: string; branch: string; head?: string; canWrite: boolean }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [preview, setPreview] = useState<ApiOwnersPreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const seq = useRef(0);

  // Check the text a moment after typing stops.
  useEffect(() => {
    if (!canWrite) return;
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      const r = await previewOwnersAction(owner, repo, text);
      if (mine !== seq.current) return;
      if (r.ok) {
        setPreview(r.data);
        setProblem(null);
      } else setProblem(r.error);
    }, 400);
    return () => clearTimeout(t);
  }, [text, owner, repo, canWrite]);

  function save() {
    startSave(async () => {
      const form = new FormData();
      form.append("file", new File([text], "CODEOWNERS", { type: "text/plain" }), "CODEOWNERS");
      form.append("paths", JSON.stringify(["CODEOWNERS"]));
      form.append("folder", "");
      form.append("branch", branch);
      form.append("message", "Update CODEOWNERS");
      if (head && /^[0-9a-f]{64}$/.test(head)) form.append("expected", head);
      const res = await fetch(`/${owner}/${repo}/upload`, { method: "POST", body: form });
      if (!res.ok) {
        let message = "Couldn’t save CODEOWNERS.";
        try {
          message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
        } catch {}
        return void notify.error("CODEOWNERS wasn’t saved", { description: message });
      }
      setSaved(text);
      notify.success("CODEOWNERS saved", { description: `Committed to ${branch}. New pull requests ask these people to review.` });
      router.refresh();
    });
  }

  const problems = preview?.people.filter((p) => p.problem) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Code owners</CardTitle>
        <CardDescription>
          Who should review a change to which files. One rule per line, a path pattern then one or more people; the last matching line wins. A new pull request asks the owners of the files it changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          spellCheck={false}
          disabled={!canWrite}
          aria-label="CODEOWNERS"
          placeholder={"terrain/**   @alice @bob\n*.shp         @carol\ngauges.csv    @bob"}
          className="font-mono text-xs"
        />
        {problem && <p className="text-xs text-destructive">{problem}</p>}
        {preview && (
          <div className="flex flex-col gap-2 border border-border p-3 text-xs" aria-live="polite">
            <p className="text-muted-foreground tabular-nums">
              {preview.rules} {preview.rules === 1 ? "rule" : "rules"} · {preview.owned} of {preview.files} files have an owner
              {preview.unowned > 0 ? `, ${preview.unowned} have none` : ""}
            </p>
            {preview.people.length > 0 && (
              <ul className="flex flex-col gap-1">
                {preview.people.map((p) => (
                  <li key={p.handle} className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono">@{p.handle}</span>
                    <span className="tabular-nums text-muted-foreground">{p.files} {p.files === 1 ? "file" : "files"}</span>
                    {p.problem && <span className="text-destructive">{p.problem}</span>}
                  </li>
                ))}
              </ul>
            )}
            {preview.unownedSample.length > 0 && <p className="text-muted-foreground">No owner: <span className="font-mono">{preview.unownedSample.join(", ")}</span>{preview.unowned > preview.unownedSample.length ? " …" : ""}</p>}
            {preview.skipped.map((s) => (
              <p key={s.line} className="text-destructive">Line {s.line} isn’t a rule (a pattern, then @names): <span className="font-mono">{s.text}</span></p>
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex flex-wrap items-center gap-3 border-t border-border">
        <Button size="sm" onClick={save} loading={saving} disabled={!canWrite || saving || text === saved}>
          Save as a commit on {branch}
        </Button>
        {problems.length > 0 && <span className="text-xs text-muted-foreground">{problems.length} {problems.length === 1 ? "name needs" : "names need"} attention; they will be skipped.</span>}
      </CardFooter>
    </Card>
  );
}
