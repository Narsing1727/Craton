// Content-addressed objects, git-style. Every id is the SHA-256 of the object's canonical JSON,
// so the CLI and the server derive identical ids for identical content.

import { createHash } from "node:crypto";
import { leafHash, merkleRoot } from "./merkle.ts";

export type ChunkRef = { hash: string; size: number };

/** A file: its chunks in order, plus the SHA-256 of the whole file for byte-identical restores. */
export type BlobObject = { type: "blob"; size: number; sha256: string; chunks: ChunkRef[] };

export type TreeEntry = { path: string; blob: string; size: number };
/** A snapshot: every file path with its blob id. Flat (full paths), sorted by path. */
export type TreeObject = { type: "tree"; entries: TreeEntry[] };

export type CommitObject = {
  type: "commit";
  tree: string;
  parents: string[];
  author: string;
  message: string;
  timestamp: string;
  merkleRoot: string;
};

export type CratonObject = BlobObject | TreeObject | CommitObject;

/** JSON with object keys sorted at every level: one byte sequence per logical object. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).filter((k) => (value as Record<string, unknown>)[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function objectId(obj: CratonObject): string {
  return createHash("sha256").update(`${obj.type}\n`).update(canonicalJson(obj)).digest("hex");
}

export function makeTree(entries: TreeEntry[]): TreeObject {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].path === sorted[i - 1].path) throw new Error(`Duplicate path in tree: ${sorted[i].path}`);
  }
  return { type: "tree", entries: sorted };
}

/** Merkle root over (path, blob) leaves; blob ids commit to chunk hashes, which commit to bytes. */
export function treeMerkleRoot(tree: TreeObject): string {
  return merkleRoot(tree.entries.map((e) => leafHash(e.path, e.blob)));
}

export function makeCommit(input: Omit<CommitObject, "type" | "merkleRoot">, tree: TreeObject): CommitObject {
  return { type: "commit", ...input, merkleRoot: treeMerkleRoot(tree) };
}

export const shortId = (id: string) => id.slice(0, 7);

export type FileChange = {
  path: string;
  change: "added" | "removed" | "modified";
  oldBlob?: string;
  newBlob?: string;
  sizeBefore: number;
  sizeAfter: number;
};

/** File-level differences between two trees. */
export function diffTrees(before: TreeObject | null, after: TreeObject): FileChange[] {
  const old = new Map((before?.entries ?? []).map((e) => [e.path, e]));
  const changes: FileChange[] = [];
  for (const e of after.entries) {
    const prev = old.get(e.path);
    if (!prev) changes.push({ path: e.path, change: "added", newBlob: e.blob, sizeBefore: 0, sizeAfter: e.size });
    else if (prev.blob !== e.blob) changes.push({ path: e.path, change: "modified", oldBlob: prev.blob, newBlob: e.blob, sizeBefore: prev.size, sizeAfter: e.size });
    old.delete(e.path);
  }
  for (const prev of old.values()) {
    changes.push({ path: prev.path, change: "removed", oldBlob: prev.blob, sizeBefore: prev.size, sizeAfter: 0 });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/** Chunk-level view of a modified file: how many chunks are new, gone or shared. */
export function diffBlobs(before: BlobObject | null, after: BlobObject | null) {
  const a = new Set((before?.chunks ?? []).map((c) => c.hash));
  const b = new Set((after?.chunks ?? []).map((c) => c.hash));
  let added = 0, removed = 0, shared = 0, addedBytes = 0;
  // One character per chunk of the new version, in file order: "n" new, "s" shared with the old one.
  let map = "";
  for (const c of after?.chunks ?? []) {
    if (a.has(c.hash)) {
      shared++;
      map += "s";
    } else {
      added++;
      addedBytes += c.size;
      map += "n";
    }
  }
  for (const h of a) if (!b.has(h)) removed++;
  return { added, removed, shared, addedBytes, map };
}
