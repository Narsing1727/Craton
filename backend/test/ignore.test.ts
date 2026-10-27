// .cratonignore lines mean what they mean in git: a bare name matches at any depth, a slash inside anchors it to the repository root, a trailing
// slash means folders only, `**` crosses folders. Before this, `build/` ignored nothing and `*.bak` only matched at the top level, so files people
// meant to keep out of the repository (and off the server) were uploaded.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ignoreRegExp, ignoreRules, walk } from "../src/cli/files.ts";

const cases: [pattern: string, file: string, ignored: boolean][] = [
  ["scratch/", "c14/scratch/notes.txt", true],
  ["scratch/", "scratch/a", true],
  ["scratch/", "scratch", false], // a file called scratch is not a folder
  ["scratch/", "myscratch/a", false],
  ["build/", "build", false],
  ["build/", "build/out/x.o", true],
  ["*.tmp", "a/b/work.tmp", true],
  ["*.tmp", "work.tmp", true],
  ["*.tmp", "work.tmpx", false],
  ["*.bak", "deep/er/model.bak", true],
  ["data/raw", "data/raw/x.tif", true],
  ["data/raw", "other/data/raw/x.tif", false],
  ["/out", "out/a", true],
  ["/out", "x/out/a", false],
  ["**/cache", "a/b/cache/x", true],
  ["a/**", "a/b/c", true],
  ["a/**/z", "a/z", true],
  ["a/**/z", "a/b/c/z", true],
  ["file?.txt", "file1.txt", true],
  ["file?.txt", "file12.txt", false],
  ["*.v1.0", "a.v1.0", true],
  ["*.v1.0", "a.v1x0", false],
  ["terrain/*.tif", "terrain/a.tif", true],
  ["terrain/*.tif", "terrain/sub/a.tif", false],
  ["a+b (1).txt", "a+b (1).txt", true], // regular-expression characters in a name are just characters
];

test("each kind of line matches the paths git would match", () => {
  for (const [pattern, file, ignored] of cases) assert.equal(ignoreRegExp(pattern).test(file), ignored, `${pattern} on ${file}`);
});

test("a folder walk leaves out ignored folders and files at every depth, and keeps the rest", () => {
  const dir = fs.mkdtempSync(path.join(process.env.TEMP ?? os.tmpdir(), "craton-ignore-"));
  try {
    const put = (p: string) => {
      fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
      fs.writeFileSync(path.join(dir, p), "x");
    };
    fs.writeFileSync(path.join(dir, ".cratonignore"), "# comments and blank lines are skipped\n\nscratch/\n*.bak\r\n/top-only.txt\nbuild/\n");
    for (const p of ["keep.txt", "a/keep.txt", "scratch/x.txt", "a/scratch/y.txt", "m.bak", "a/b/m.bak", "top-only.txt", "a/top-only.txt", "build", "a/build/o.bin"]) put(p);
    const rules = ignoreRules(dir);
    assert.deepEqual(walk(dir, dir, rules).filter((f) => f !== ".cratonignore"), ["a/keep.txt", "a/top-only.txt", "build", "keep.txt"]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
