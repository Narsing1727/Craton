// A text file in the viewer that suits it: a README formatted (with the source a tab away), JSON as a tree, a SWMM or HEC-RAS model file with its
// outline first, and anything else as numbered lines with find.

import { FileOutline } from "@/components/file-outline";
import { GeoJsonMap } from "@/components/geojson-map";
import { JsonViewer } from "@/components/json-viewer";
import { Markdown } from "@/components/markdown";
import { TextViewer } from "@/components/text-viewer";
import { ViewTabs } from "@/components/view-tabs";
import { structureOf, textKind } from "@/lib/structured";

export function FileText({ name, text, note }: { name: string; text: string; note?: string | null }) {
  const kind = textKind(name);
  const source = <TextViewer text={text} note={note} />;
  if (kind === "markdown") {
    return (
      <ViewTabs
        label="Markdown view"
        tabs={[
          {
            id: "formatted",
            label: "Formatted",
            node: (
              <div className="max-h-[40rem] overflow-auto p-5">
                <Markdown text={text} />
                {note && <p className="mt-4 text-xs text-muted-foreground">{note}</p>}
              </div>
            ),
          },
          { id: "source", label: "Source", node: source },
        ]}
      />
    );
  }
  if (kind === "json") {
    const geo = /\.geojson$/i.test(name) && !note;
    return (
      <ViewTabs
        label="JSON view"
        tabs={[
          ...(geo ? [{ id: "map", label: "Map", node: <GeoJsonMap text={text} alt={`Features of ${name}`} /> }] : []),
          { id: "tree", label: "Tree", node: note ? <p className="px-4 py-3 text-xs text-muted-foreground text-pretty">{note} A tree needs the whole document; see the Source tab.</p> : <JsonViewer text={text} /> },
          { id: "source", label: "Source", node: source },
        ]}
      />
    );
  }
  const structure = structureOf(text, name);
  if (structure) {
    return (
      <ViewTabs
        label="Model file view"
        tabs={[
          { id: "outline", label: structure.kind === "sections" ? "Sections" : "Settings", node: <FileOutline structure={structure} /> },
          { id: "text", label: "Text", node: source },
        ]}
      />
    );
  }
  return source;
}
