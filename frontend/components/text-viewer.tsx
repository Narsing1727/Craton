"use client";

// A text file with line numbers: find in the file (highlighting the matches, or showing only the lines that match), wrap long lines, copy it
// all. A file of tens of thousands of lines is drawn a screenful at a time.

import { useMemo, useState } from "react";
import { Check, Copy, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PAGE = 1000;

function Highlighted({ line, query }: { line: string; query: string }) {
  if (!query) return <>{line}</>;
  const at = line.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return <>{line}</>;
  const parts: React.ReactNode[] = [];
  let from = 0;
  let k = 0;
  for (let i = at; i >= 0; i = line.toLowerCase().indexOf(query.toLowerCase(), from)) {
    if (i > from) parts.push(line.slice(from, i));
    parts.push(<mark key={k++} className="bg-primary/40 text-foreground">{line.slice(i, i + query.length)}</mark>);
    from = i + query.length;
  }
  parts.push(line.slice(from));
  return <>{parts}</>;
}

export function TextViewer({ text, note, jumpTo }: { text: string; note?: string | null; jumpTo?: number | null }) {
  const lines = useMemo(() => text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n"), [text]);
  const [query, setQuery] = useState("");
  const [only, setOnly] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [limit, setLimit] = useState(Math.max(PAGE, (jumpTo ?? 0) + 40));
  const [copied, setCopied] = useState(false);
  const q = query.trim();
  const matches = useMemo(() => (q ? lines.reduce<number[]>((acc, l, i) => (l.toLowerCase().includes(q.toLowerCase()) ? (acc.push(i), acc) : acc), []) : []), [lines, q]);
  const shown = q && only ? matches : null;
  const count = shown ? shown.length : lines.length;
  const digits = String(lines.length).length;

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <label className="relative">
          <span className="sr-only">Find in this file</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find in file" className="h-8 w-48 pl-7 text-xs" />
        </label>
        {q && (
          <>
            <span className="tabular-nums text-muted-foreground">{matches.length.toLocaleString("en-US")} {matches.length === 1 ? "line" : "lines"}</span>
            <Button type="button" size="sm" variant={only ? "default" : "ghost"} aria-pressed={only} onClick={() => setOnly(!only)}>
              Only these
            </Button>
          </>
        )}
        <span className="ml-auto flex items-center gap-1">
          <span className="mr-1 tabular-nums text-muted-foreground">{lines.length.toLocaleString("en-US")} lines</span>
          <Button type="button" size="sm" variant={wrap ? "default" : "ghost"} aria-pressed={wrap} onClick={() => setWrap(!wrap)}>
            Wrap
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              void navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </span>
      </div>
      <div tabIndex={0} role="region" aria-label="File contents" className="max-h-[36rem] overflow-auto py-2 font-mono text-xs leading-relaxed">
        <ol className={cn("min-w-full", !wrap && "w-max")}>
          {Array.from({ length: Math.min(count, limit) }, (_, n) => {
            const i = shown ? shown[n] : n;
            return (
              <li key={i} id={`L${i + 1}`} className={cn("flex gap-4 px-3 hover:bg-muted/40 target:bg-primary/15", jumpTo === i + 1 && "bg-primary/15")}>
                <span aria-hidden className="select-none text-right tabular-nums text-muted-foreground/70" style={{ minWidth: `${digits}ch` }}>
                  {i + 1}
                </span>
                <span className={cn("min-w-0 flex-1", wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre")}>
                  <Highlighted line={lines[i]} query={q} />
                </span>
              </li>
            );
          })}
        </ol>
        {count > limit && (
          <div className="px-3 pt-2">
            <Button type="button" size="sm" variant="outline" onClick={() => setLimit((n) => n + 2000)}>
              Show {Math.min(2000, count - limit).toLocaleString("en-US")} more lines
            </Button>
          </div>
        )}
      </div>
      {note && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}
