"use client";

// Getting-started checklist on the dashboard. Every item is checked by the API from what the
// person has actually done, and each links to where they do it. It can be hidden per browser.

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Check, PartyPopper, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type ChecklistStep = { id: string; title: string; body: string; href: string; cta: string; done: boolean };

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener("craton:checklist", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("craton:checklist", cb);
  };
};

function readHidden(key: string) {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function GettingStarted({ handle, steps }: { handle: string; steps: ChecklistStep[] }) {
  const key = `craton:getting-started:${handle}`;
  const hidden = useSyncExternalStore(subscribe, () => readHidden(key), () => false);
  const done = steps.filter((s) => s.done).length;
  const complete = done === steps.length;
  const nextStep = steps.find((s) => !s.done);

  function hide() {
    try {
      localStorage.setItem(key, "1");
    } catch {}
    window.dispatchEvent(new Event("craton:checklist"));
  }

  if (hidden) return null;

  return (
    <section aria-labelledby="getting-started" className="border border-border bg-card">
      <div className="flex items-start justify-between gap-4 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="getting-started" className="flex items-center gap-2 text-sm font-semibold">
            {complete && <PartyPopper className="size-4 text-chart-1" aria-hidden />}
            {complete ? "You're set up" : "Get started with Craton"}
          </h2>
          <p className="text-xs text-muted-foreground text-pretty">
            {complete
              ? "Your data is versioned, checked on every push, and only changed chunks ever move. Nice work."
              : "Five steps from sign-up to your first verified push. Each one checks itself off."}
          </p>
        </div>
        <button type="button" onClick={hide} className="flex size-7 shrink-0 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer" aria-label="Hide getting started">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      <div className="flex items-center gap-3 px-4 pt-3">
        <Progress value={(done / steps.length) * 100} aria-label={`${done} of ${steps.length} steps done`} className="flex-1" />
        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
          {done}/{steps.length}
        </span>
      </div>
      <ol className="flex flex-col py-2">
        {steps.map((s) => {
          const isNext = s.id === nextStep?.id;
          return (
            <li key={s.id} className={cn("flex items-start gap-3 px-4 py-2.5", isNext && "bg-muted/30")}>
              <span
                className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center border", s.done ? "border-chart-1 bg-chart-1 text-background" : "border-border")}
                aria-hidden
              >
                {s.done && <Check className="size-3" />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn("text-sm", s.done ? "text-muted-foreground line-through decoration-muted-foreground/50" : "font-medium")}>
                  {s.title}
                  <span className="sr-only">{s.done ? " (done)" : ""}</span>
                </span>
                {!s.done && <span className="text-xs text-muted-foreground text-pretty">{s.body}</span>}
              </div>
              {!s.done && (
                <Link
                  href={s.href}
                  className={cn(
                    "flex shrink-0 items-center gap-1 px-2.5 py-1 text-xs font-medium transition-colors",
                    isNext ? "bg-foreground text-background hover:bg-foreground/90" : "border border-border hover:bg-muted",
                  )}
                >
                  {s.cta}
                  <ArrowRight className="size-3" aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
