"use client";

// Settings → Preferences: the visibility a new repository starts with. Saved on the account, so it follows the person to
// every browser, the CLI and the API (a create request that does not say gets this).

import { useState, useTransition } from "react";
import { notify } from "@/components/button-status";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { saveProfileAction } from "@/app/auth-actions";
import { cn } from "@/lib/utils";

const CHOICES = [
  { id: "public", name: "Public", about: "Anyone can see it. A confirmed email is needed to publish." },
  { id: "private", name: "Private", about: "Only you and the people you share it with. Needs a plan with private repositories." },
] as const;

export function NewRepoDefaults({ initial, live }: { initial: "public" | "private"; live: boolean }) {
  const [value, setValue] = useState(initial);
  const [saving, startSave] = useTransition();
  function choose(next: "public" | "private") {
    if (next === value || saving) return;
    if (!live) return void notify.info("Demo mode: nothing is saved.");
    const before = value;
    setValue(next);
    startSave(async () => {
      const result = await saveProfileAction({ defaultVisibility: next });
      if (!result.ok) {
        setValue(before);
        notify.error("Couldn’t save that", { description: result.error });
      }
    });
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>New repositories</CardTitle>
        <CardDescription>What a repository starts as. You can still choose each time you create one.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Default visibility" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CHOICES.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={value === c.id}
              onClick={() => choose(c.id)}
              className={cn("flex cursor-pointer flex-col gap-1 border p-3 text-left transition-colors", value === c.id ? "border-foreground" : "border-border hover:border-foreground/40")}
            >
              <span className="text-sm font-medium">{c.name}</span>
              <span className="text-xs text-muted-foreground">{c.about}</span>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
