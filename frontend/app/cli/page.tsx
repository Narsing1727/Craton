import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Gauge, RotateCcw, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { IconTile } from "@/components/reui/icon-tile";
import { CommandLine } from "@/components/craton-actions";
import { PUBLIC_API_URL } from "@/lib/api";
import { PageHeader, Section } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/cli.md" } },
  title: "Install the CLI",
  description: "Install the Craton CLI on macOS, Linux or Windows and push your first geospatial dataset.",
};

// Matches `craton help` (backend/src/cli/craton.ts).
const commands = [
  { cmd: "craton init [folder]", what: "Start a repository in a folder" },
  { cmd: "craton remote add origin <url>", what: "Set where to push: the API address, then owner/repo" },
  { cmd: "craton auth login --token <token>", what: "Sign in with a personal access token from Settings" },
  { cmd: "craton clone <owner>/<repo> [--tag v1.2.0] [--only terrain/,gauges.csv] [--json]", what: "Download a repository, one release, or only some folders; the rest stays in history" },
  { cmd: "craton sparse [add <paths…> | all]", what: "See or widen which folders are in the working folder, downloading only what is missing" },
  { cmd: "craton add [paths…]", what: "Stage files. Files another program is still writing wait until they’re stable" },
  { cmd: "craton status [--json]", what: "What changed since the last commit, in chunks, not just bytes; --json for scripts (also on log, branch, locks, diff, stats, blame)" },
  { cmd: "craton commit -m \"<message>\"", what: "Record a new version and its Merkle root" },
  { cmd: "craton push [--json]", what: "Upload only chunks the server doesn’t have; retries dropped connections; --json prints one event per line" },
  { cmd: "craton pull", what: "Fast-forward to the server’s branch, downloading only what differs" },
  { cmd: "craton branch [name] · craton switch <branch>", what: "List or create branches; switching downloads only what differs" },
  { cmd: "craton revert <commit>", what: "Undo a commit by adding a new one; history is never rewritten" },
  { cmd: "craton webhook verify --secret S --id ID --timestamp T --signature SIG", what: "Check a webhook delivery's signature the way a receiver should" },
  { cmd: "craton completion bash|zsh|powershell", what: "Print a tab-completion script for commands and their options" },
  { cmd: "craton doctor [--json]", what: "Why isn’t it working: Node version, the server, your token, access to the repository, free disk, each with the fix" },
  { cmd: "craton fsck [--verify]", what: "Check working files, and with --verify every chunk, against the Merkle root" },
  { cmd: "craton lock <path> [--reason \"why\"] · craton unlock <path> · craton locks", what: "Say you are editing a file; files others lock turn read-only until released" },
  { cmd: "craton log [path] [-n 20]", what: "History of the branch, or only the commits that changed one file" },
  { cmd: "craton blame <path> [--ref <ref>]", what: "Which commit rewrote each part of a file, by byte range (chunk-exact)" },
  { cmd: "craton diff [from [to]] [--text <path>]", what: "Files that differ between two versions and how many chunks were rewritten; --text prints the changed lines of one text file" },
  { cmd: "craton stats <raster.tif> [--base <ref>]", what: "Cell statistics and the change against an earlier version; --json for scripts" },
  { cmd: "craton stats <table.csv> --obs <col> --sim <col> [--by <col>]", what: "Nash-Sutcliffe, KGE, PBIAS and RMSE of a simulated column, per station with --by" },
];

const reasons = [
  { icon: Gauge, title: "Only new bytes move", body: "Content-defined chunking means a re-tiled DEM uploads the tiles that changed, not 2.8 GB." },
  { icon: RotateCcw, title: "Resumes anywhere", body: "Field connections drop. Transfers pick up at the last verified chunk." },
  { icon: ShieldCheck, title: "Verified on arrival", body: "Every chunk is checked against the commit’s Merkle root before it’s written." },
];

export default function CliPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-10 px-4 sm:px-6 py-10">
        <PageHeader
          eyebrow="Craton CLI 0.1"
          title="Install the CLI"
          description="Big terrain, LiDAR and model files move through the CLI: it sends only new chunks, resumes, and verifies everything it receives."
        />

        <Section title="1. Install">
          <div className="flex flex-col gap-2">
            <CommandLine command="cd backend && npm install && npm link" />
            <p className="text-xs text-muted-foreground text-pretty">
              From the Craton source, with Node.js 23.6 or later. There are no packaged installers (npm, Homebrew, winget) yet; they come with the first public release.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Check it worked with <code className="bg-muted px-1 py-0.5 font-mono">craton help</code>.
          </p>
        </Section>

        <Section title="2. Sign in" description="Create a personal access token with the repo scope in Settings → Personal access tokens, then paste it once. It’s saved in ~/.craton.">
          <CommandLine command={`craton auth login --token <token> --server ${PUBLIC_API_URL}`} />
        </Section>

        <Section title="3. Push a project" description="Create the repository on Craton first, then point the folder at it.">
          <div className="flex flex-col gap-2">
            <CommandLine command={`craton init river-model --remote ${PUBLIC_API_URL}/you/river-model`} />
            <CommandLine command="craton add terrain/ vectors/ model/" />
            <CommandLine command={'craton commit -m "Initial import"'} />
            <CommandLine command="craton push" />
          </div>
        </Section>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {reasons.map((r) => (
            <div key={r.title} className="flex flex-col gap-2 border border-border bg-card p-4">
              <IconTile variant="outline" size="sm">
                <r.icon />
              </IconTile>
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground text-pretty">{r.body}</p>
            </div>
          ))}
        </div>

        <Section title="Command reference">
          <div className="border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[45%]">Command</TableHead>
                  <TableHead>What it does</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commands.map((c) => (
                  <TableRow key={c.cmd}>
                    <TableCell className="font-mono text-xs" translate="no">{c.cmd}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-normal">{c.what}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="mt-3 max-w-3xl text-xs text-muted-foreground text-pretty">
            Exit codes: <code className="font-mono text-foreground">0</code> it worked, <code className="font-mono text-foreground">1</code> it failed (a bad reference, a refused push,
            a failing <code className="font-mono text-foreground">fsck</code>), <code className="font-mono text-foreground">2</code> a usage mistake (a missing argument, an unknown command).
            Errors go to stderr; with <code className="font-mono text-foreground">--json</code> the result goes to stdout, one object per line for <code className="font-mono text-foreground">push</code>.
          </p>
        </Section>

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-6">
          <Button href="/docs">
            Read the docs
            <ArrowRight data-icon="inline-end" />
          </Button>
          <Button variant="outline" href="/settings/developer">
            Tokens and integrations
          </Button>
          <span className="text-xs text-muted-foreground">
            Runs anywhere Node.js 23.6+ runs. <Link href="/changelog" className="underline underline-offset-2 hover:text-foreground">Release notes</Link>
          </span>
        </div>
      </div>
    </AppShell>
  );
}
