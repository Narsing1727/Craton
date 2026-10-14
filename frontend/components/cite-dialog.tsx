"use client";

import * as React from "react";
import { Quote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/craton-actions";
import { citationAction } from "@/app/actions";
import type { ApiCitation } from "@/lib/api";

/** "Cite this repository": APA, BibTeX and CITATION.cff, fetched when the dialog first opens. */
export function CiteDialog({ owner, repo }: { owner: string; repo: string }) {
  const [open, setOpen] = React.useState(false);
  const [citation, setCitation] = React.useState<ApiCitation | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || citation) return;
    let cancelled = false;
    citationAction(owner, repo).then((r) => {
      if (cancelled) return;
      if (r.ok) setCitation(r.data);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, citation, owner, repo]);

  const formats = citation
    ? [
        { id: "apa", label: "APA", text: citation.apa },
        { id: "bibtex", label: "BibTeX", text: citation.bibtex },
        { id: "cff", label: "CITATION.cff", text: citation.cff },
      ]
    : [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" className="w-full justify-start" />}>
        <Quote data-icon="inline-start" />
        Cite this repository
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Cite {owner}/{repo}</DialogTitle>
          <DialogDescription>
            {citation?.source === "CITATION.cff" ? "From the CITATION.cff in this repository." : "Built from this repository’s details. Add a CITATION.cff to control it exactly."}
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{error}</p>
        ) : !citation ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Tabs defaultValue="apa">
              <TabsList>
                {formats.map((f) => (
                  <TabsTrigger key={f.id} value={f.id}>
                    {f.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              {formats.map((f) => (
                <TabsContent key={f.id} value={f.id}>
                  <div className="relative border border-border bg-muted/30">
                    <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words p-3 pr-10 font-mono text-xs">{f.text}</pre>
                    <CopyButton value={f.text} label={`Copy ${f.label}`} className="absolute right-1.5 top-1.5" />
                  </div>
                </TabsContent>
              ))}
            </Tabs>
            {citation.hints.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
                {citation.hints.map((h) => (
                  <li key={h}>· {h}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
