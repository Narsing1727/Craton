"use client";

// Settings → Preferences, the two that belong to this browser (like the theme): less motion and single-key shortcuts.

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { readReduceMotion, setReduceMotion, setShortcutsOn, shortcutsOn } from "@/lib/prefs";

export function BrowserPreferences() {
  const [motion, setMotion] = useState(false);
  const [keys, setKeys] = useState(true);
  useEffect(() => {
    setMotion(readReduceMotion());
    setKeys(shortcutsOn());
  }, []);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Accessibility and keyboard</CardTitle>
        <CardDescription>These apply in this browser only.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y divide-border">
        <label className="flex cursor-pointer items-center justify-between gap-6 py-3 first:pt-0">
          <span className="text-sm">
            <span className="block font-medium">Reduce motion</span>
            <span className="mt-0.5 block text-muted-foreground">No transitions or looping animation. Already on if your system asks for less motion.</span>
          </span>
          <Switch
            checked={motion}
            onCheckedChange={(v) => {
              setMotion(Boolean(v));
              setReduceMotion(Boolean(v));
            }}
            aria-label="Reduce motion"
          />
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-6 py-3 last:pb-0">
          <span className="text-sm">
            <span className="block font-medium">Single-key shortcuts</span>
            <span className="mt-0.5 block text-muted-foreground">Press ? for the list (g then d, j and k, t, /). Turn them off if they clash with a screen reader or your habits; Ctrl or ⌘ K keeps working.</span>
          </span>
          <Switch
            checked={keys}
            onCheckedChange={(v) => {
              setKeys(Boolean(v));
              setShortcutsOn(Boolean(v));
            }}
            aria-label="Single-key shortcuts"
          />
        </label>
      </CardContent>
    </Card>
  );
}
