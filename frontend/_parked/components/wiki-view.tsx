"use client";

import * as React from "react";
import Link from "next/link";
import { BookOpen, Pencil, Search } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { MapPreview } from "@/components/map-preview";
import { cn } from "@/lib/utils";
import type { WikiPage } from "@/lib/wiki";

export function WikiView({ pages, activeSlug }: { pages: WikiPage[]; activeSlug: string }) {
  const [query, setQuery] = React.useState("");
  // Saved edits for this browser session, keyed by slug.
  const [edits, setEdits] = React.useState<Record<string, string>>({});
  const page = pages.find((p) => p.slug === activeSlug) ?? pages[0];
  const body = edits[page.slug] ?? page.body;

  const q = query.trim().toLowerCase();
  const visible = q
    ? pages.filter((p) => p.title.toLowerCase().includes(q) || (edits[p.slug] ?? p.body).toLowerCase().includes(q))
    : pages;

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
      <aside className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder="Search wiki…"
            aria-label="Search wiki"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <nav aria-label="Wiki pages" className="flex flex-col gap-0.5 text-sm">
          {visible.map((p) => (
            <Link
              key={p.slug}
              href={`?page=${p.slug}`}
              scroll={false}
              aria-current={p.slug === page.slug ? "page" : undefined}
              className={cn(
                "px-3 py-2 transition-colors",
                p.slug === page.slug
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {p.title}
            </Link>
          ))}
          {visible.length === 0 && (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              No pages match “{query.trim()}”.{" "}
              <button type="button" className="underline hover:text-foreground" onClick={() => setQuery("")}>
                Clear search
              </button>
            </p>
          )}
        </nav>
      </aside>

      {/* key: switching pages resets the editor */}
      <WikiArticle
        key={page.slug}
        page={page}
        body={body}
        onSave={(next) => setEdits((prev) => ({ ...prev, [page.slug]: next }))}
      />
    </div>
  );
}

function WikiArticle({ page, body, onSave }: { page: WikiPage; body: string; onSave: (body: string) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(body);
  const dirty = editing && draft !== body;

  // Warn before closing the tab with unsaved changes.
  React.useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  function save() {
    onSave(draft);
    setEditing(false);
    toast.success(`Saved “${page.title}”`, { description: "Stored in this browser until the backend is connected." });
  }

  return (
    <article className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <BookOpen className="size-4" aria-hidden />
          Wiki
        </div>
        {!editing && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setDraft(body);
              setEditing(true);
            }}
          >
            <Pencil data-icon="inline-start" />
            Edit page
          </Button>
        )}
      </div>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-balance">{page.title}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Last edited by {page.author} · {page.updated}
      </p>
      <Separator className="my-4" />

      {editing ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Field>
            <FieldLabel htmlFor="wiki-body">Page content</FieldLabel>
            <Textarea
              id="wiki-body"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={18}
              className="font-mono text-xs leading-relaxed"
              autoFocus
            />
            <FieldDescription>
              Separate paragraphs with a blank line. Start a line with “## ” for a heading or “- ” for a list item.
            </FieldDescription>
          </Field>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm" disabled={!dirty}>
              Save page
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4 text-sm leading-relaxed text-muted-foreground">
          {body.split(/\n{2,}/).map((block, i) => (
            <WikiBlock key={i} block={block.trim()} />
          ))}
        </div>
      )}
    </article>
  );
}

function WikiBlock({ block }: { block: string }) {
  if (!block) return null;
  if (block === "[map]") return <MapPreview seed={22} variant="vector" className="aspect-[16/7] w-full" />;
  if (block.startsWith("## ")) return <h2 className="text-base font-semibold text-foreground">{block.slice(3)}</h2>;
  if (block.startsWith("- ")) {
    return (
      <ul className="flex list-disc flex-col gap-1 pl-5">
        {block.split("\n").map((line, i) => (
          <li key={i}>{line.replace(/^- /, "")}</li>
        ))}
      </ul>
    );
  }
  return <p className="text-pretty">{block}</p>;
}
