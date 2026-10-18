"use client";

// What a repository looks like before its first commit: the two ways to add data, side by side.
// This is the first page anyone sees after creating a repository, so it has to point somewhere.

import { FileUp, Terminal } from "lucide-react";
import { CommandLine, CopyButton } from "@/components/craton-actions";
import { UploadDialog } from "@/components/upload-dialog";
import { useSession } from "@/components/session";
import { useCanWrite } from "@/components/repo-context";

export function EmptyRepo({ owner, repo, defaultBranch, apiUrl }: { owner: string; repo: string; defaultBranch: string; apiUrl: string }) {
  const user = useSession();
  const canWrite = useCanWrite();
  // The first push, in order: sign in, point this folder at the repository, then stage, commit and upload.
  const steps = [`craton auth login --token <token> --server ${apiUrl}`, `craton init . --remote ${apiUrl}/${owner}/${repo}`, "craton add .", 'craton commit -m "First version"', "craton push"];

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold">
          {owner}/{repo} is empty
        </h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">
          {canWrite ? "Add your first files and Craton will check them, draw previews and keep every version. Pick whichever suits the size of your data." : "Nothing has been added to this repository yet."}
        </p>
      </div>

      {canWrite && (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="flex flex-col gap-3 border border-border bg-card p-5" aria-labelledby="from-browser">
            <div className="flex items-center gap-2">
              <FileUp className="size-4 text-muted-foreground" aria-hidden />
              <h2 id="from-browser" className="text-sm font-semibold">
                From your browser
              </h2>
            </div>
            <p className="text-sm text-muted-foreground text-pretty">Drop files or a whole folder. Best for a first look, a small model or a handful of rasters (up to 100 MB at a time).</p>
            <div>
              <UploadDialog owner={owner} repo={repo} branches={[defaultBranch]} defaultBranch={defaultBranch} currentRef={defaultBranch} empty />
            </div>
          </section>

          <section className="flex min-w-0 flex-col gap-3 border border-border bg-card p-5" aria-labelledby="from-cli">
            <div className="flex items-center gap-2">
              <Terminal className="size-4 text-muted-foreground" aria-hidden />
              <h2 id="from-cli" className="text-sm font-semibold">
                From the command line
              </h2>
            </div>
            <p className="text-sm text-muted-foreground text-pretty">
              For large datasets: uploads resume after a dropped connection and every chunk is verified. Sign in first with a token from{" "}
              <a href="/settings/tokens" className="underline underline-offset-2 hover:text-foreground">
                Settings
              </a>
              .
            </p>
            <div className="flex flex-col gap-1.5">
              {steps.map((command) => (
                <CommandLine key={command} command={command} />
              ))}
            </div>
            <div>
              <CopyButton value={steps.join(String.fromCharCode(10))} label="Copy all five commands" variant="outline" size="sm">
                Copy all five commands
              </CopyButton>
            </div>
            <p className="text-xs text-muted-foreground">
              New to the CLI? See the{" "}
              <a href="/cli" className="underline underline-offset-2 hover:text-foreground">
                install guide
              </a>
              .
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
