// One list of commands: the dispatch table, `craton help`, and the CLI page on the website must agree.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { COMMANDS, commandDoc, detailText, listText, optionsOf } from "../src/cli/commands.ts";

const root = path.resolve(import.meta.dirname, "..");
const cli = fs.readFileSync(path.join(root, "src/cli/craton.ts"), "utf8");

test("every command that runs is documented, and every documented command runs", () => {
  const table = cli.slice(cli.indexOf("const commands: Record<string, () => Promise<void>> = {"));
  const keys = [...table.slice(0, table.indexOf("};")).matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]).filter((k) => k !== "help" && k !== "checkout");
  const documented = COMMANDS.map((c) => c.name);
  assert.deepEqual([...keys].sort(), [...documented].sort());
  assert.equal(new Set(documented).size, documented.length, "no command is documented twice");
});

test("every command has a usage line that starts with its name, a summary and a working example", () => {
  for (const c of COMMANDS) {
    assert.ok(c.usage.startsWith(`craton ${c.name}`), `${c.name}: usage`);
    assert.ok(c.summary.length > 5 && !c.summary.endsWith("."), `${c.name}: summary`);
    assert.ok(c.example.startsWith(`craton ${c.name}`), `${c.name}: example`);
    assert.ok(detailText(c).startsWith(c.usage), `${c.name}: the detail starts with the usage line`);
  }
  assert.match(listText(), /Run `craton help <command>`/);
  assert.equal(commandDoc("nope"), undefined);
});

test("help and --help print the same detail, and an unknown command is a usage error", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), ...args], { encoding: "utf8" });
  const a = run("help", "blame"), b = run("blame", "--help");
  assert.equal(a.status, 0);
  assert.equal(a.stdout, b.stdout);
  assert.equal(a.stdout.trim(), detailText(commandDoc("blame")!).trim());
  const unknown = run("help", "frobnicate");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /no command called frobnicate/);
  assert.match(execFileSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), "help"], { encoding: "utf8" }), /blame\s+Which commit rewrote/);
});

test("the CLI page on the website lists exactly the commands the CLI has", () => {
  const page = fs.readFileSync(path.resolve(root, "../frontend/app/cli/page.tsx"), "utf8");
  const mentioned = new Set([...page.matchAll(/cmd: "craton ([a-z]+)/g)].map((m) => m[1]));
  // A line may name two commands ("craton branch [name] · craton switch <branch>"); count both.
  for (const m of page.matchAll(/· craton ([a-z]+)/g)) mentioned.add(m[1]);
  for (const m of page.matchAll(/ craton (lock|unlock|locks)\b/g)) mentioned.add(m[1]);
  const missing = COMMANDS.map((c) => c.name).filter((n) => !mentioned.has(n));
  assert.deepEqual(missing, [], `add these to the CLI page: ${missing.join(", ")}`);
  const extra = [...mentioned].filter((n) => !commandDoc(n));
  assert.deepEqual(extra, [], `the CLI page names commands that do not exist: ${extra.join(", ")}`);
});

test("completion scripts name every command and its options, and the bash one really completes", () => {
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(root, "src/cli/craton.ts"), ...args], { encoding: "utf8" });
  for (const shell of ["bash", "zsh", "powershell"]) {
    const r = run("completion", shell);
    assert.equal(r.status, 0, r.stderr);
    for (const c of COMMANDS) assert.ok(r.stdout.includes(c.name), `${shell}: ${c.name}`);
  }
  assert.match(run("completion", "bash").stdout, /clone\) opts="[^"]*--only/);
  assert.equal(run("completion").status, 2);
  assert.equal(run("completion", "fish").status, 2);

  // Drive the bash script: complete the second word and the options of clone.
  const bash = spawnSync("bash", ["-c", `source <(node --disable-warning=ExperimentalWarning ${JSON.stringify(path.join(root, "src/cli/craton.ts"))} completion bash)
COMP_WORDS=(craton bl); COMP_CWORD=1; _craton; echo "cmds:\${COMPREPLY[*]}"
COMP_WORDS=(craton clone --o); COMP_CWORD=2; _craton; echo "opts:\${COMPREPLY[*]}"`], { encoding: "utf8" });
  if (bash.error) return; // no bash on this machine
  assert.match(bash.stdout, /cmds:blame/);
  assert.match(bash.stdout, /opts:--only/);
});

test("every craton command line shown on the website and in the docs uses a real command and real options", () => {
  const files = ["../frontend/app/docs/page.tsx", "../frontend/app/cli/page.tsx", "../frontend/app/page.tsx", "../frontend/app/about/page.tsx", "../frontend/app/help/page.tsx", "../OPERATING.md", "README.md"];
  const known = new Map(COMMANDS.map((c) => [c.name, new Set(optionsOf(c))]));
  const problems: string[] = [];
  let checked = 0;
  for (const rel of files) {
    const file = path.resolve(root, rel);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    // Lines in code: command="craton ...", cmd: "craton ...", and craton ... inside backticks or indented blocks.
    const lines = [...text.matchAll(/(?:command=["'{`]+|cmd:\s*["'`]|`|^\s{2,}|^craton |["'`] )craton ([a-z]+)([^"'`\n<]*)/gm)];
    for (const m of lines) {
      const name = m[1];
      if (name === "help" || name === "completion") continue;
      checked++;
      const opts = known.get(name);
      if (!opts) {
        // Prose such as "craton is" or "craton store": only flag when it looks like a command line (has an option or a path).
        if (/--|\//.test(m[2])) problems.push(`${rel}: craton ${name}${m[2]} (no such command)`);
        continue;
      }
      for (const o of m[2].matchAll(/--[a-z][a-z-]*/g)) if (!opts.has(o[0])) problems.push(`${rel}: craton ${name} ${o[0]} (not an option of ${name})`);
    }
  }
  assert.ok(checked >= 10, `${checked} command lines checked`);
  assert.deepEqual(problems, [], problems.join(String.fromCharCode(10)));
});
