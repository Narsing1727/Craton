// The Python client is installable: its metadata parses, it has no dependencies, and the module imports from a
// copy in an empty folder (what pip would put in site-packages).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const sdk = path.resolve(import.meta.dirname, "../../sdk/python");

test("pyproject.toml parses, names the module, and asks for nothing else", () => {
  const script = `
import json, sys, tomllib
d = tomllib.load(open(sys.argv[1], "rb"))
print(json.dumps({"name": d["project"]["name"], "deps": d["project"]["dependencies"], "modules": d["tool"]["setuptools"]["py-modules"], "readme": d["project"]["readme"], "extra": d["project"]["optional-dependencies"], "entry": d["project"]["entry-points"]["fsspec.specs"]}))
`;
  const r = spawnSync("python", ["-c", script, path.join(sdk, "pyproject.toml")], { encoding: "utf8" });
  if (r.error || /No module named tomllib/.test(r.stderr)) return; // no Python 3.11 here: nothing to check
  assert.equal(r.status, 0, r.stderr);
  const meta = JSON.parse(r.stdout);
  assert.deepEqual([meta.name, meta.deps, meta.modules], ["craton-client", [], ["craton", "craton_fsspec"]]);
  // fsspec is an extra, not a dependency, and the filesystem is registered for tools that look it up by name.
  assert.deepEqual(meta.extra, { fsspec: ["fsspec>=2023.1"] });
  assert.deepEqual(meta.entry, { craton: "craton_fsspec:CratonFileSystem" });
  assert.ok(fs.existsSync(path.join(sdk, meta.readme)), "the README it names exists");
});

test("the module imports on its own and exposes the documented names", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-sdk-"));
  try {
    fs.copyFileSync(path.join(sdk, "craton.py"), path.join(dir, "craton.py"));
    const script = `
import sys; sys.path.insert(0, ${JSON.stringify(dir)})
import craton
names = ["Craton", "Repo", "CratonError"]
repo_methods = ["releases", "commits", "all_commits", "compare", "paths", "file_info", "read", "text", "table", "rows", "raster_stats", "locks", "create_issue", "create_release", "lock", "unlock"]
missing = [n for n in names if not hasattr(craton, n)] + [m for m in repo_methods if not hasattr(craton.Repo, m)]
print(",".join(missing) or "ok")
`;
    const r = spawnSync("python", ["-I", "-c", script], { encoding: "utf8", cwd: dir });
    if (r.error) return;
    assert.equal(r.stdout.trim(), "ok", r.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("every method the README names exists", () => {
  const readme = fs.readFileSync(path.join(sdk, "README.md"), "utf8");
  const code = fs.readFileSync(path.join(sdk, "craton.py"), "utf8");
  const named = new Set([...readme.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]));
  for (const n of ["repos", "releases", "commits", "all_commits", "compare", "paths", "file_info", "read", "text", "table", "rows", "raster_stats", "create_issue", "create_release", "lock", "unlock"]) {
    assert.ok(named.has(n), `README names ${n}`);
    assert.ok(code.includes(`def ${n}(`), `craton.py defines ${n}`);
  }
});
