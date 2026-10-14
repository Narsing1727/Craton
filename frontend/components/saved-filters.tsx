"use client";

// "Saved filters" for the issue and pull request lists: pick one to apply it, or name the current state,
// label and search and keep it. Kept on the account, so it follows the person between machines.

import * as React from "react";
import { Bookmark, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { notify } from "@/components/button-status";
import { deleteFilterAction, listFiltersAction, saveFilterAction } from "@/app/actions";
import { useSession } from "@/components/session";
import type { ApiSavedFilter } from "@/lib/api";

export type FilterValue = { state: string; label: string; q: string };

export function SavedFilters({ kind, current, onApply }: { kind: "issues" | "pulls"; current: FilterValue; onApply: (f: FilterValue) => void }) {
  const user = useSession();
  const [open, setOpen] = React.useState(false);
  const [list, setList] = React.useState<ApiSavedFilter[] | null>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (!open || list || !user) return;
    let cancelled = false;
    listFiltersAction(kind).then((r) => {
      if (!cancelled) setList(r.ok ? r.filters : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, list, user, kind]);

  if (!user) return null;
  const hasSomething = Boolean(current.q.trim() || current.label !== "all" || current.state !== "open");

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await saveFilterAction({ kind, name: name.trim(), state: current.state, label: current.label === "all" ? "" : current.label, q: current.q.trim() });
    setBusy(false);
    if (!r.ok) return void notify.error("Couldn’t save the filter", { description: r.error });
    setList((cur) => [...(cur ?? []).filter((f) => f.id !== r.data.id), r.data].sort((a, b) => a.name.localeCompare(b.name)));
    setName("");
    notify.success(`Saved “${r.data.name}”`);
  }

  async function remove(f: ApiSavedFilter) {
    const r = await deleteFilterAction(f.id);
    if (!r.ok) return void notify.error("Couldn’t delete the filter", { description: r.error });
    setList((cur) => (cur ?? []).filter((x) => x.id !== f.id));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" size="sm" />}>
        <Bookmark data-icon="inline-start" />
        Saved
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">Saved filters</p>
          {list === null ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : list.length === 0 ? (
            <p className="text-xs text-muted-foreground">None yet. Set a state, label or search below, then give it a name.</p>
          ) : (
            <ul className="flex flex-col">
              {list.map((f) => (
                <li key={f.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate px-1.5 py-1 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      onApply({ state: f.state || "open", label: f.label || "all", q: f.q });
                      setOpen(false);
                    }}
                    title={[f.state, f.label && `label:${f.label}`, f.q].filter(Boolean).join(" · ")}
                  >
                    {f.name}
                  </button>
                  <Button variant="ghost" size="icon-sm" aria-label={`Delete ${f.name}`} onClick={() => void remove(f)}>
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={save} className="flex gap-1.5 border-t border-border pt-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={hasSomething ? "Name this filter" : "Set a filter first"} maxLength={60} disabled={!hasSomething} aria-label="Filter name" className="h-8" />
            <Button type="submit" size="sm" disabled={!hasSomething || !name.trim() || busy} loading={busy}>
              Save
            </Button>
          </form>
        </div>
      </PopoverContent>
    </Popover>
  );
}
