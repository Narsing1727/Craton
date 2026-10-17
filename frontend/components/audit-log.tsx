"use client";

import { useState, useTransition } from "react";
import { Download, KeyRound, Monitor, ShieldX } from "lucide-react";
import { notify } from "@/components/button-status";
import { auditPageAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { ApiAuditEvent, ApiAuditPage, AuditScope } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/** What someone changed, or tried to change and was refused: for owners and administrators. Never shows what was in a request. */
export function AuditLog({ scope, initial, csvHref }: { scope: AuditScope; initial: ApiAuditPage; csvHref: string | null }) {
  const [events, setEvents] = useState<ApiAuditEvent[]>(initial.events);
  const [next, setNext] = useState<number | null>(initial.next);
  const [outcome, setOutcome] = useState<"all" | "denied">("all");
  const [actor, setActor] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function load(filters: { outcome: "all" | "denied"; actor: string }, more: boolean) {
    start(async () => {
      setError(null);
      const r = await auditPageAction(scope, { actor: filters.actor.trim() || undefined, outcome: filters.outcome === "denied" ? "denied" : undefined, before: more && next ? next : undefined });
      if (!r.ok) {
        setError(r.error);
        return void notify.error("Couldn’t load the audit log", { description: r.error });
      }
      setEvents(more ? [...events, ...r.events] : r.events);
      setNext(r.next);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            value={[outcome]}
            onValueChange={(v) => {
              const o = (v[0] as "all" | "denied" | undefined) ?? outcome;
              setOutcome(o);
              load({ outcome: o, actor }, false);
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Outcome"
          >
            <ToggleGroupItem value="all">Everything</ToggleGroupItem>
            <ToggleGroupItem value="denied">Refused only</ToggleGroupItem>
          </ToggleGroup>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              load({ outcome, actor }, false);
            }}
          >
            <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Filter by person…" aria-label="Filter by person" className="h-8 w-44" autoComplete="off" spellCheck={false} />
          </form>
        </div>
        {csvHref && (
          <a href={csvHref} download className="inline-flex h-8 items-center gap-1.5 border border-border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted">
            <Download className="size-4" aria-hidden />
            Download CSV
          </a>
        )}
      </div>

      {events.length === 0 ? (
        <p className="border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          {outcome === "denied" || actor ? "Nothing matches these filters." : "Nothing has been recorded yet. Changes made from now on, and attempts that were refused, appear here."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border border border-border bg-card" aria-label="Audit log">
          {events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="text-pretty">
                  <span className="font-medium">{e.actor ?? "Someone"}</span> <span className={cn(e.outcome === "denied" && "text-destructive")}>{e.outcome === "denied" ? `was refused: ${e.action.toLowerCase()}` : e.action.charAt(0).toLowerCase() + e.action.slice(1)}</span>
                  {e.repo && (
                    <>
                      {" "}
                      <span className="text-muted-foreground">in</span> <span className="font-mono text-xs">{e.owner ? `${e.owner}/` : ""}{e.repo}</span>
                    </>
                  )}
                </p>
                {Object.keys(e.params).length > 0 && (
                  <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">
                    {Object.entries(e.params)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" · ")}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                {e.outcome === "denied" && (
                  <Badge variant="outline" className="gap-1">
                    <ShieldX aria-hidden /> {e.status}
                  </Badge>
                )}
                {e.via === "token" ? <KeyRound className="size-3.5" aria-label="made with an access token" /> : e.via === "browser" ? <Monitor className="size-3.5" aria-label="made in the browser" /> : null}
                {e.ip && <span className="font-mono">{e.ip}</span>}
                <time dateTime={e.at} title={e.at}>
                  {timeAgo(e.at)}
                </time>
              </div>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {next !== null && (
        <Button variant="outline" size="sm" className="self-start" onClick={() => load({ outcome, actor }, true)} loading={pending} disabled={pending}>
          Load older
        </Button>
      )}
    </div>
  );
}
