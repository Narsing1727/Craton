"use client";

// A JSON document as a tree: objects and arrays fold, strings and numbers are set apart, and every node says how much is inside it.
// A GeoJSON file says what it holds (how many features, of which geometries) before the tree.

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (v: Json): v is { [key: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);

function Leaf({ value }: { value: Json }) {
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === "string") return <span className="break-words text-primary">&quot;{value.length > 300 ? `${value.slice(0, 300)}…` : value}&quot;</span>;
  if (typeof value === "number") return <span className="tabular-nums text-foreground">{String(value)}</span>;
  return <span className="text-foreground">{String(value)}</span>;
}

function Node({ name, value, depth, open }: { name: string | null; value: Json; depth: number; open: number }) {
  const folds = typeof value === "object" && value !== null;
  const [expanded, setExpanded] = useState(depth < open);
  // The parent's "expand all" and "collapse all" arrive as a new `open` depth; this node follows it.
  const [seen, setSeen] = useState(open);
  if (seen !== open) {
    setSeen(open);
    setExpanded(depth < open);
  }
  const label = name !== null && <span className="text-foreground">{name}<span className="text-muted-foreground">: </span></span>;
  if (!folds) {
    return (
      <li className="py-px pl-5">
        {label}
        <Leaf value={value} />
      </li>
    );
  }
  const entries = Array.isArray(value) ? value.map((v, i) => [String(i), v] as const) : Object.entries(value);
  const brackets = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
  return (
    <li className="py-px">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} className="flex w-full items-baseline gap-1 text-left hover:bg-muted/40">
        <ChevronRight className={cn("size-3.5 shrink-0 translate-y-0.5 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden />
        <span>
          {label}
          <span className="text-muted-foreground">
            {brackets[0]}
            {!expanded && ` ${entries.length.toLocaleString("en-US")} ${Array.isArray(value) ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "key" : "keys"} ${brackets[1]}`}
          </span>
        </span>
      </button>
      {expanded && (
        <>
          <ul className="ml-2 border-l border-border pl-3">
            {entries.slice(0, 500).map(([k, v]) => (
              <Node key={k} name={Array.isArray(value) ? `[${k}]` : k} value={v} depth={depth + 1} open={open} />
            ))}
            {entries.length > 500 && <li className="pl-5 text-muted-foreground">… {(entries.length - 500).toLocaleString("en-US")} more</li>}
          </ul>
          <span className="pl-5 text-muted-foreground">{brackets[1]}</span>
        </>
      )}
    </li>
  );
}

/** What a GeoJSON document holds, when it is one. */
function geoSummary(doc: Json): string | null {
  if (!isObject(doc) || typeof doc.type !== "string") return null;
  if (doc.type === "FeatureCollection" && Array.isArray(doc.features)) {
    const kinds = new Map<string, number>();
    for (const f of doc.features) if (isObject(f) && isObject(f.geometry as Json) && typeof (f.geometry as { type?: unknown }).type === "string") kinds.set((f.geometry as { type: string }).type, (kinds.get((f.geometry as { type: string }).type) ?? 0) + 1);
    return `GeoJSON · ${doc.features.length.toLocaleString("en-US")} features${kinds.size ? ` (${[...kinds].map(([k, n]) => `${n.toLocaleString("en-US")} ${k}`).join(", ")})` : ""}`;
  }
  if (["Feature", "Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"].includes(doc.type)) return `GeoJSON · ${doc.type}`;
  return null;
}

export function JsonViewer({ text }: { text: string }) {
  const parsed = useMemo<{ ok: true; value: Json } | { ok: false; error: string }>(() => {
    try {
      return { ok: true, value: JSON.parse(text) as Json };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }, [text]);
  const [open, setOpen] = useState(2);
  if (!parsed.ok) return <p className="px-4 py-3 text-xs text-muted-foreground text-pretty">This is not valid JSON ({parsed.error}); see the Source tab for the text.</p>;
  const summary = geoSummary(parsed.value);
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        {summary && <span className="font-medium">{summary}</span>}
        <span className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(99)}>Expand all</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(1)}>Collapse all</Button>
        </span>
      </div>
      <div tabIndex={0} role="tree" aria-label="JSON document" className="max-h-[36rem] overflow-auto p-3 font-mono text-xs leading-relaxed">
        <ul>
          <Node name={null} value={parsed.value} depth={0} open={open} />
        </ul>
      </div>
    </div>
  );
}
