import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHero, PageSection, WhereNext } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { FEATURED_REPO } from "@/lib/site";
import { FORMATS } from "@/lib/formats";

export const metadata: Metadata = {
  title: "Supported formats",
  description: "What Craton shows, checks and compares for GeoTIFF, shapefile, GeoPackage, GeoParquet, LAS, NetCDF, HDF5, HEC-RAS, SWMM, CSV and more.",
};

export default function FormatsPage() {
  return (
    <AppShell>
      <PageHero title="Supported formats" lead="Any file can be stored: it is kept byte for byte, split into chunks, and checked against its hash. For the formats below Craton also opens the file, reads its header and compares versions in a way that suits it.">
        <Button render={<Link href={`/${FEATURED_REPO}`} />}>See a real repository</Button>
      </PageHero>

      <PageSection title="What happens to each kind of file">
        <div className="hidden overflow-x-auto border border-border lg:block" tabIndex={0} role="region" aria-label="Supported formats">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border bg-muted/20 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Format</th>
                <th scope="col" className="px-4 py-3 font-medium">On its page</th>
                <th scope="col" className="px-4 py-3 font-medium">Checked on push</th>
                <th scope="col" className="px-4 py-3 font-medium">Compared</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border align-top">
              {FORMATS.map((f) => (
                <tr key={f.name}>
                  <th scope="row" className="w-56 px-4 py-3 text-left font-medium">
                    {f.name}
                    <span className="mt-0.5 block font-mono text-xs font-normal text-muted-foreground">{f.extensions}</span>
                  </th>
                  <td className="px-4 py-3 text-muted-foreground text-pretty">{f.viewer}</td>
                  <td className="px-4 py-3 text-muted-foreground text-pretty">{f.checks}</td>
                  <td className="px-4 py-3 text-muted-foreground text-pretty">{f.compare}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The same facts as cards on a narrow screen, where four columns of prose cannot fit. */}
        <ul className="flex flex-col gap-3 lg:hidden">
          {FORMATS.map((f) => (
            <li key={f.name} className="flex flex-col gap-2 border border-border p-4">
              <div>
                <h3 className="text-sm font-medium">{f.name}</h3>
                <span className="font-mono text-xs text-muted-foreground">{f.extensions}</span>
              </div>
              <dl className="flex flex-col gap-2 text-sm">
                {(
                  [
                    ["On its page", f.viewer],
                    ["Checked on push", f.checks],
                    ["Compared", f.compare],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-muted-foreground">{k}</dt>
                    <dd className="text-pretty">{v}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </PageSection>

      <PageSection tone="card" title="Something missing?" lead="Craton stores any file today. A viewer or a check for another format is added when people ask for it, so say what you work with.">
        <div>
          <Button variant="outline" render={<Link href="/contact" />}>
            Tell us about your format
          </Button>
        </div>
      </PageSection>

      <WhereNext hrefs={["/features", "/docs", "/guides"]} />
    </AppShell>
  );
}
