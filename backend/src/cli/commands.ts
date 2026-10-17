// The one list of commands: `craton help` and `craton help <command>` print from it, and tests keep the CLI page on
// the website and the dispatch table in craton.ts in step with it.

export type CommandDoc = {
  name: string;
  /** The usage line, as typed. */
  usage: string;
  /** One line for the list. */
  summary: string;
  /** Options and what they do. */
  options?: [string, string][];
  /** A line to copy. */
  example: string;
  /** Things worth knowing that the summary can't hold. */
  notes?: string[];
};

export const COMMANDS: CommandDoc[] = [
  { name: "init", usage: "craton init [folder] [--remote URL] [--branch NAME]", summary: "Start a repository", options: [["--remote URL", "where to push, as http://host/owner/repo"], ["--branch NAME", "the first branch (default main)"]], example: "craton init . --remote http://localhost:4000/you/river-model" },
  { name: "remote", usage: "craton remote add origin URL", summary: "Set where to push (http://host/owner/repo)", example: "craton remote add origin http://localhost:4000/you/river-model" },
  { name: "auth", usage: "craton auth login --token T [--server S]", summary: "Sign in with a personal access token", options: [["--token T", "a token from Settings → Personal access tokens (or set CRATON_TOKEN)"], ["--server S", "the API address (default http://localhost:4000)"]], example: "craton auth login --token crt_pat_… --server http://localhost:4000", notes: ["The token is saved in ~/.craton (CRATON_HOME)."] },
  { name: "add", usage: "craton add [paths…]", summary: "Stage files (only changed chunks are recorded)", example: "craton add terrain/ vectors/", notes: ["Waits until a file stops changing before reading it, and skips lock files other programs hold."] },
  { name: "status", usage: "craton status [--json]", summary: "What changed, in chunks, since the last commit", options: [["--json", "machine-readable output"]], example: "craton status" },
  { name: "commit", usage: "craton commit -m \"message\"", summary: "Record a version with its Merkle root", options: [["-m, --message", "what changed, for the history"]], example: "craton commit -m \"Re-survey rows 600 to 640\"" },
  { name: "log", usage: "craton log [path] [-n 20] [--json]", summary: "History of the current branch, or of one file", options: [["-n N", "how many entries (default 20)"], ["--json", "machine-readable output"]], example: "craton log terrain/basin_dem.tif", notes: ["With a path, the history comes from the server (up to its 20 most recent changes to that file)."] },
  { name: "push", usage: "craton push [--json]", summary: "Upload new chunks and move the branch", options: [["--json", "one JSON event per line: plan, upload progress, done"], ["--branch B", "push a branch other than the current one"], ["--allow-secrets WHY", "repository administrators: push even though the secret scan found something, and say why (recorded in the audit log)"]], example: "craton push", notes: ["Only chunks the server does not have are uploaded; dropped connections are retried.", "The server refuses a push that contains a credential (a token, a cloud key, a private key) and says where."] },
  { name: "clone", usage: "craton clone URL|owner/repo [folder] [--branch B] [--tag T] [--only a/,b.csv] [--json]", summary: "Download a repository", options: [["--branch B", "a branch other than the default"], ["--tag T", "a release, e.g. v1.2.0"], ["--only LIST", "only these folders or files, comma separated; the rest stays in history"], ["--server URL", "the API address when you give owner/repo"], ["--json", "one JSON result"]], example: "craton clone hydrolab/chalakudy-basin --only terrain/", notes: ["An interrupted clone resumes when you run the same command again."] },
  { name: "pull", usage: "craton pull [--json]", summary: "Fast-forward to the server's branch", options: [["--json", "one JSON result"]], example: "craton pull" },
  { name: "branch", usage: "craton branch [name] [--json]", summary: "List branches, or create one", options: [["--json", "machine-readable list"]], example: "craton branch levee-scenario" },
  { name: "switch", usage: "craton switch <branch>", summary: "Change branch (downloads only what differs)", example: "craton switch levee-scenario", notes: ["Refuses while you have uncommitted changes that the switch would overwrite."] },
  { name: "revert", usage: "craton revert <commit>", summary: "Undo a commit with a new commit", example: "craton revert 3f9c2a1", notes: ["History is never rewritten: the undo is a new commit."] },
  { name: "fsck", usage: "craton fsck [--verify]", summary: "Check working files and the Merkle root", options: [["--verify", "re-hash every file and every staged chunk"]], example: "craton fsck --verify" },
  { name: "lock", usage: "craton lock <path> [--reason \"why\"]", summary: "Say you're editing a file nobody else should change", options: [["--reason TEXT", "shown to others who see the lock"]], example: "craton lock model/river.g01 --reason \"recalibrating\"", notes: ["Files someone else locks turn read-only in your folder until released."] },
  { name: "unlock", usage: "craton unlock <path> [--force]", summary: "Release your lock", options: [["--force", "a repository admin releasing someone else's lock"]], example: "craton unlock model/river.g01" },
  { name: "locks", usage: "craton locks [--json]", summary: "Who holds which locks", options: [["--json", "machine-readable list"]], example: "craton locks" },
  { name: "completion", usage: "craton completion bash|zsh|powershell", summary: "Print a tab-completion script for your shell", example: "craton completion bash > ~/.craton-completion.bash", notes: ["Completes command names and each command's options."] },
  { name: "webhook", usage: "craton webhook verify --secret S --id ID --timestamp T --signature SIG [--body-file F] [--tolerance SECONDS]", summary: "Check a webhook delivery's signature the way a receiver should", options: [["--secret S", "the whsec_ secret shown once when the webhook was created"], ["--id ID", "the webhook-id header"], ["--timestamp T", "the webhook-timestamp header"], ["--signature SIG", "the webhook-signature header (one or more v1,... values)"], ["--body-file F", "the raw body as received (default: standard input)"], ["--tolerance N", "seconds of clock difference to accept (default 300; 0 skips the check)"]], example: "craton webhook verify --secret whsec_... --id msg_... --timestamp 1760000000 --signature \"v1,...\" --body-file body.json", notes: ["Exits 0 and says valid, or exits 1 and says why not. Verify the raw body, before parsing it."] },
  { name: "doctor", usage: "craton doctor [--json]", summary: "Check Node, the server, your token, access and disk space", options: [["--json", "machine-readable report"]], example: "craton doctor", notes: ["Exits 1 only when something is broken."] },
  { name: "sparse", usage: "craton sparse [add paths… | all]", summary: "Which folders are in the working folder", example: "craton sparse add terrain/tamil-nadu/", notes: ["Widening downloads only what is missing. To shrink, clone again with --only."] },
  { name: "blame", usage: "craton blame <path> [--ref R] [--json]", summary: "Which commit rewrote each part of a file", options: [["--ref R", "a branch, tag or commit (default: your current commit)"], ["--json", "machine-readable output"]], example: "craton blame terrain/basin_dem.tif", notes: ["Needs the server; the commit must have been pushed."] },
  { name: "diff", usage: "craton diff [from [to]] [--text path] [--json]", summary: "Files that differ between two versions, and chunks rewritten", options: [["--text PATH", "the changed lines of one text file instead"], ["--json", "machine-readable output"]], example: "craton diff v1.0.0", notes: ["With no arguments: the last commit against the one before it."] },
  { name: "stats", usage: "craton stats <raster.tif> [--base REF] [--ref REF] [--json]  |  craton stats <table.csv> --obs C --sim C [--by C]", summary: "Cell statistics and change, or the fit of simulated against observed", options: [["--base REF", "the earlier version to compare a raster with (default: the commit before)"], ["--obs C --sim C", "observed and simulated columns of a table"], ["--by C", "report each value of this column (a station) separately"], ["--json", "machine-readable output"]], example: "craton stats terrain/basin_dem.tif --base v1.0.0" },
];

const byName = new Map(COMMANDS.map((c) => [c.name, c]));
export const commandDoc = (name: string) => byName.get(name);

export function listText(): string {
  const width = Math.max(...COMMANDS.map((c) => c.name.length));
  return ["craton: version control for geospatial data", "", ...COMMANDS.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`), "", "Run `craton help <command>` for options and an example."].join(String.fromCharCode(10));
}

export function detailText(c: CommandDoc): string {
  const NL = String.fromCharCode(10);
  const out = [c.usage, "", c.summary + "."];
  if (c.options?.length) {
    const w = Math.max(...c.options.map(([o]) => o.length));
    out.push("", "Options:", ...c.options.map(([o, d]) => `  ${o.padEnd(w)}  ${d}`));
  }
  if (c.notes?.length) out.push("", ...c.notes);
  out.push("", "Example:", `  ${c.example}`);
  return out.join(NL);
}

/** Long options (--like-this) a command takes, from its option list, plus --help. */
export function optionsOf(c: CommandDoc): string[] {
  const found = new Set<string>(["--help"]);
  for (const [flags] of c.options ?? []) for (const m of flags.matchAll(/--[a-z][a-z-]*/g)) found.add(m[0]);
  return [...found];
}

export type Shell = "bash" | "zsh" | "powershell";
export const SHELLS: Shell[] = ["bash", "zsh", "powershell"];

/** A completion script for the shell: commands at the first word, that command's options after it. */
export function completionScript(shell: Shell): string {
  const NL = String.fromCharCode(10);
  const names = [...COMMANDS.map((c) => c.name), "help"];
  if (shell === "powershell") {
    const cases = COMMANDS.map((c) => `    '${c.name}' { @(${optionsOf(c).map((o) => `'${o}'`).join(", ")}) }`).join(NL);
    return [
      "# craton completion for PowerShell: add to your profile, or run once per session",
      "Register-ArgumentCompleter -Native -CommandName craton -ScriptBlock {",
      "  param($wordToComplete, $commandAst, $cursorPosition)",
      "  $words = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })",
      "  $candidates = if ($words.Count -le 1 -or ($words.Count -eq 2 -and $wordToComplete)) {",
      `    @(${names.map((n) => `'${n}'`).join(", ")})`,
      "  } else {",
      "    switch ($words[1]) {",
      cases,
      "      default { @() }",
      "    }",
      "  }",
      "  $candidates | Where-Object { $_ -like \"$wordToComplete*\" } | ForEach-Object { [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_) }",
      "}",
      "",
    ].join(NL);
  }
  const cases = COMMANDS.map((c) => `    ${c.name}) opts="${optionsOf(c).join(" ")}" ;;`).join(NL);
  const body = [
    "_craton() {",
    '  local cur="${COMP_WORDS[COMP_CWORD]}" cmd="${COMP_WORDS[1]}" opts=""',
    "  if [ \"$COMP_CWORD\" -eq 1 ]; then",
    `    COMPREPLY=( $(compgen -W "${names.join(" ")}" -- "$cur") )`,
    "    return",
    "  fi",
    '  case "$cmd" in',
    cases,
    "  esac",
    '  COMPREPLY=( $(compgen -W "$opts" -- "$cur") )',
    "}",
    "complete -F _craton craton",
    "",
  ];
  if (shell === "zsh") return ["# craton completion for zsh: save as _craton on your $fpath, or source it", "autoload -U +X bashcompinit && bashcompinit", ...body].join(NL);
  return ["# craton completion for bash: source this file, e.g. from ~/.bashrc", ...body].join(NL);
}
