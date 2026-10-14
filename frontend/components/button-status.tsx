"use client";

// What an action reports back: a small note at the bottom right of the window. While an action runs,
// the button that started it shows three blinking dots inside itself (components/ui/button.tsx);
// when it ends, the result appears here and fades after a few seconds.
//
//   notify.success("Saved");
//   notify.error("Couldn’t save", { description: reason });
//   notify.success("Marked as done", { action: { label: "Undo", onClick } });

import * as React from "react";
import { Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Kind = "success" | "error" | "info";
type Options = { description?: string; action?: { label: string; onClick: () => void }; duration?: number };
type Entry = { id: number; kind: Kind; message: string; options: Options };

let current: Entry | null = null;
let counter = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function show(kind: Kind, message: string, options: Options = {}) {
  current = { id: ++counter, kind, message, options };
  emit();
  return current.id;
}

export const notify = Object.assign((message: string, options?: Options) => show("info", message, options), {
  success: (message: string, options?: Options) => show("success", message, options),
  error: (message: string, options?: Options) => show("error", message, options),
  info: (message: string, options?: Options) => show("info", message, options),
  dismiss: () => {
    current = null;
    emit();
  },
});

export function ButtonStatusHost() {
  const entry = React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => current,
    () => null,
  );
  return entry ? <Note key={entry.id} entry={entry} /> : null;
}

function Note({ entry }: { entry: Entry }) {
  React.useEffect(() => {
    const life = entry.options.duration ?? (entry.options.action ? 9000 : entry.kind === "error" ? 7000 : 4000);
    const hide = setTimeout(() => entry === current && notify.dismiss(), life);
    return () => clearTimeout(hide);
  }, [entry]);

  const Icon = entry.kind === "success" ? Check : entry.kind === "error" ? X : Info;
  return (
    <div
      data-button-status={entry.kind}
      data-radius="control"
      role={entry.kind === "error" ? "alert" : "status"}
      aria-live={entry.kind === "error" ? "assertive" : "polite"}
      className="fixed bottom-6 right-6 z-[100] flex max-w-sm min-w-0 items-start gap-2.5 border border-border bg-popover px-4 py-3 text-sm text-popover-foreground shadow-lg max-sm:left-4 max-sm:right-4 max-sm:max-w-none"
    >
      <Icon className={cn("mt-0.5 size-4 shrink-0", entry.kind === "success" && "text-chart-1", entry.kind === "error" && "text-destructive", entry.kind === "info" && "text-muted-foreground")} aria-hidden />
      <div className="min-w-0">
        <p className="font-medium text-pretty">{entry.message}</p>
        {entry.options.description && <p className="mt-0.5 text-xs text-muted-foreground text-pretty">{entry.options.description}</p>}
      </div>
      {entry.options.action && (
        <button
          type="button"
          className="ml-2 shrink-0 cursor-pointer text-xs font-medium underline underline-offset-2 hover:text-foreground"
          onClick={() => {
            entry.options.action!.onClick();
            notify.dismiss();
          }}
        >
          {entry.options.action.label}
        </button>
      )}
    </div>
  );
}
