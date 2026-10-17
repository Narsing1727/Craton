import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/craton-ui";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/changelog.md" } },
  title: "Changelog",
  description: "What's in Craton so far. There hasn't been a public release yet.",
};

// Only things that exist in this codebase. Newest first; each release gets its own entry.
const entries = [
  {
    version: "0.1",
    status: "Unreleased",
    title: "First working version",
    groups: [
      {
        name: "Storage and history",
        items: [
          "Content-defined chunking (FastCDC) with SHA-256 chunk ids, lossless compression, and chunks shared across versions and public repositories",
          "Commits with Merkle roots, branches, append-only history and reverts",
          "Releases with per-file checksums, and a STAC description of each release for catalogues and GIS tools",
          "A units setting: elevations, elevation change and volumes in metres and cubic metres, or feet and acre-feet; files are never converted",
          "Organization owners can download all of the organization's repositories as one ZIP, and deleting an account sends a confirmation",
          "Download all your own repositories as one ZIP from Settings, alongside the JSON export of your account",
          "Storage warnings at 80% and 100% of your plan: a banner on the dashboard and one email each, never a deletion",
          "Link previews for public repositories (name, description, what is in it), a sitemap, and badges for the latest release, size and licence",
          "An email when your push fails its checks, naming the failing steps",
          "Where each part of a file came from: the commit behind every byte range, on the file page and as craton blame",
          "Code owners can be required to approve before merging, and CODEOWNERS is edited in Settings with a preview of who owns what",
          "Code owners: a CODEOWNERS file asks the right people to review a pull request, and the pull request page shows where each stands",
          "Request bodies are capped (16 MB of JSON, one chunk per upload) and over-limit requests get a clear 413",
          "The command menu knows which repository you are in: its pages, new pull request, issue or release, and a copy clone command",
          "craton doctor: a one-command check of Node, the server, your token, repository access and disk space, with the fix beside each failure",
          "Describe a table's columns in the browser: the data dictionary is edited on the file page and saved as a commit",
          "A line diff for changed text files such as HEC-RAS plans and geometry, so a Manning's n change shows up as the one line it is",
          "Webhooks for issues and file locks, alongside pushes, pull requests and releases",
          "The commits API filters by date and author and pages with an offset; the Python client streams CSV rows and walks a whole history",
          "Each release shows what changed since the one before it: commits, files, and how much was rewritten",
          "A Python client in one file, standard library only: repositories, releases, files, tables, comparisons and raster statistics",
          "Interrupted clones resume: chunks already downloaded are kept, no half-written files are left, and running the clone again carries on",
          "An OpenAPI 3.1 document at /v1/openapi.json, generated from the server's routes so it cannot drift",
          "Sparse clones: craton clone --only terrain/ brings just those folders, commits and pushes without touching the rest; craton sparse widens it",
          "Fixed: a fresh clone of a repository with history could not push (older trees were never downloaded)",
          "craton diff in the terminal: the files that differ between two versions and how many chunks were rewritten",
          "craton stats in the terminal: cell statistics and change for a raster, and NSE, KGE and PBIAS for a gauge table, per station",
          "An MCP server so an assistant can answer what changed in the DEM since the last release, with the cell statistics",
          "Garbage collection of unreferenced chunks after a 30-day grace period; database backup and restore scripts",
        ],
      },
      {
        name: "Review",
        items: [
          "Pull requests with reviews, merge rules and conflict detection",
          "Ask a specific person to review a pull request; it waits in their inbox until they do",
          "Checks for CRS, vertical datum, nodata, shapefile sidecars and chunk integrity",
          "Map previews drawn from the stored bytes: hillshades and elevation-change heatmaps for GeoTIFFs, geometry and feature diffs for shapefiles",
          "Raster statistics beside every elevation change: minimum, percentiles, mean and maximum of each version, a shared histogram, mean change, RMSE, share raised and lowered, and volume for projected grids",
          "Embed a commit-pinned preview in a report or wiki as Markdown, HTML or an image address",
          "A checks status badge for README files (public repositories)",
          "A data dictionary for tables and shapefiles: column meanings and units kept in the repository, shown under the data",
          "Plot a table column over time, one line per station, with the previous version dashed behind it",
          "Compare two columns of a table: NSE, KGE, bias, RMSE, MAE and correlation of observed against simulated values",
        ],
      },
      {
        name: "Accounts",
        items: [
          "Sign-up with email confirmation, onboarding and a sample project",
          "Organizations with roles; scoped personal access tokens",
          "Session list and sign-out, password change and reset, new-device emails, lockout after repeated failures",
          "Stars, account data export and account deletion",
          "A security activity log: sign-ins, failed attempts, password and token changes, two-step verification",
          "Access tokens can be limited to named repositories",
          "Invite someone to a repository by email address before they have an account",
          "Saved filters for issues and pull requests, and reminders for locks held longer than a week",
        ],
      },
      {
        name: "Repositories",
        items: [
          "A checklist that shows what a repository still lacks before it describes its data well: description, licence, topics, README, vertical datum, nodata value, located data, a release",
          "README starters for HEC-RAS models, terrain surveys, rainfall grids and GIS layers, filled with the repository's own CRS, datum, nodata value and licence",
          "File locks report how long they have been held; patterns such as *.gdb and model/*.p0* can require the lock before a push may change a file",
        ],
      },
      {
        name: "CLI",
        items: ["init, add, status, commit, push, pull, clone, branch, switch, revert and fsck, with resumable and verified transfers"],
      },
    ],
  },
];

export default function ChangelogPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6">
        <PageHeader title="Changelog" description="What’s in Craton so far. There hasn’t been a public release yet; see the about page for what’s missing." />
        {entries.map((e) => (
          <article key={e.version} className="flex flex-col gap-4 border border-border bg-card p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold text-accent">{e.version}</span>
              <Badge variant="outline">{e.status}</Badge>
            </div>
            <h2 className="text-lg font-semibold">{e.title}</h2>
            {e.groups.map((g) => (
              <section key={g.name}>
                <h3 className="text-sm font-medium">{g.name}</h3>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                  {g.items.map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              </section>
            ))}
          </article>
        ))}
        <p className="text-xs text-muted-foreground">
          <Link href="/about" className="underline underline-offset-2 hover:text-foreground">
            What isn’t built yet
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
