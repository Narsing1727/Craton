import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHero, PageSection, WhereNext } from "@/components/marketing";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Craton compared",
  description: "How Craton differs from Git LFS, DVC and a shared drive for versioning large hydrology and GIS files.",
};

const columns = ["Craton", "Git LFS", "DVC", "A shared drive"];

const rows: { label: string; cells: string[] }[] = [
  { label: "A small edit to a large file", cells: ["Only the changed chunks are stored and sent", "The whole file is stored again for each version", "The whole file is stored again (unchanged files are shared)", "The whole file is copied or overwritten"] },
  { label: "Look at a GeoTIFF or shapefile in the browser", cells: ["Yes: zoomable map, attributes, cursor values", "No, a pointer file", "No", "Download it first"] },
  { label: "See what changed", cells: ["Elevation-change map, statistics, feature diff, table diff", "A diff of the pointer file", "Which files changed", "Nothing: the old version is gone"] },
  { label: "Checks for CRS, datum, nodata and model references", cells: ["Built in, plus your own rules", "No", "Pipelines you write", "No"] },
  { label: "Review before merging", cells: ["Pull requests with map diffs, code owners, locks", "Through your Git host", "Through your Git host", "Not available"] },
  { label: "Prove which data a study used", cells: ["A Merkle root per commit, checksums on releases", "A hash per file in Git history", "A hash per file in Git history", "Not available"] },
  { label: "Works with your existing Git repository", cells: ["No: it is its own tool, used beside Git", "Yes", "Yes", "Not applicable"] },
  { label: "Where the data lives", cells: ["Your own server (a container and PostgreSQL) or ours", "Your Git host's storage", "Your own cloud storage", "The drive's"] },
];

export default function ComparePage() {
  return (
    <AppShell>
      <PageHero title="Craton compared" lead="Craton is not a Git replacement. It does the part Git was never built for: very large geospatial files that change a little at a time, and the checks and previews that go with them.">
        <Button render={<Link href="/signup" />}>Try it free</Button>
      </PageHero>

      <PageSection title="Side by side" lead="Drawn from each tool's documented defaults. Tools change, so check theirs before deciding.">
        <div className="overflow-x-auto border border-border" tabIndex={0} role="region" aria-label="Comparison table">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-border bg-muted/20 text-xs">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">&nbsp;</th>
                {columns.map((c, i) => (
                  <th key={c} scope="col" className={`px-4 py-3 font-medium ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="w-52 px-4 py-3 text-left font-medium text-pretty">{r.label}</th>
                  {r.cells.map((c, i) => (
                    <td key={i} className={`px-4 py-3 text-pretty ${i === 0 ? "bg-primary/5 text-foreground" : "text-muted-foreground"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PageSection>

      <PageSection tone="card" title="When another tool is the better fit">
        <ul className="flex max-w-3xl list-disc flex-col gap-2 pl-5 text-sm text-muted-foreground">
          <li className="text-pretty">Your data is code and small text files: Git alone is simpler.</li>
          <li className="text-pretty">Your pipeline already lives in DVC and your files are not geospatial: stay with it, and use Craton for the terrain and model inputs.</li>
          <li className="text-pretty">You only need a place to put files that one person edits: a shared drive is enough until a second person edits the same file.</li>
        </ul>
      </PageSection>

      <WhereNext hrefs={["/features", "/formats", "/pricing"]} />
    </AppShell>
  );
}
