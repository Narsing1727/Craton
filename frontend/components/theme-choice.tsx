"use client";

// Settings → Appearance: Darker (the default; one near-black surface everywhere) or Standard (Craton's dark grey).

import * as React from "react";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { applyTheme, readTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const CHOICES: { id: Theme; name: string; about: string; page: string; card: string; line: string }[] = [
  { id: "darker", name: "Darker", about: "Near-black everywhere, like GitHub and Vercel. The default.", page: "oklch(0.145 0 0)", card: "oklch(0.205 0 0)", line: "oklch(0.29 0 0)" },
  { id: "standard", name: "Standard", about: "Craton’s dark grey.", page: "oklch(0.2138 0.0019 286.2347)", card: "oklch(0.2686 0 0)", line: "oklch(0.3250 0 0)" },
];

export function ThemeChoice() {
  const [theme, setTheme] = React.useState<Theme>("darker");
  React.useEffect(() => setTheme(readTheme()), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>How Craton looks in this browser.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CHOICES.map((c) => {
            const on = theme === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setTheme(c.id);
                  applyTheme(c.id);
                }}
                className={cn("flex cursor-pointer flex-col gap-3 border p-3 text-left transition-colors", on ? "border-foreground" : "border-border hover:border-foreground/40")}
              >
                <span className="flex h-20 flex-col gap-1.5 border p-2" style={{ background: c.page, borderColor: c.line }} aria-hidden>
                  <span className="h-2 w-1/3" style={{ background: c.line }} />
                  <span className="flex-1" style={{ background: c.card }} />
                </span>
                <span className="flex items-start justify-between gap-2">
                  <span>
                    <span className="block text-sm font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">{c.about}</span>
                  </span>
                  {on && <Check className="mt-0.5 size-4 shrink-0" aria-hidden />}
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
