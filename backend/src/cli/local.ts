// The local repository in `.craton/`: config, HEAD, refs, objects and the staging index.
// Working files are never copied into `.craton`: the index records each file's chunks, and
// push reads those byte ranges straight from the working file (after re-verifying them).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { CratonObject, BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { canonicalJson, objectId } from "../core/objects.ts";

export type LocalConfig = {
  remote: string | null;
  branch: string;
  /** Sparse checkout: only paths under these prefixes are written to the working folder. Everything stays in history. */
  sparse?: string[];
};
export type IndexEntry = {
  size: number;
  mtimeMs: number;
  blob: string;
  /** In the repository but not written to the working folder because it is outside the sparse set. */
  absent?: boolean;
};
export type Index = { entries: Record<string, IndexEntry> };

export class CliError extends Error {}

/** Sparse prefixes as typed: forward slashes, no leading ./ or trailing /, no empties. */
export function normaliseSparse(list: string[]): string[] {
  return [...new Set(list.map((s) => s.trim().replace(/\\/g, "/").replace(/^\.?\//, "").replace(/\/+$/, "")).filter(Boolean))];
}

/** Whether a path is written to the working folder under a sparse set (no set means everything is). */
export function inSparse(sparse: string[] | undefined, p: string): boolean {
  if (!sparse || sparse.length === 0) return true;
  return sparse.some((s) => p === s || p.startsWith(`${s}/`));
}

export class LocalRepo {
  readonly root: string;
  readonly dir: string;
  private readonly madeDirs = new Set<string>();

  constructor(root: string) {
    this.root = root;
    this.dir = path.join(root, ".craton");
  }

  static find(start = process.cwd()): LocalRepo {
    let dir = path.resolve(start);
    while (true) {
      if (fs.existsSync(path.join(dir, ".craton", "config.json"))) return new LocalRepo(dir);
      const parent = path.dirname(dir);
      if (parent === dir) throw new CliError("Not a Craton repository (or any parent). Run `craton init` or `craton clone`.");
      dir = parent;
    }
  }

  static init(root: string, config: LocalConfig): LocalRepo {
    const repo = new LocalRepo(root);
    if (fs.existsSync(path.join(repo.dir, "config.json"))) throw new CliError(`Already a Craton repository: ${root}`);
    fs.mkdirSync(path.join(repo.dir, "objects"), { recursive: true });
    fs.mkdirSync(path.join(repo.dir, "refs"), { recursive: true });
    repo.writeConfig(config);
    fs.writeFileSync(path.join(repo.dir, "HEAD"), config.branch);
    repo.writeIndex({ entries: {} });
    return repo;
  }

  config(): LocalConfig {
    return JSON.parse(fs.readFileSync(path.join(this.dir, "config.json"), "utf8"));
  }
  writeConfig(c: LocalConfig) {
    fs.writeFileSync(path.join(this.dir, "config.json"), JSON.stringify(c, null, 2) + "\n");
  }

  head(): string {
    return fs.readFileSync(path.join(this.dir, "HEAD"), "utf8").trim();
  }
  setHead(branch: string) {
    fs.writeFileSync(path.join(this.dir, "HEAD"), branch);
  }

  refFile(branch: string) {
    return path.join(this.dir, "refs", ...branch.split("/"));
  }
  ref(branch: string): string | null {
    try {
      return fs.readFileSync(this.refFile(branch), "utf8").trim() || null;
    } catch {
      return null;
    }
  }
  setRef(branch: string, commit: string) {
    fs.mkdirSync(path.dirname(this.refFile(branch)), { recursive: true });
    fs.writeFileSync(this.refFile(branch), commit);
  }
  branches(): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.isDirectory()) walk(path.join(dir, e.name), `${prefix}${e.name}/`);
        else out.push(`${prefix}${e.name}`);
      }
    };
    walk(path.join(this.dir, "refs"), "");
    return out.sort();
  }

  private objectPath(id: string) {
    return path.join(this.dir, "objects", id.slice(0, 2), `${id}.json`);
  }
  putObject(obj: CratonObject): string {
    const id = objectId(obj);
    const file = this.objectPath(id);
    if (!fs.existsSync(file)) {
      const dir = path.dirname(file);
      if (!this.madeDirs.has(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.madeDirs.add(dir);
      }
      fs.writeFileSync(file, canonicalJson(obj));
    }
    return id;
  }
  hasObject(id: string) {
    return fs.existsSync(this.objectPath(id));
  }
  getObject<T extends CratonObject>(id: string): T {
    try {
      return JSON.parse(fs.readFileSync(this.objectPath(id), "utf8")) as T;
    } catch {
      throw new CliError(`Object ${id.slice(0, 7)} is missing locally.`);
    }
  }
  blob(id: string) {
    return this.getObject<BlobObject>(id);
  }
  tree(id: string) {
    return this.getObject<TreeObject>(id);
  }
  commit(id: string) {
    return this.getObject<CommitObject>(id);
  }

  index(): Index {
    return JSON.parse(fs.readFileSync(path.join(this.dir, "index.json"), "utf8"));
  }
  writeIndex(i: Index) {
    const sorted = Object.fromEntries(Object.entries(i.entries).sort(([a], [b]) => (a < b ? -1 : 1)));
    fs.writeFileSync(path.join(this.dir, "index.json"), JSON.stringify({ entries: sorted }, null, 1));
  }

  /** Repository-relative path with forward slashes. */
  rel(abs: string) {
    return path.relative(this.root, abs).split(path.sep).join("/");
  }
  abs(rel: string) {
    return path.join(this.root, ...rel.split("/"));
  }

  /** Commits reachable from `id`, newest first (by timestamp). */
  log(id: string | null, limit = 1000) {
    const seen = new Set<string>();
    const out: (CommitObject & { id: string })[] = [];
    const queue = id ? [id] : [];
    while (queue.length && out.length < limit * 4) {
      const cur = queue.shift()!;
      if (seen.has(cur) || !this.hasObject(cur)) continue;
      seen.add(cur);
      const c = this.commit(cur);
      out.push({ ...c, id: cur });
      queue.push(...c.parents);
    }
    return out.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, limit);
  }
}

// ── Credentials (~/.craton/credentials.json) ──────────────────────────────

const credFile = () => path.join(process.env.CRATON_HOME ?? path.join(os.homedir(), ".craton"), "credentials.json");
type Creds = { servers: Record<string, { token: string; handle?: string }> };

export function readCreds(): Creds {
  try {
    return JSON.parse(fs.readFileSync(credFile(), "utf8"));
  } catch {
    return { servers: {} };
  }
}
export function saveToken(server: string, token: string, handle?: string) {
  const c = readCreds();
  c.servers[server] = { token, handle };
  fs.mkdirSync(path.dirname(credFile()), { recursive: true });
  fs.writeFileSync(credFile(), JSON.stringify(c, null, 2), { mode: 0o600 });
}
export function tokenFor(server: string) {
  return process.env.CRATON_TOKEN ?? readCreds().servers[server]?.token ?? null;
}
export function handleFor(server: string | null) {
  return process.env.CRATON_AUTHOR ?? (server ? readCreds().servers[server]?.handle : undefined) ?? os.userInfo().username.toLowerCase();
}

/** "http://host:4000/owner/repo" → server and repository. */
export function parseRemote(url: string) {
  const u = new URL(url);
  const [owner, name] = u.pathname.replace(/^\/+|\/+$/g, "").split("/");
  if (!owner || !name) throw new CliError(`Remote must look like http://host/owner/repo, got ${url}`);
  return { server: u.origin, owner, name };
}
