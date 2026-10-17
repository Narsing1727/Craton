import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { CommandLine } from "@/components/craton-actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollProgress } from "@/components/ui/scroll-progress";
import { File, Folder, Tree } from "@/components/ui/file-tree";

export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/docs.md" } },
  title: "Documentation",
  description: "Install Craton, version your first basin model, and learn how chunking, map diffs, checks and provenance work.",
};

const slug = (s: string) => s.toLowerCase().replaceAll("&", "and").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const nav = [
  { heading: "Getting started", items: ["Introduction", "Install the CLI", "Your first repository", "Authentication"] },
  { heading: "By goal", items: ["Version a HEC-RAS project", "Share a DEM with a partner", "See what changed in a DEM", "Review a change as a team", "Work with part of a big repository"] },
  { heading: "Working with data", items: ["Supported formats", "Chunking & deduplication", "Large file workflow", "Map diffs", "Python and notebooks", "Your own checks", "Secret scanning"] },
  { heading: "Collaboration", items: ["Branches", "Pull requests", "Reviews", "Model review", "Organization domains", "Code owners", "Provenance"] },
  { heading: "Reference", items: ["CLI commands", "REST API", "Webhooks", "Rate limits", "For agents and AI tools"] },
];

// What each kind of file gets today. Every file is stored as content-defined chunks; the rest is per format.
const formats = [
  { type: "Rasters", exts: ".tif · .tiff · .vrt · .img · .asc", note: "GeoTIFFs get hillshade previews, change maps between versions, cell statistics and CRS, datum and nodata checks. A local edit uploads only the chunks that changed." },
  { type: "Vectors", exts: ".shp · .geojson · .gpkg · .kml", note: "Shapefiles get previews, feature-level diffs (added, changed, removed) and a completeness check. The other formats are versioned as files." },
  { type: "Point clouds", exts: ".las · .laz · .copc", note: "Versioned as files: only the chunks that changed are stored and uploaded. There is no point preview yet." },
  { type: "Grids", exts: ".nc · .zarr · .grib", note: "Versioned as files, with the same chunk-level storage and integrity checks. No preview yet." },
  { type: "Models", exts: "HEC-RAS · HEC-HMS · SWMM · EPANET", note: "Recognised by file type. For HEC-RAS, a check confirms each plan points at geometry and flow files that exist." },
];

function DocSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id={slug(title)} className="flex scroll-mt-20 flex-col gap-3">
      <h2 className="font-serif text-2xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

const P = ({ children }: { children: React.ReactNode }) => <p className="max-w-3xl text-muted-foreground text-pretty">{children}</p>;

export default function DocsPage() {
  return (
    <AppShell>
      <ScrollProgress className="z-60" />
      <div className="grid grid-cols-1 w-full gap-10 px-4 sm:px-6 lg:px-8 xl:px-10 py-10 md:grid-cols-[240px_1fr]">
        <aside className="hidden md:block">
          <nav aria-label="Documentation" className="sticky top-20 flex flex-col gap-6">
            {nav.map((section) => (
              <div key={section.heading} className="flex flex-col gap-2">
                <h3 className="text-[15px] font-medium">{section.heading}</h3>
                <ul className="flex flex-col gap-1">
                  {section.items.map((item) => (
                    <li key={item}>
                      <Link href={`#${slug(item)}`} className="block py-1.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground">
                        {item}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>

        <article className="flex min-w-0 flex-col gap-12">
          <section id="introduction" className="scroll-mt-20">
            <Badge variant="secondary">Getting started</Badge>
            <h1 className="mt-3 font-serif text-4xl font-semibold text-balance">Introduction</h1>
            <p className="mt-3 max-w-3xl text-lg text-muted-foreground text-pretty">
              Craton brings the git workflow to geospatial data: commits, branches, pull requests and releases for DEMs,
              shapefiles, LiDAR, NetCDF and hydraulic models. This guide gets you from install to your first versioned basin model.
            </p>
          </section>

          <Separator />

          <DocSection title="Install the CLI">
            <P>The CLI handles uploads, resumes and verification. Until hosted installers ship, install it from the repository (Node.js 23.6+).</P>
            <CommandLine command="cd backend && npm install && npm link" />
            <CommandLine command="craton help" />
            <Link href="/cli" className="text-sm text-accent hover:underline">All install options and the command reference →</Link>
          </DocSection>

          <DocSection title="Your first repository">
            <P>Create the repository on Craton, then run these from your project folder. Checks run on every push.</P>
            <div className="flex flex-col gap-2">
              <CommandLine command="craton init . --remote http://localhost:4000/you/chalakudy-basin" />
              <CommandLine command="craton add terrain/ vectors/ model/" />
              <CommandLine command={'craton commit -m "Initial import"'} />
              <CommandLine command="craton push" />
            </div>
            <div className="max-w-sm border border-border bg-card p-3">
              <p className="mb-1.5 text-xs text-muted-foreground">What <code className="font-mono">craton add</code> stages — the sample basin created for you on sign-up:</p>
              <Tree className="w-full" initialExpandedItems={["terrain", "vectors", "model"]} indicator={false}>
                <Folder value="terrain" element="terrain/">
                  <File value="terrain-dem">basin_dem.tif</File>
                </Folder>
                <Folder value="vectors" element="vectors/">
                  <File value="vectors-shp">catchment.shp</File>
                  <File value="vectors-dbf">catchment.dbf</File>
                </Folder>
                <Folder value="model" element="model/">
                  <File value="model-prj">chalakudy.prj</File>
                </Folder>
                <File value="gauges">gauges.csv</File>
                <File value="readme">README.md</File>
              </Tree>
            </div>
          </DocSection>

          <DocSection title="Authentication">
            <P>
              Create a <Link href="/settings/tokens" className="text-accent underline underline-offset-2">personal access token</Link>, then run{" "}
              <code className="font-mono text-sm text-foreground">craton auth login --token &lt;token&gt;</code> once; it’s saved in <code className="font-mono text-sm text-foreground">~/.craton</code>.
              For CI, set <code className="font-mono text-sm text-foreground">CRATON_TOKEN</code> instead, with a read:repo token if the job only reads.
            </P>
          </DocSection>

          <DocSection title="Version a HEC-RAS project">
            <P>Close HEC-RAS first (or let it finish writing its snapshot): Craton waits for a file to stop changing before reading it and skips lock files.</P>
            <div className="flex flex-col gap-2">
              <CommandLine command="craton init . --remote http://localhost:4000/you/river-model" />
              <CommandLine command="craton add . && craton commit -m &quot;Calibrated 2019 event&quot;" />
              <CommandLine command="craton push" />
            </div>
            <P>
              On push, a check confirms each plan file points at geometry and flow files that exist. Put the files people must not edit at the same time
              (<code className="font-mono text-sm text-foreground">*.g01</code>, <code className="font-mono text-sm text-foreground">*.hdf</code>) under
              Settings → Files that must be locked, then <code className="font-mono text-sm text-foreground">craton lock model/river.g01</code> before editing.
            </P>
          </DocSection>

          <DocSection title="Share a DEM with a partner">
            <P>Make a release so they get a fixed, checksummed version, then give them a link that needs no account.</P>
            <div className="flex flex-col gap-2">
              <CommandLine command="craton push" />
            </div>
            <P>
              In the repository, <b>Releases → New release</b> (for example <code className="font-mono text-sm text-foreground">v1.0.0</code>) pins the commit and records the
              SHA-256 of every file. <b>Settings → Sharing</b> makes a link to that snapshot that expires when you choose; the partner downloads files or a ZIP from it, and can check
              them against <code className="font-mono text-sm text-foreground">SHA256SUMS</code>. If they use QGIS or a catalogue, each release also has a STAC description.
            </P>
          </DocSection>

          <DocSection title="See what changed in a DEM">
            <P>After a re-survey, ask for the numbers, not just the picture.</P>
            <div className="flex flex-col gap-2">
              <CommandLine command="craton diff" />
              <CommandLine command="craton stats terrain/basin_dem.tif --base v1.0.0" />
              <CommandLine command="craton blame terrain/basin_dem.tif" />
            </div>
            <P>
              <code className="font-mono text-sm text-foreground">diff</code> lists the files that differ and how many chunks were rewritten,{" "}
              <code className="font-mono text-sm text-foreground">stats</code> gives cell statistics and the mean, RMSE and volume change against an earlier version, and{" "}
              <code className="font-mono text-sm text-foreground">blame</code> says which commit rewrote each part of the file. The same numbers are on the file and pull request pages.
            </P>
          </DocSection>

          <DocSection title="Review a change as a team">
            <P>
              Put a <code className="font-mono text-sm text-foreground">CODEOWNERS</code> file at the root (or write it in Settings → Code owners), for example{" "}
              <code className="font-mono text-sm text-foreground">terrain/** @priyam</code>. A pull request that changes those files asks the owners to review, and with
              Settings → Protection → <i>Require approval from code owners</i> it cannot merge until each has approved the latest version.
            </P>
          </DocSection>

          <DocSection title="Work with part of a big repository">
            <P>A DEM of a whole country is not something every analyst needs on their laptop. Clone only the folders you work in; the rest stays in history and in every commit.</P>
            <div className="flex flex-col gap-2">
              <CommandLine command="craton clone hydrolab/national-terrain --only tiles/kerala/,README.md" />
              <CommandLine command="craton sparse add tiles/tamil-nadu/" />
            </div>
            <P>An interrupted download resumes where it stopped: run the same clone command again.</P>
          </DocSection>

          <DocSection title="Supported formats">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {formats.map((f) => (
                <Card key={f.type}>
                  <CardHeader>
                    <CardTitle className="text-base">{f.type}</CardTitle>
                    <CardDescription className="font-mono text-xs">{f.exts}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground text-pretty">{f.note}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </DocSection>

          <DocSection title="Chunking & deduplication">
            <P>
              Files are split into content-defined chunks before they’re compressed. A chunk that already exists, in your history
              or in public data such as SRTM tiles, is referenced instead of uploaded again. Compression is always lossless; there is
              no bounded-error mode. See how much a repository saves on its Storage tab.
            </P>
          </DocSection>

          <DocSection title="Large file workflow">
            <P>Clone once, then pull and push only what changed: chunks you already have never move again. Dropped connections are retried.</P>
            <CommandLine command="craton clone hydrolab/chalakudy-basin" />
            <CommandLine command="craton pull" />
            <P>Craton never reads a file another program is still writing: close HEC-RAS or wait for its snapshot before committing.</P>
          </DocSection>

          <DocSection title="Map diffs">
            <P>Every commit, comparison and pull request shows what changed in each file, down to which chunks are new. Locally, status shows the same before you commit.</P>
            <CommandLine command="craton status" />
            <Link href="/hydrolab/chalakudy-basin/compare?base=main&head=levee-scenario" className="text-sm text-accent hover:underline">Compare two branches →</Link>
          </DocSection>

          <DocSection title="Python and notebooks">
            <P>
              Install the client with <code className="font-mono text-sm text-foreground">pip install &quot;./sdk/python[fsspec]&quot;</code> and any tool that takes an fsspec address can read a file at an exact version, fetching only the bytes it needs: <code className="font-mono text-sm text-foreground">pd.read_csv(&quot;craton://hydrolab/chalakudy-basin@v1.2.0/gauges.csv&quot;, storage_options=&#123;&quot;server&quot;: …, &quot;token&quot;: …&#125;)</code>. Paths are <code className="font-mono text-sm text-foreground">owner/repo@version/path</code>, where the version is a branch, tag or commit. Opening a 30 GB raster and reading one window moves only that window, because the server answers HTTP byte ranges; <code className="font-mono text-sm text-foreground">@v1.0.0</code> pins exactly what a result was computed from. It is read-only: push changes with the CLI.
            </P>
          </DocSection>

          <DocSection title="Your own checks">
            <P>
              Put a file called <code className="font-mono text-foreground">.craton-checks.json</code> at the root of the repository and every push is judged against it, next to the built-in checks. The rules live in the repository, so they are reviewed in pull requests like the model and they travel with a clone.
            </P>
            <pre className="max-w-3xl overflow-x-auto border border-border bg-card p-4 text-xs leading-relaxed">{`{
  "version": 1,
  "checks": [
    { "name": "Terrain is on the project grid",
      "files": "terrain/*.tif",
      "expect": { "crs": 32643, "nodata": -9999, "cellSize": { "min": 5, "max": 30 },
                  "within": [75.9, 10.2, 76.4, 10.4] } },
    { "name": "Gauge tables", "files": "gauges/*.csv",
      "expect": { "columns": ["station", "datetime", "discharge"],
                  "notEmpty": ["discharge"], "numeric": { "discharge": { "min": 0 } },
                  "unique": ["station", "datetime"], "sorted": "datetime" } },
    { "name": "Plans ran cleanly", "files": "model/*.p??.hdf",
      "expect": { "run": { "stable": true, "maxWselError": { "max": 0.05 } } } },
    { "require": ["README.md", "model/*.prj"] },
    { "files": "**", "expect": { "maxBytes": "500MB" }, "severity": "warn" }
  ]
}`}</pre>
            <P>
              Expectations are judged only from what each file&rsquo;s own header says, and a kind of file that cannot answer one is skipped. If no matched file could answer it, the check says so instead of passing silently. An unknown key, a wrong type or a check that does nothing is itself a failure, with its path. Set <code className="font-mono text-foreground">&quot;severity&quot;: &quot;warn&quot;</code> to roll a rule out without blocking anyone.
            </P>
            <div className="grid max-w-3xl gap-2 text-sm text-muted-foreground sm:grid-cols-2">
              <p><span className="text-foreground">Rasters:</span> crs, nodata, cellSize, width, height, dataType, cog, within</p>
              <p><span className="text-foreground">Vectors:</span> crs, geometry, fields, features, within</p>
              <p><span className="text-foreground">Tables (CSV):</span> columns, rows, notEmpty, numeric, unique, sorted</p>
              <p><span className="text-foreground">Models and grids:</span> run, groups (HDF5), variables (NetCDF), points (LAS)</p>
              <p><span className="text-foreground">Any file:</span> minBytes, maxBytes, and require / forbid patterns</p>
            </div>
          </DocSection>

          <DocSection title="Secret scanning">
            <P>
              History can&rsquo;t be edited, so a password that lands in a commit stays there. Every push and every upload from the browser is therefore read first, and refused if a file it adds or changes holds a credential: a Craton access token that still works, a GitHub token, an AWS access key id, a Google API key or client secret, a Slack token, a Stripe live key, an Anthropic or OpenAI key, a private key, or a database address with a real password. Only text files up to 2 MB are read, and only what is new in the push, including commits a later commit undid.
            </P>
            <P>
              The message names the file and line and shows the first few characters, never the secret. Take it out and push again; if it was ever real, replace it at its source. A line that is only an example can carry <code className="font-mono text-sm text-foreground">craton:allow-secret</code>. An administrator of the repository who knows it is safe can push anyway with a reason (<code className="font-mono text-sm text-foreground">craton push --allow-secrets &quot;why&quot;</code>, or the same field on the API); the reason goes into the audit log, and a live Craton token that went into a public repository this way is revoked at once. New Craton tokens start with <code className="font-mono text-sm text-foreground">crt_pat_</code> and end in a checksum, so scanners (ours and others&rsquo;) can recognise them without guessing.
            </P>
          </DocSection>

          <DocSection title="Branches">
            <P>A branch is free until you change a file: it points at existing chunks. Use one per scenario, such as a levee raise or a new survey.</P>
            <CommandLine command="craton branch levee-scenario && craton switch levee-scenario" />
          </DocSection>

          <DocSection title="Pull requests">
            <P>Open a pull request to propose merging a branch. Checks validate CRS (rasters, shapefiles, GeoPackage layers and LAS point clouds), vertical datum, nodata, Cloud Optimized GeoTIFF layout (advisory unless the repository requires it), shapefile sets, HEC-RAS and SWMM model structure, point cloud headers and chunk integrity before a merge is allowed.</P>
          </DocSection>

          <DocSection title="Reviews">
            <P>Reviewers comment on the pull request, approve or ask for changes; each file shows its map or table diff. Branch protection can require passing checks, an approval of the latest commit, and approval from code owners.</P>
          </DocSection>

          <DocSection title="Model review">
            <P>
              Use the Model review tab when a model is ready to be checked. A review is pinned to one commit and its Merkle root, so the sign-off always means these exact files. It carries a QA checklist drawn from common flood-modelling practice (file and version management, terrain, mesh, roughness, boundaries, structures, run results, calibration, deliverables), a modelling log that is never edited, and a decision by a reviewer.
            </P>
            <P>
              The validation findings and each HEC-RAS plan&rsquo;s own run status are captured as evidence and shown beside the items they bear on. They are suggestions: a person marks every item. Approval needs every item decided and every failure explained. An author may approve their own review; the record then says it was not independent. The export is a Markdown document you can attach to a submission.
            </P>
          </DocSection>

          <DocSection title="Organization domains">
            <P>
              In an organization&rsquo;s settings, owners can claim the domain their team&rsquo;s email addresses use (for example <code className="font-mono text-sm text-foreground">hydrolab.org</code>) and prove it with a DNS TXT record Craton shows. A verified domain is marked on the organization&rsquo;s page. Switch on <em>Let people with a hydrolab.org address join</em> and anyone whose confirmed address ends there becomes a Member without an invitation; an address nobody has confirmed never counts, and removing the domain never removes anyone.
            </P>
          </DocSection>

          <DocSection title="Code owners">
            <P>
              A <code className="font-mono text-sm text-foreground">CODEOWNERS</code> file on the target branch lists a path pattern and one or more <code className="font-mono text-sm text-foreground">@people</code> per line;
              the last matching line wins. The owners of the files a pull request changes are asked to review when it opens, and the pull request page shows where each stands.
            </P>
          </DocSection>

          <DocSection title="Provenance">
            <P>
              Each commit has a Merkle root that proves every byte it contains. History is append-only: a rollback is recorded as a new commit.
              Export an audit package from a repository’s Storage tab to cite exact data in a report.
            </P>
          </DocSection>

          <DocSection title="CLI commands">
            <P>The full list with examples is on the CLI page.</P>
            <Link href="/cli" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              Command reference <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </DocSection>

          <DocSection title="REST API">
            <P>Everything in the web app is available over the API: repositories, commits, pull requests, checks and storage metrics.</P>
            <Link href="/api-reference" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
              API reference <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </DocSection>

          <DocSection title="Webhooks">
            <P>Get an HTTPS POST when something happens: a push, a pull request event, or a release. Payloads are signed with HMAC-SHA256; Settings → Webhooks shows each delivery and its response.</P>
            <P>
              To post into a chat room instead, paste a Slack, Microsoft Teams or Discord incoming-webhook address as the URL. Craton recognises it and sends a short message (who did what, where, with a link) in the shape that service reads, in place of the signed JSON. Names and titles are escaped so nothing a person types can ping the room, and the same events, retries and delivery log apply. A chat room cannot check a signature, so those webhooks have no secret: keep the address private.
            </P>
          </DocSection>

          <DocSection title="Rate limits">
            <P>API calls are limited to 1,200 per minute per token (per address when you are not signed in), with <code className="font-mono text-sm text-foreground">RateLimit-*</code> headers on every response and <code className="font-mono text-sm text-foreground">Retry-After</code> when you hit it. The CLI moves chunks a few at a time and retries; what you can store is limited by your plan.</P>
          </DocSection>

          <DocSection title="For agents and AI tools">
            <P>
              Every reading page has a Markdown version at the same address with <code className="font-mono text-sm text-foreground">.md</code> added (<code className="font-mono text-sm text-foreground">/docs.md</code>, <code className="font-mono text-sm text-foreground">/api-reference.md</code>, <code className="font-mono text-sm text-foreground">/cli.md</code> and the others), and the page itself answers with it when a request says <code className="font-mono text-sm text-foreground">Accept: text/markdown</code>. They are made from the pages people read, so they can&rsquo;t disagree with them.
            </P>
            <P>
              <a href="/llms.txt" className="text-accent underline underline-offset-2">/llms.txt</a> lists them in the llmstxt.org layout, <a href="/llms-full.txt" className="text-accent underline underline-offset-2">/llms-full.txt</a> is all of them in one file, and <a href="/skill.md" className="text-accent underline underline-offset-2">/skill.md</a> is an agent skill: how to sign in, the everyday commands and the rules that matter (pull before you push, locks, checks, secrets). The whole REST API is also an OpenAPI document at <code className="font-mono text-sm text-foreground">/v1/openapi.json</code>, and a read-only MCP server is described in the API reference.
            </P>
          </DocSection>
        </article>
      </div>
    </AppShell>
  );
}
