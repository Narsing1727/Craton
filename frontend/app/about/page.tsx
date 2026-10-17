import type { Metadata } from "next";
import Link from "next/link";
import { Check, Circle, GitBranch, Globe, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Frame, FramePanel } from "@/components/ui/frame";
import { IconTile } from "@/components/reui/icon-tile";

export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/about.md" } },
  title: "About",
  description: "What Craton is, who it's for, and what works today.",
};

const values = [
  {
    icon: GitBranch,
    title: "Version control for data",
    body: "DEMs, shapefiles and model inputs are split into content-defined chunks, so a new version stores only what changed, and every version can be branched, reviewed and restored.",
  },
  {
    icon: Globe,
    title: "Made for GIS files",
    body: "Craton reads GeoTIFF headers, shapefile sets and tables, checks CRS, vertical datum and nodata before a merge, and draws the change on a map instead of a byte diff.",
  },
  {
    icon: ShieldCheck,
    title: "Reproducible",
    body: "Each commit records a Merkle root over its files, and releases pin checksums, so a study can show exactly which data it used.",
  },
];

const works = [
  "Accounts, organizations, roles and scoped access tokens",
  "The CLI: init, add, commit, push, pull, clone, branch, revert and fsck, resumable and verified",
  "Branches, pull requests, reviews and merge rules",
  "Checks for CRS, vertical datum, nodata, shapefile sidecars and chunk integrity",
  "Hillshade previews and elevation-change maps for GeoTIFFs; geometry diffs for shapefiles",
  "Releases with checksums, storage accounting, and data export or deletion",
];

const notYet = [
  "Packaged installers for the CLI",
  "Forks, wikis, teams and following people",
  "Paid plans and invoices",
  "Two-factor authentication and single sign-on",
  "Previews for LiDAR, NetCDF and HEC-RAS results",
];

export default function AboutPage() {
  return (
    <AppShell>
      <section className="w-full border-b border-border">
        <div className="flex w-full max-w-3xl flex-col gap-5 px-4 py-16 sm:px-6 lg:px-8 xl:px-10">
          <h1 className="text-4xl font-semibold tracking-tight text-balance">Git for the people who model water</h1>
          <p className="text-lg text-muted-foreground text-pretty">
            Flood studies depend on terrain, surveys and model inputs that are too big for git and too important for a shared drive. Craton keeps their full history, shows what changed on a map, and checks the data before it’s merged.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button render={<Link href="/explore" />}>Explore public data</Button>
            <Button variant="outline" render={<Link href="/contact" />}>
              Get in touch
            </Button>
          </div>
        </div>
      </section>

      <section className="w-full px-4 py-14 sm:px-6 lg:px-8 xl:px-10">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {values.map((v) => (
            <Card key={v.title}>
              <CardHeader>
                <IconTile variant="outline" size="sm">
                  <v.icon />
                </IconTile>
                <CardTitle className="mt-2">{v.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground text-pretty">{v.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section className="w-full border-t border-border bg-card/40">
        <div className="grid w-full grid-cols-1 gap-8 px-4 py-12 sm:px-6 md:grid-cols-2 lg:px-8 xl:px-10">
          <div>
            <h2 className="text-lg font-semibold">Where it stands</h2>
            <p className="mt-1 text-sm text-muted-foreground text-pretty">Craton is early. This is what works today, and what doesn’t exist yet.</p>
          </div>
          <Frame className="grid grid-cols-1 gap-1 bg-transparent p-0 sm:grid-cols-2 sm:gap-1">
            <FramePanel>
              <h3 className="mb-3 text-sm font-medium">Works today</h3>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {works.map((w) => (
                  <li key={w} className="flex gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-chart-1" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            </FramePanel>
            <FramePanel>
              <h3 className="mb-3 text-sm font-medium">Not yet</h3>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {notYet.map((w) => (
                  <li key={w} className="flex gap-2">
                    <Circle className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs text-muted-foreground">
                Details in the{" "}
                <Link href="/changelog" className="underline underline-offset-2 hover:text-foreground">
                  changelog
                </Link>
                .
              </p>
            </FramePanel>
          </Frame>
        </div>
      </section>
    </AppShell>
  );
}
