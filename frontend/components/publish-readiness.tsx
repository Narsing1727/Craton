"use client";

// A short checklist of what this repository still lacks before it describes itself well. Shown to people who can
// write to the repository, and only while something is missing.

import Link from "next/link";
import { Check } from "lucide-react";
import { useCanWrite } from "@/components/repo-context";
import { repoCompleteness, type CompletenessInput } from "@/lib/completeness";

export function PublishReadiness({ base, input }: { base: string; input: CompletenessInput }) {
  const canWrite = useCanWrite();
  const c = repoCompleteness(input);
  if (!canWrite || c.done === c.total) return null;
  const missing = c.items.filter((i) => !i.done);
  return (
    <section aria-labelledby="readiness-title">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="readiness-title" className="text-sm font-medium">Describe this data</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{c.done} of {c.total}</span>
      </div>
      <div className="mb-3 h-1 w-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.percent} aria-label="Repository description complete">
        <div className="h-full bg-primary" style={{ width: `${c.percent}%` }} />
      </div>
      <ul className="flex flex-col gap-2 text-sm">
        {missing.map((i) => (
          <li key={i.id} className="flex flex-col">
            <Link href={`${base}/${i.where}`} className="hover:underline">{i.label}</Link>
            <span className="text-xs text-muted-foreground">{i.hint}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Check className="size-3" aria-hidden /> {c.done} already in place
      </p>
    </section>
  );
}
