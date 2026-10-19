import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { PageHero, PageSection, WhereNext } from "@/components/marketing";

export const metadata: Metadata = {
  title: "Guides",
  description: "Short walk-throughs of real tasks: version a HEC-RAS model, review a DEM re-survey, share data, publish a release, lock a file, write your own checks.",
};

type Step = { text: string; command?: string };
const guides: { id: string; title: string; lead: string; steps: Step[] }[] = [
  {
    id: "version-a-model",
    title: "Version a HEC-RAS model",
    lead: "Put a model and its terrain under version control from your own folder.",
    steps: [
      { text: "Make a personal access token in Settings, under Personal access tokens, and sign the command line in with it.", command: "craton auth login --token crt_pat_… --server http://localhost:4000" },
      { text: "Start a repository in the model folder and say where it lives. Create the empty repository on the website first, from New.", command: "craton init . --remote http://localhost:4000/you/river-model" },
      { text: "Add the terrain and the model, and record the first version.", command: "craton add terrain/ model/\ncraton commit -m \"Initial import\"" },
      { text: "Upload it. Only chunks the server does not already have are sent, and an interrupted push carries on where it stopped.", command: "craton push" },
      { text: "Open the repository on the website. The checks for coordinate system, datum, nodata and model references have run on the push." },
    ],
  },
  {
    id: "review-a-resurvey",
    title: "Review a DEM re-survey",
    lead: "Replace a terrain file on a branch and let reviewers see what moved.",
    steps: [
      { text: "Work on a branch, so main is untouched.", command: "craton branch resurvey\ncraton switch resurvey" },
      { text: "Replace the file with the new survey, then record and push it.", command: "craton add terrain/basin_dem.tif\ncraton commit -m \"Re-survey rows 600 to 640\"\ncraton push" },
      { text: "On the website, open a pull request from the branch. The file's page offers Change since, a map of where the ground rose and fell with the area and volume, and Swipe to compare." },
      { text: "Reviewers comment, approve and merge. If it was wrong, revert it: that is a new commit, and the history stays whole.", command: "craton revert 3f9c2a1" },
    ],
  },
  {
    id: "share-without-sending-files",
    title: "Share data without sending files",
    lead: "Give someone a version to look at or download, without email attachments.",
    steps: [
      { text: "For a person outside the team, open the repository's Settings, then Sharing, and make a link to one version. It expires, and its address is the only password, so send it only to them." },
      { text: "For everyone, make the repository public. Anyone can browse its files on the website and clone it." },
      { text: "To take only part of a large repository, name the folders you need.", command: "craton clone hydrolab/chalakudy-basin --only terrain/" },
    ],
  },
  {
    id: "publish-a-release",
    title: "Publish a release for a study",
    lead: "Pin the exact data a report used, with checksums.",
    steps: [
      { text: "In the repository, open Releases and make a new one on the commit you used. Name it for the report, such as v1.0.0." },
      { text: "Anyone can fetch exactly that version later.", command: "craton clone you/river-model --tag v1.0.0" },
      { text: "And confirm that no byte has changed since.", command: "craton fsck --verify" },
    ],
  },
  {
    id: "lock-a-file",
    title: "Stop two people editing one model file",
    lead: "Some files cannot be merged. Take the lock before you change one.",
    steps: [
      { text: "Say you are editing it. Everyone else's copy turns read-only.", command: "craton lock model/river.g01 --reason \"recalibrating\"" },
      { text: "Edit, record and push as usual. Then let it go.", command: "craton unlock model/river.g01" },
      { text: "To see who holds what:", command: "craton locks" },
    ],
  },
  {
    id: "write-your-own-checks",
    title: "Write your own checks",
    lead: "Turn the rules your team keeps in its head into something every push is judged against.",
    steps: [
      { text: "Put a file called .craton-checks.json at the root of the repository. This one requires every terrain file to be on the project grid:", command: "{\n  \"version\": 1,\n  \"checks\": [\n    { \"name\": \"Terrain is on the project grid\",\n      \"files\": \"terrain/*.tif\",\n      \"expect\": { \"crs\": 32643, \"nodata\": -9999 } }\n  ]\n}" },
      { text: "Commit and push it like any other file. Because it lives in the repository, changes to the rules are reviewed in pull requests." },
      { text: "To introduce a rule gently, add \"severity\": \"warn\" to it. It then reports without blocking anyone. The documentation lists everything a rule can expect." },
    ],
  },
];

export default function GuidesPage() {
  return (
    <AppShell>
      <PageHero title="Guides" lead="Short walk-throughs of the things people do most. Each one uses only what exists today." />

      <section className="w-full border-b border-border">
        <nav aria-label="Guides" className="flex w-full flex-col gap-1.5 px-4 py-8 text-sm sm:px-6 lg:px-8 xl:px-10">
          {guides.map((g) => (
            <a key={g.id} href={`#${g.id}`} className="w-fit underline-offset-2 hover:underline">
              {g.title}
            </a>
          ))}
        </nav>
      </section>

      {guides.map((g) => (
        <PageSection key={g.id} id={g.id} title={g.title} lead={g.lead}>
          <ol className="flex max-w-3xl flex-col gap-5">
            {g.steps.map((s, i) => (
              <li key={i} className="grid grid-cols-[1.5rem_1fr] gap-3">
                <span className="text-sm tabular-nums text-muted-foreground">{i + 1}.</span>
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="text-sm text-pretty">{s.text}</p>
                  {s.command && (
                    <pre tabIndex={0} className="overflow-x-auto border border-border bg-card p-3 font-mono text-xs leading-relaxed">
                      {s.command}
                    </pre>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </PageSection>
      ))}

      <section className="w-full">
        <p className="w-full px-4 py-10 text-sm text-muted-foreground sm:px-6 lg:px-8 xl:px-10">
          Every command is listed on the{" "}
          <Link href="/cli" className="underline underline-offset-2 hover:text-foreground">
            command line page
          </Link>
          , and the rest is in the{" "}
          <Link href="/docs" className="underline underline-offset-2 hover:text-foreground">
            documentation
          </Link>
          .
        </p>
      </section>
    </AppShell>
  );
}
