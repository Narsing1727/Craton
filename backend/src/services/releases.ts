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

export async function createRelease(ctx: Ctx, repo: RepoRow, authorId: number, input: { tag: string; target?: string; title?: string; notes?: string; prerelease?: boolean }) {
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
    .prepare("INSERT INTO releases (repo_id, tag, commit_id, title, notes, prerelease, merkle_root, checksums, author_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(repo.id, tag, commitId, input.title?.trim() || tag, input.notes ?? "", input.prerelease ? 1 : 0, commit.merkleRoot, JSON.stringify(checksums), authorId);
  ctx.db.prepare("INSERT OR IGNORE INTO refs (repo_id, kind, name, commit_id) VALUES (?, 'tag', ?, ?)").run(repo.id, tag, commitId);
  return listReleases(ctx, repo).find((r) => r.tag === tag)!;
}

export function listReleases(ctx: Ctx, repo: RepoRow) {
  const rows = ctx.db
    .prepare("SELECT r.*, o.handle AS author FROM releases r JOIN owners o ON o.id = r.author_id WHERE r.repo_id = ? ORDER BY r.id DESC")
    .all(repo.id) as { tag: string; commit_id: string; title: string; notes: string; prerelease: number; merkle_root: string; checksums: string; author: string; created_at: string }[];
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
      author: r.author,
      createdAt: r.created_at,
    };
  });
}

/** SHA256SUMS text, the format `sha256sum -c` verifies. */
export function checksumFile(release: { checksums: { path: string; sha256: string }[] }) {
  return release.checksums.map((c) => `${c.sha256}  ${c.path}`).join("\n") + "\n";
}
