// Releases: immutable, citable snapshots with pinned checksums and a Merkle root.
// The server recomputes every file's SHA-256 from stored chunks before publishing, so a release
// can never cite a checksum that doesn't match the bytes.

import { createHash } from "node:crypto";
import type { Ctx } from "./context.ts";
import { badRequest, conflict } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { getObject, resolveRef } from "./history.ts";
import { BlobReader } from "./chunks.ts";

const SEMVER = /^v\d+\.\d+\.\d+(-[0-9a-z.]+)?$/;

/** Which model run a release comes from: what ran, with what, for how long, and which commits of which repositories fed it. */
export type RunInput = { repo: string; commit: string; note?: string };
export type ModelRun = { software?: string; version?: string; plan?: string; runtimeSeconds?: number; completedAt?: string; notes?: string; inputs?: RunInput[] };

const RUN_KEYS = ["software", "version", "plan", "runtimeSeconds", "completedAt", "notes", "inputs"];
const text = (v: unknown, name: string, max: number) => {
  if (typeof v !== "string") throw badRequest(`run.${name} must be text.`);
  const t = v.trim();
  if (t.length > max) throw badRequest(`run.${name} is at most ${max} characters.`);
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(t)) throw badRequest(`run.${name} cannot contain control characters.`);
  return t;
};

/** Check a run description and keep only what is known; an empty one is no run at all. */
export function cleanRun(raw: unknown): ModelRun | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) throw badRequest("run must be an object.");
  const input = raw as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!RUN_KEYS.includes(key)) throw badRequest(`Unknown run field “${key.slice(0, 30)}”. Use ${RUN_KEYS.join(", ")}.`);
  const run: ModelRun = {};
  if (input.software !== undefined) run.software = text(input.software, "software", 80);
  if (input.version !== undefined) run.version = text(input.version, "version", 40);
  if (input.plan !== undefined) run.plan = text(input.plan, "plan", 160);
  if (input.notes !== undefined) run.notes = text(input.notes, "notes", 1000);
  if (input.runtimeSeconds !== undefined) {
    const n = input.runtimeSeconds;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 10_000_000) throw badRequest("run.runtimeSeconds must be a number of seconds, 0 or more.");
    run.runtimeSeconds = Math.round(n * 1000) / 1000;
  }
  if (input.completedAt !== undefined) {
    const when = text(input.completedAt, "completedAt", 40);
    if (Number.isNaN(Date.parse(when))) throw badRequest("run.completedAt must be a date and time such as 2026-10-17T09:30:00Z.");
    run.completedAt = new Date(when).toISOString();
  }
  if (input.inputs !== undefined) {
    if (!Array.isArray(input.inputs) || input.inputs.length > 50) throw badRequest("run.inputs is a list of at most 50 inputs.");
    run.inputs = input.inputs.map((item, i) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) throw badRequest(`run.inputs[${i}] must be an object with a repo and a commit.`);
      const o = item as Record<string, unknown>;
      for (const key of Object.keys(o)) if (!["repo", "commit", "note"].includes(key)) throw badRequest(`run.inputs[${i}] has an unknown field “${key.slice(0, 30)}”.`);
      const repo = text(o.repo, `inputs[${i}].repo`, 100);
      if (!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9._-]+$/.test(repo)) throw badRequest(`run.inputs[${i}].repo is written owner/name.`);
      const commit = text(o.commit, `inputs[${i}].commit`, 64).toLowerCase();
      if (!/^[0-9a-f]{7,64}$/.test(commit)) throw badRequest(`run.inputs[${i}].commit is a commit id (7 to 64 hexadecimal characters).`);
      return { repo, commit, ...(o.note !== undefined ? { note: text(o.note, `inputs[${i}].note`, 200) } : {}) };
    });
  }
  return Object.keys(run).length ? run : null;
}

export async function createRelease(ctx: Ctx, repo: RepoRow, authorId: number, input: { tag: string; target?: string; title?: string; notes?: string; prerelease?: boolean; run?: unknown }) {
  const run = cleanRun(input.run);
  const tag = input.tag?.trim();
  if (!SEMVER.test(tag ?? "")) throw badRequest("Use a version like v1.3.0 or v1.3.0-rc.1.");
  if (ctx.db.prepare("SELECT 1 FROM releases WHERE repo_id = ? AND tag = ?").get(repo.id, tag)) throw conflict("release_exists", `${tag} already exists.`);
  const commitId = resolveRef(ctx, repo, input.target ?? repo.default_branch);
  const commit = getObject<CommitObject>(ctx, repo, commitId, "commit");
  const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");

  const checksums: { path: string; size: number; sha256: string }[] = [];
  for (const e of tree.entries) {
    const blob = getObject<BlobObject>(ctx, repo, e.blob, "blob");
    const reader = new BlobReader(ctx, blob);
    const hash = createHash("sha256");
    for (let off = 0; off < blob.size; off += 4 * 1024 * 1024) hash.update(await reader.read(off, 4 * 1024 * 1024));
    const digest = hash.digest("hex");
    if (digest !== blob.sha256) throw conflict("integrity_error", `${e.path} doesn’t match its recorded checksum; run checks before releasing.`);
    checksums.push({ path: e.path, size: e.size, sha256: digest });
  }

  ctx.db
    .prepare("INSERT INTO releases (repo_id, tag, commit_id, title, notes, prerelease, merkle_root, checksums, author_id, run) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(repo.id, tag, commitId, input.title?.trim() || tag, input.notes ?? "", input.prerelease ? 1 : 0, commit.merkleRoot, JSON.stringify(checksums), authorId, run ? JSON.stringify(run) : null);
  ctx.db.prepare("INSERT OR IGNORE INTO refs (repo_id, kind, name, commit_id) VALUES (?, 'tag', ?, ?)").run(repo.id, tag, commitId);
  return listReleases(ctx, repo).find((r) => r.tag === tag)!;
}

export function listReleases(ctx: Ctx, repo: RepoRow) {
  const rows = ctx.db
    .prepare("SELECT r.*, o.handle AS author FROM releases r JOIN owners o ON o.id = r.author_id WHERE r.repo_id = ? ORDER BY r.id DESC")
    .all(repo.id) as { tag: string; commit_id: string; title: string; notes: string; prerelease: number; merkle_root: string; checksums: string; run: string | null; author: string; created_at: string }[];
  return rows.map((r, i) => {
    const checksums = JSON.parse(r.checksums) as { path: string; size: number; sha256: string }[];
    return {
      tag: r.tag,
      commit: r.commit_id,
      title: r.title,
      notes: r.notes,
      prerelease: Boolean(r.prerelease),
      latest: i === 0 && !r.prerelease,
      merkleRoot: r.merkle_root,
      sizeBytes: checksums.reduce((n, c) => n + c.size, 0),
      checksums,
      run: r.run ? (JSON.parse(r.run) as ModelRun) : null,
      author: r.author,
      createdAt: r.created_at,
    };
  });
}

/** SHA256SUMS text, the format `sha256sum -c` verifies. */
export function checksumFile(release: { checksums: { path: string; sha256: string }[] }) {
  return release.checksums.map((c) => `${c.sha256}  ${c.path}`).join("\n") + "\n";
}
