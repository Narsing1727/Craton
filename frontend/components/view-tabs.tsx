"use client";

// Two or three ways to look at one file (formatted and source, outline and text) as a row of buttons above the panel. The panels are drawn on
// the server and passed in; only the choice is made here, and it is kept in the address (#view=…) so a link opens the same way.

import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function ViewTabs({ tabs, label = "View" }: { tabs: { id: string; label: string; node: ReactNode }[]; label?: string }) {
  const [active, setActive] = useState(tabs[0].id);
  useEffect(() => {
    const want = new URLSearchParams(window.location.hash.slice(1)).get("view");
    if (want && tabs.some((t) => t.id === want)) setActive(want);
    // The first render matches the server's; the address is read once, after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const choose = (id: string) => {
    setActive(id);
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#view=${id}`);
    } catch {}
  };
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-1 border-b border-border p-3 text-xs" role="group" aria-label={label}>
        {tabs.map((t) => (
          <Button key={t.id} type="button" size="sm" variant={t.id === current.id ? "default" : "ghost"} aria-pressed={t.id === current.id} onClick={() => choose(t.id)}>
            {t.label}
          </Button>
        ))}
      </div>
      {current.node}
    </div>
  );
}
