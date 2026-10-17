"use client";

// Settings → Units: metres or feet for elevations and elevation change, and cubic metres or acre-feet for volume.
// The data itself is never converted on the server; only what is shown.

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/button-status";
import { setUnitsAction } from "@/app/actions";
import { useUnits } from "@/components/units";
import type { UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";

const CHOICES: { id: UnitSystem; name: string; about: string; sample: string }[] = [
  { id: "metric", name: "Metric", about: "Metres and cubic metres.", sample: "+0.35 m · −43,010 m³" },
  { id: "imperial", name: "Imperial", about: "Feet and acre-feet, as US hydrology reports them.", sample: "+1.15 ft · −34.9 acre-ft" },
];

export function UnitsChoice() {
  const units = useUnits();
  const router = useRouter();
  const [pending, start] = useTransition();

  function choose(next: UnitSystem) {
    if (next === units || pending) return;
    start(async () => {
      const r = await setUnitsAction(next);
      if (!r.ok) return void notify.error("Couldn’t save your units");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Units</CardTitle>
        <CardDescription>How elevations, elevation change and volumes are shown. Files and downloads are never converted.</CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Units" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CHOICES.map((c) => {
            const on = units === c.id;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={pending}
                onClick={() => choose(c.id)}
                className={cn("flex cursor-pointer items-start justify-between gap-2 border p-3 text-left transition-colors disabled:cursor-wait", on ? "border-foreground" : "border-border hover:border-foreground/40")}
              >
                <span>
                  <span className="block text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">{c.about}</span>
                  <span className="mt-2 block font-mono text-xs tabular-nums text-muted-foreground">{c.sample}</span>
                </span>
                {on && <Check className="mt-0.5 size-4 shrink-0" aria-hidden />}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
