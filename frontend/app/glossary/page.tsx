import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import { PageHero } from "@/components/marketing";

export const metadata: Metadata = {
  title: "Glossary",
  description: "Plain meanings of the hydrology, GIS and storage words used in Craton.",
};

const terms: [string, string][] = [
  ["Branch", "A line of work that can change without touching main. When it is ready it is merged back through a pull request."],
  ["Chunk", "A piece of a file, cut where the content says rather than at a fixed size. Two versions of a file that differ in a few places share most of their chunks, so only the different ones are stored and sent."],
  ["Cloud Optimized GeoTIFF (COG)", "A GeoTIFF laid out in tiles with smaller overview images, so a viewer can read just the part it needs without downloading the whole file."],
  ["Commit", "A saved version: the files as they were, a message saying what changed and why, and who made it. A commit is never edited afterwards; an undo is a new commit."],
  ["Coordinate reference system (CRS)", "How numbers in a file map to places on Earth. Two files in different systems will not line up until one is converted."],
  ["DEM", "Digital elevation model: a raster in which each cell holds a height. The terrain a flood model runs on."],
  ["EPSG code", "A number that names a coordinate system, such as 4326 for latitude and longitude, or 32643 for UTM zone 43 north."],
  ["GeoPackage", "A single-file database of map layers and tables, with the coordinate system of each layer recorded inside."],
  ["GeoParquet", "A column-oriented table format that can hold geometry, with its coordinate system declared in the file's metadata."],
  ["Hillshade", "A picture of terrain lit from one side, so slopes show as light and shadow. Craton draws one for every raster."],
  ["HEC-RAS", "A hydraulic modelling program from the US Army Corps of Engineers. A project is a few text files plus, after a run, an HDF5 results file."],
  ["Lock", "A claim on a file that cannot be merged, so only one person edits it at a time. Others see it read-only until it is released."],
  ["Merkle root", "One short fingerprint calculated from the fingerprints of every file in a commit. If any byte of any file differs, the root differs."],
  ["Nodata", "The value a raster uses for cells that have no measurement. It must be treated as missing, not as a very low height."],
  ["Pull request", "A proposal to merge one branch into another, with a place to look at the change, comment, and approve."],
  ["Release", "A named, pinned version, such as v1.0.0, with checksums, so a report can say exactly which data it used."],
  ["Sidecar file", "A file that belongs to another and travels with it: a shapefile's .dbf, .shx and .prj sit beside its .shp, and the set is only valid whole."],
  ["SWMM", "The EPA Storm Water Management Model, which describes a drainage network in a text input file with sections such as [JUNCTIONS] and [CONDUITS]."],
  ["Vertical datum", "The level that heights are measured from, such as mean sea level or a geoid model. Heights from different datums differ by a fixed offset that can be a metre or more."],
];

export default function GlossaryPage() {
  return (
    <AppShell>
      <PageHero title="Glossary" lead="The words used in Craton, in plain terms." />
      <section className="w-full">
        <dl className="flex w-full max-w-3xl flex-col divide-y divide-border px-4 pb-12 sm:px-6 lg:px-8 xl:px-10">
          {terms.map(([term, meaning]) => (
            <div key={term} id={term.toLowerCase().replace(/[^a-z0-9]+/g, "-")} className="scroll-mt-20 py-5">
              <dt className="text-sm font-medium">{term}</dt>
              <dd className="mt-1 text-sm text-muted-foreground text-pretty">{meaning}</dd>
            </div>
          ))}
        </dl>
      </section>
    </AppShell>
  );
}
