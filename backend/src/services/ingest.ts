// Adding files from the browser. The CLI chunks on the client and sends only new chunks; here the
// server does it, so a person with no CLI can still put a DEM or a model folder in a repository.
// Everything a push enforces still applies: plan storage limits, other people's file locks,
// append-only history with compare-and-swap on the branch, and checks run on the new commit.

import type { Ctx } from "./context.ts";
import { ApiError, badRequest, conflict } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { mapLimit, putChunk, storeConcurrency, visibleToRepo } from "./chunks.ts";
import { getObject, registerObjects, resolveRef, updateBranch } from "./history.ts";
import { assertStorageAvailable } from "./plans.ts";
import { assertLockedWhenRequired, assertNotLockedByOthers } from "./locks.ts";
import * as secretscan from "./secretscan.ts";
import type { BlobObject, CommitObject, TreeEntry, TreeObject } from "../core/objects.ts";
import { makeCommit, makeTree, objectId } from "../core/objects.ts";
import { chunkBuffer, sha256Hex } from "../core/fastcdc.ts";
import type { Hint } from "../core/compress.ts";
import { hintForPath, lasHint, tiffHint } from "../core/profile.ts";
import { netcdfHint } from "../checks/netcdf.ts";
import { config } from "../config.ts";

export type UploadFile = { path: string; data: Buffer };
export type UploadResult = {
  commit: string;
  branch: string;
  before: string | null;
  created: boolean;
  files: { path: string; change: "added" | "modified"; size: number }[];
  unchanged: string[];
  /** Bytes of the changed files. */
  bytes: number;
  /** Bytes of chunks this upload added to storage (what was not already there), and what they took once compressed. */
  newBytes: number;
  storedBytes: number;
};

/** How a file's chunks should be encoded: its name, and for a TIFF its header (uncompressed rasters get the byte shuffle). */
function uploadHint(f: UploadFile): Hint {
  const byName = hintForPath(f.path);
  const readAt = (offset: number, length: number) => (offset >= f.data.length ? null : f.data.subarray(offset, offset + length));
  if (/\.tiff?$/i.test(f.path)) return tiffHint(readAt) ?? byName;
  if (/\.las$/i.test(f.path)) return lasHint(readAt) ?? byName;
  if (/\.(nc|cdf)$/i.test(f.path)) return netcdfHint(f.data.subarray(0, 256 * 1024)) ?? byName;
  return byName;
}

const MAX_PATH = 1024;
const MAX_SEGMENT = 255;

/** A folder plus a file's own relative path, as a clean repository path. Refuses anything that could escape or confuse. */
export function cleanUploadPath(folder: string, name: string): string {
  const joined = `${folder}/${name}`.replaceAll("\\", "/");
  const parts = joined.split("/").filter((p) => p !== "");
  if (!parts.length) throw badRequest("A file needs a name.");
  for (const part of parts) {
    if (part === "." || part === "..") throw badRequest(`“${name}” has a “${part}” in its path, which isn’t allowed.`);
    if (part.length > MAX_SEGMENT) throw badRequest(`A name in “${name}” is longer than ${MAX_SEGMENT} characters.`);
    if (/[\u0000-\u001f\u007f]/.test(part)) throw badRequest(`“${name}” contains a control character.`);
  }
  const path = parts.join("/");
  if (path.length > MAX_PATH) throw badRequest(`The path “${path.slice(0, 60)}…” is too long.`);
  if (parts[0] === ".craton") throw badRequest("A .craton folder is Craton’s own and can’t be uploaded.");
  return path;
}

export async function commitUpload(
  ctx: Ctx,
  repo: RepoRow,
  actor: string,
  input: { branch: string; from?: string | null; expected?: string | null; message?: string; files: UploadFile[]; secrets: { who: secretscan.Who; bypass: string | null } },
): Promise<UploadResult> {
  const { files } = input;
  if (!files.length) throw badRequest("Choose at least one file.");
  if (files.length > config.upload.maxFiles) throw badRequest(`Upload up to ${config.upload.maxFiles} files at a time. For more, use the CLI: craton push.`);
  const seen = new Set<string>();
  for (const f of files) {
    if (seen.has(f.path)) throw badRequest(`“${f.path}” is in the upload twice.`);
    seen.add(f.path);
  }

  const existing = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, input.branch) as { commit_id: string } | undefined;
  // The browser says which version it was looking at; if the branch has moved since, don't stack
  // a commit on something the person never saw.
  if (existing && input.expected && !existing.commit_id.startsWith(input.expected)) {
    throw conflict("stale_ref", `${input.branch} changed while you were choosing files (now ${existing.commit_id.slice(0, 7)}). Reload the page and upload again.`, { current: existing.commit_id });
  }
  const created = !existing;
  let parent: string | null = existing?.commit_id ?? null;
  if (created) {
    // A new branch starts from where another one is now (the default branch unless told otherwise).
    const from = input.from || repo.default_branch;
    try {
      parent = resolveRef(ctx, repo, from);
    } catch {
      // An empty repository has nothing to start from, which is fine for its first commit.
      if (ctx.db.prepare("SELECT 1 FROM refs WHERE repo_id = ? AND kind = 'branch' LIMIT 1").get(repo.id)) throw badRequest(`There’s no branch “${from}” to start “${input.branch}” from.`);
      parent = null;
    }
  }

  const base = parent ? getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, parent, "commit").tree, "tree") : null;
  const entries = new Map<string, TreeEntry>((base?.entries ?? []).map((e) => [e.path, e]));

  // Work out everything first (chunks, blobs, what actually changes), then check the rules, and
  // only then store anything: a refused upload leaves nothing behind.
  const planned = files.map((f) => {
    const pieces = chunkBuffer(f.data, config.chunking).map((s) => {
      const piece = f.data.subarray(s.offset, s.offset + s.length);
      return { piece, hash: sha256Hex(piece), size: s.length };
    });
    const blob: BlobObject = { type: "blob", size: f.data.length, sha256: sha256Hex(f.data), chunks: pieces.map((p) => ({ hash: p.hash, size: p.size })) };
    return { f, pieces, blob, id: objectId(blob) };
  });
  const changedPlan = planned.filter((p) => entries.get(p.f.path)?.blob !== p.id);
  const unchanged = planned.filter((p) => entries.get(p.f.path)?.blob === p.id).map((p) => p.f.path);
  if (!changedPlan.length) throw new ApiError(409, "nothing_changed", "Those files are already in the repository exactly as they are, so there’s nothing to commit.");

  assertNotLockedByOthers(ctx, repo, actor, changedPlan.map((p) => p.f.path));
  assertLockedWhenRequired(ctx, repo, actor, changedPlan.map((p) => p.f.path));
  // A credential in what is about to be committed stops the upload before anything is stored.
  const scan = await secretscan.scanFiles(ctx, changedPlan.map((p) => ({ path: p.f.path, size: p.f.data.length, load: async () => p.f.data })));
  secretscan.enforce(ctx, repo, input.secrets.who, scan.findings, input.secrets.bypass, "/repos/:owner/:repo/upload");
  let wanted = 0;
  const counted = new Set<string>();
  for (const p of changedPlan) {
    for (const c of p.pieces) {
      if (counted.has(c.hash) || visibleToRepo(ctx, repo, c.hash)) continue;
      counted.add(c.hash);
      wanted += c.size;
    }
  }
  if (wanted > 0) assertStorageAvailable(ctx, repo, wanted);

  const objects: (BlobObject | TreeObject | CommitObject)[] = [];
  const changed: UploadResult["files"] = [];
  let newBytes = 0;
  let storedBytes = 0;
  // Every chunk of every changed file, stored a few at a time (an object store answers each put in a round trip).
  const toStore = changedPlan.flatMap((p) => {
    const hint = uploadHint(p.f);
    return p.pieces.map((c) => ({ c, hint }));
  });
  const accounted = new Set<string>();
  await mapLimit(toStore, storeConcurrency(ctx), async ({ c, hint }) => {
    const r = await putChunk(ctx, repo, c.hash, Buffer.from(c.piece), hint);
    // Two identical new chunks can both be stored when they are in flight together; count the bytes once.
    if (r.storedSize !== null && !accounted.has(c.hash)) {
      accounted.add(c.hash);
      newBytes += r.size;
      storedBytes += r.storedSize;
    }
  });
  for (const p of changedPlan) {
    objects.push(p.blob);
    changed.push({ path: p.f.path, change: entries.has(p.f.path) ? "modified" : "added", size: p.f.data.length });
    entries.set(p.f.path, { path: p.f.path, blob: p.id, size: p.f.data.length });
  }

  const tree = makeTree([...entries.values()]);
  const noun = changed.length === 1 ? changed[0].path : `${changed.length} files`;
  const message = (input.message ?? "").trim() || `Upload ${noun}`;
  const commit = makeCommit({ tree: objectId(tree), parents: parent ? [parent] : [], author: actor, message: message.slice(0, 500), timestamp: new Date().toISOString() }, tree);
  objects.push(tree, commit);
  registerObjects(ctx, repo, objects);
  const id = objectId(commit);
  updateBranch(ctx, repo, input.branch, id, existing?.commit_id ?? null, actor, "push");
  return { commit: id, branch: input.branch, before: existing?.commit_id ?? null, created, files: changed, unchanged, bytes: changed.reduce((n, c) => n + c.size, 0), newBytes, storedBytes };
}
