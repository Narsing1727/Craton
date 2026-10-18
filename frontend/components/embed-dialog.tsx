"use client";

// "Embed": the image address of a preview pinned to one commit, as Markdown, HTML and a bare link, for
// reports, wikis and READMEs. Pinned to a commit, the picture never changes under the document that
// shows it; it only works for public repositories, since a private one needs a signed-in viewer.

import * as React from "react";
import { Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "@/components/craton-actions";
import { embedSnippets } from "@/lib/embed";

export function EmbedDialog({ owner, repo, commit, path, isPublic }: { owner: string; repo: string; commit: string; path: string; isPublic: boolean }) {
  const [origin, setOrigin] = React.useState("");
  React.useEffect(() => setOrigin(window.location.origin), []);
  const name = path.split("/").pop() ?? path;
  const s = embedSnippets(origin, owner, repo, commit, path, `${name} at ${commit.slice(0, 7)}`);
  const formats = [
    { id: "markdown", label: "Markdown", text: s.markdown },
    { id: "html", label: "HTML", text: s.html },
    { id: "url", label: "Image address", text: s.image },
  ];
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="ghost" size="xs" />}>
        <Code2 data-icon="inline-start" />
        Embed
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Embed this preview</DialogTitle>
          <DialogDescription>
            Pinned to commit <span className="font-mono">{commit.slice(0, 7)}</span>, so the picture stays the same in whatever document shows it.
          </DialogDescription>
        </DialogHeader>
        {!isPublic && (
          <p className="border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            This repository is private. The address only works for people who are signed in and can see it; make it public to embed it elsewhere.
          </p>
        )}
        <Tabs defaultValue="markdown">
          <TabsList>
            {formats.map((f) => (
              <TabsTrigger key={f.id} value={f.id}>{f.label}</TabsTrigger>
            ))}
          </TabsList>
          {formats.map((f) => (
            <TabsContent key={f.id} value={f.id}>
              <div className="relative border border-border bg-muted/30">
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all p-3 pr-10 font-mono text-xs">{f.text}</pre>
                <CopyButton value={f.text} label={`Copy ${f.label}`} className="absolute right-1.5 top-1.5" />
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
