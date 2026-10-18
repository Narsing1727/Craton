"use client";

// Edit what a table's columns (or a shapefile's fields) mean, in the browser, and save it as a commit of
// `.craton-dictionary.json` on the branch being viewed. Same route as the upload dialog; the head commit is sent so
// a change made meanwhile is refused instead of overwritten.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/button-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DICTIONARY_FILE, parseDictionary, withEdits, type DictEntry } from "@/lib/dictionary";

export function DictionaryEditor({ owner, repo, path, columns, currentText, branch, head }: { owner: string; repo: string; path: string; columns: string[]; currentText: string; branch: string; head?: string }) {
  const router = useRouter();
  const known = parseDictionary(currentText)[path] ?? {};
  const [edits, setEdits] = useState<Record<string, DictEntry>>(() => Object.fromEntries(columns.map((c) => [c, { description: known[c]?.description ?? "", unit: known[c]?.unit ?? "" }])));
  const [saving, startSave] = useTransition();
  const changed = columns.some((c) => (edits[c]?.description ?? "") !== (known[c]?.description ?? "") || (edits[c]?.unit ?? "") !== (known[c]?.unit ?? ""));

  function set(column: string, field: keyof DictEntry, value: string) {
    setEdits((e) => ({ ...e, [column]: { ...e[column], [field]: value } }));
  }

  function save() {
    startSave(async () => {
      const text = withEdits(parseDictionary(currentText), path, columns, edits);
      const form = new FormData();
      form.append("file", new File([text], DICTIONARY_FILE, { type: "application/json" }), DICTIONARY_FILE);
      form.append("paths", JSON.stringify([DICTIONARY_FILE]));
      form.append("folder", "");
      form.append("branch", branch);
      form.append("message", `Describe the columns of ${path}`);
      if (head && /^[0-9a-f]{64}$/.test(head)) form.append("expected", head);
      const res = await fetch(`/${owner}/${repo}/upload`, { method: "POST", body: form });
      if (!res.ok) {
        let message = "Couldn’t save the dictionary.";
        try {
          message = ((await res.json()) as { error?: { message?: string } }).error?.message ?? message;
        } catch {}
        return void notify.error("The dictionary wasn’t saved", { description: message });
      }
      notify.success("Dictionary saved", { description: `Committed to ${branch}.` });
      router.refresh();
    });
  }

  return (
    <details className="border border-border bg-card">
      <summary className="cursor-pointer px-3 py-2 text-sm hover:bg-muted/40">Edit descriptions</summary>
      <div className="flex flex-col gap-3 border-t border-border p-3">
        <ul className="flex flex-col gap-2">
          {columns.map((c) => (
            <li key={c} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[12rem_6rem_1fr]">
              <span className="truncate font-mono text-xs">{c}</span>
              <Input aria-label={`Unit of ${c}`} placeholder="Unit" value={edits[c]?.unit ?? ""} onChange={(e) => set(c, "unit", e.target.value)} maxLength={40} className="h-8 text-xs" />
              <Input aria-label={`Meaning of ${c}`} placeholder="What it means" value={edits[c]?.description ?? ""} onChange={(e) => set(c, "description", e.target.value)} maxLength={500} className="h-8 text-xs" />
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button size="sm" onClick={save} loading={saving} disabled={saving || !changed}>
            Save as a commit on {branch}
          </Button>
          <span className="text-xs text-muted-foreground">Writes {DICTIONARY_FILE} at the repository root.</span>
        </div>
      </div>
    </details>
  );
}
