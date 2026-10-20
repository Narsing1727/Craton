import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHero, PageSection, WhereNext } from "@/components/marketing";
import { Button } from "@/components/ui/button";
import { FEATURED_REPO } from "@/lib/site";

export const metadata: Metadata = {
  title: "Features",
  description: "Everything Craton does with hydrology and GIS data: store it, look at it, check it, review it, share it and automate it.",
};

const groups = [
  {
    title: "Store large files without the waste",
    points: [
      "A file is cut into content-defined chunks. Change a few rows of a 20 GB DEM and only the chunks that changed are uploaded, stored and downloaded.",
      "Every byte comes back exactly as it was uploaded. Each chunk is checked against its own hash when it is read.",
      "Uploads and clones resume where they stopped. A clone can take only the folders you name.",
      "Every commit carries a Merkle root over its files, and history is append-only: a rollback is a new commit.",
    ],
  },
  {
    title: "Open every file the way it should open",
    points: [
      "Rasters zoom to single pixels on a hillshaded map and read out the elevation under the cursor.",
      "Shapefiles and GeoJSON open on a map with an attribute table linked to it.",
      "Tables sort, filter and profile themselves; model files show their sections and settings; NetCDF and HDF5 list what they hold.",
    ],
    link: { href: "/formats", label: "See every format" },
  },
  {
    title: "Catch the mistake before it is merged",
    points: [
      "Every push is checked for coordinate system, vertical datum, nodata, shapefile sidecars, Cloud Optimized GeoTIFF layout and broken model references.",
      "Write your own rules in a file in the repository: a required CRS, a cell size range, columns that must be filled, a run that must be stable.",
      "A push that contains a password, token or key is refused, and says where.",
    ],
  },
  {
    title: "Review change you can see",
    points: [
      "Pull requests show an elevation-change map and cell statistics, not a byte diff.",
      "Code owners, required approvals and a model review pinned to one commit.",
      "Locks for files that cannot be merged: an editor holds the lock, everyone else gets a read-only copy.",
    ],
  },
  {
    title: "Share without sending files",
    points: [
      "Public repositories anyone can browse and clone, or expiring share links to one version of a private one.",
      "Releases pin checksums, so a study can say exactly which data it used.",
      "Badges, embeds and signed webhooks for the places the data is used.",
    ],
  },
  {
    title: "Run it for a team",
    points: [
      "Organizations, roles, and access tokens scoped to what a job needs.",
      "Single sign-on with SAML or OpenID Connect, user provisioning with SCIM, two-step sign-in and passkeys.",
      "An audit log, and your own data export or deletion at any time.",
    ],
  },
  {
    title: "Automate it",
    points: [
      "A command line that works like git: add, commit, push, pull, branch, diff, blame, lock.",
      "A REST API for everything the website does, an MCP server for AI tools, and a Python client.",
      "Runs on your own infrastructure as a container with PostgreSQL, or on AWS.",
    ],
    link: { href: "/api-reference", label: "Read the API reference" },
  },
];

export default function FeaturesPage() {
  return (
    <AppShell>
      <PageHero title="Everything Craton does with your data" lead="Craton keeps the full history of the large files a flood study depends on, shows what changed on a map, and checks the data before anyone builds on it.">
        <Button render={<Link href="/signup" />}>Start free</Button>
        <Button variant="outline" render={<Link href={`/${FEATURED_REPO}`} />}>
          See a real repository
        </Button>
      </PageHero>

      <PageSection title="What you can do" lead="Each of these works today. Where something is limited, the page it lives on says so.">
        <div className="flex flex-col divide-y divide-border">
          {groups.map((g) => (
            <div key={g.title} className="grid grid-cols-1 gap-3 py-8 first:pt-0 last:pb-0 md:grid-cols-[18rem_1fr] md:gap-10">
              <h3 className="text-base font-medium text-balance">{g.title}</h3>
              <div className="flex max-w-2xl flex-col gap-3">
                {g.points.map((p) => (
                  <p key={p} className="text-sm text-muted-foreground text-pretty">
                    {p}
                  </p>
                ))}
                {g.link && (
                  <Link href={g.link.href} className="text-sm underline underline-offset-2 hover:text-foreground">
                    {g.link.label}
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      </PageSection>

      <WhereNext hrefs={["/formats", "/guides", "/compare", "/docs", "/pricing", "/security"]} />
    </AppShell>
  );
}
