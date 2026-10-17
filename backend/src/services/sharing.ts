// Share links: let someone without a Craton account see and download one snapshot of a
// repository, the way "anyone with the link" works in Google Drive, but safer by default:
//   - the link is a snapshot of one commit, so it never silently starts showing newer work;
//   - it expires (1 to 90 days, never "forever") and can be revoked at any time;
//   - only the SHA-256 of the token is stored, so the address is shown once, when it is made,
//     and a leaked database does not leak working links;
//   - it grants read access to that one repository's files and nothing else (no history, issues,
//     members or settings), and a wrong, expired or revoked token all look the same: not found.

import { createHash, randomBytes } from "node:crypto";
import type { Ctx } from "./context.ts";
import { badRequest, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { getObject, resolveRef } from "./history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { config } from "../config.ts";

export const EXPIRY_CHOICES = [1, 7, 30, 90] as const;
const MAX_ACTIVE = 20;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => new Date().toISOString();

type LinkRow = {
  id: number;
  repo_id: number;
  note: string;
  ref: string;
  commit_id: string;
  created_by: number;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_used_at: string | null;
  uses: number;
};

const isActive = (r: LinkRow) => !r.revoked_at && r.expires_at > now();

export function createLink(ctx: Ctx, repo: RepoRow, userId: number, input: { ref?: string; expiresInDays?: number; note?: string }) {
  const days = input.expiresInDays ?? 7;
  if (!(EXPIRY_CHOICES as readonly number[]).includes(days)) throw badRequest(`Choose how long the link works: ${EXPIRY_CHOICES.join(", ")} days.`);
  const active = (ctx.db.prepare("SELECT COUNT(*) AS n FROM share_links WHERE repo_id = ? AND revoked_at IS NULL AND expires_at > ?").get(repo.id, now()) as { n: number }).n;
  if (active >= MAX_ACTIVE) throw badRequest(`A repository can have up to ${MAX_ACTIVE} active share links. Revoke one you no longer need.`);

  const ref = (input.ref ?? repo.default_branch).trim();
  const commit = resolveRef(ctx, repo, ref); // a branch name, a tag or a commit id; the link pins the commit it points to now
  const token = `bcn_share_${randomBytes(24).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString();
  const id = Number(
    ctx.db
      .prepare("INSERT INTO share_links (repo_id, token_hash, note, ref, commit_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(repo.id, sha(token), String(input.note ?? "").trim().slice(0, 120), ref, commit, userId, expiresAt).lastInsertRowid,
  );
  return { id, token, path: `/s/${token}`, url: `${config.webUrl}/s/${token}`, ref, commit, expiresAt };
}

export function listLinks(ctx: Ctx, repo: RepoRow) {
  const rows = ctx.db.prepare("SELECT * FROM share_links WHERE repo_id = ? ORDER BY id DESC LIMIT 100").all(repo.id) as LinkRow[];
  const names = new Map<number, string>();
  return rows.map((r) => {
    if (!names.has(r.created_by)) names.set(r.created_by, (ctx.db.prepare("SELECT handle FROM owners WHERE id = ?").get(r.created_by) as { handle: string } | undefined)?.handle ?? "someone");
    return {
      id: r.id,
      note: r.note,
      ref: r.ref,
      commit: r.commit_id,
      createdBy: names.get(r.created_by)!,
      createdAt: r.created_at,
      expiresAt: r.expires_at,
      revokedAt: r.revoked_at,
      lastUsedAt: r.last_used_at,
      uses: r.uses,
      active: isActive(r),
    };
  });
}

export function revokeLink(ctx: Ctx, repo: RepoRow, id: number) {
  const r = ctx.db.prepare("UPDATE share_links SET revoked_at = ? WHERE id = ? AND repo_id = ? AND revoked_at IS NULL").run(now(), id, repo.id);
  if (!r.changes) throw notFound("Share link");
}

// ── Using a link ───────────────────────────────────────────────────────────

const GONE = () => notFound("This link");

/** The repository and snapshot a token points to. Unknown, expired and revoked tokens are indistinguishable. */
export function resolveToken(ctx: Ctx, token: unknown): { link: LinkRow; repo: RepoRow } {
  if (typeof token !== "string" || !/^bcn_share_[A-Za-z0-9_-]{20,64}$/.test(token)) throw GONE();
  const link = ctx.db.prepare("SELECT * FROM share_links WHERE token_hash = ?").get(sha(token)) as LinkRow | undefined;
  if (!link || !isActive(link)) throw GONE();
  const repo = ctx.db
    .prepare("SELECT r.*, o.handle AS owner FROM repos r JOIN owners o ON o.id = r.owner_id WHERE r.id = ?")
    .get(link.repo_id) as RepoRow | undefined;
  if (!repo) throw GONE();
  return { link, repo };
}

function treeOf(ctx: Ctx, repo: RepoRow, commitId: string) {
  return getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, commitId, "commit").tree, "tree");
}

/** What the share page shows. Counts as one use of the link. */
export function overview(ctx: Ctx, token: unknown) {
  const { link, repo } = resolveToken(ctx, token);
  ctx.db.prepare("UPDATE share_links SET uses = uses + 1, last_used_at = ? WHERE id = ?").run(now(), link.id);
  const commit = getObject<CommitObject>(ctx, repo, link.commit_id, "commit");
  const files = treeOf(ctx, repo, link.commit_id).entries.map((e) => ({ path: e.path, size: e.size }));
  return {
    repository: {
      owner: repo.owner,
      name: repo.name,
      description: repo.description,
      license: repo.license,
      topics: JSON.parse(repo.topics) as string[],
      crs: repo.crs,
    },
    snapshot: { ref: link.ref, commit: link.commit_id, message: commit.message.split("\n")[0], author: commit.author, timestamp: commit.timestamp },
    note: link.note,
    expiresAt: link.expires_at,
    totalBytes: files.reduce((n, f) => n + f.size, 0),
    files,
  };
}

/** A file of the snapshot as a byte stream, plus what a download needs. */
export function fileOf(ctx: Ctx, token: unknown, path: string) {
  const { link, repo } = resolveToken(ctx, token);
  const entry = treeOf(ctx, repo, link.commit_id).entries.find((e) => e.path === path);
  if (!entry) throw notFound("File");
  return { repo, commit: link.commit_id, blob: getObject<BlobObject>(ctx, repo, entry.blob, "blob"), path: entry.path };
}
