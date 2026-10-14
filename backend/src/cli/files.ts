// Walking, stability-checking and chunking working files.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { chunkStream, sha256Hex } from "../core/fastcdc.ts";
import type { Hint } from "../core/compress.ts";
import { hintForPath, tiffHint } from "../core/profile.ts";
import type { BlobObject } from "../core/objects.ts";
import { config } from "../config.ts";
import { CliError } from "./local.ts";

const ALWAYS_IGNORED = new Set([".craton", ".git", "node_modules", ".DS_Store", "Thumbs.db"]);
// Files another program is still writing, or owns: never read them.
const LOCKISH = [/\.lock$/i, /^~\$/, /\.tmp$/i, /^\.~lock\./, /\.swp$/i, /\.part$/i];

export function ignoreRules(root: string): RegExp[] {
  const file = path.join(root, ".cratonignore");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((glob) => new RegExp("^" + glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*") + "(/.*)?$"));
}

/** All files under `start` (relative to root), honouring .cratonignore. */
export function walk(root: string, start: string, rules: RegExp[]): string[] {
  const out: string[] = [];
  const skip = (rel: string, name: string) => ALWAYS_IGNORED.has(name) || (rel !== "" && rules.some((r) => r.test(rel)));
  const consider = (abs: string, rel: string, name: string, kind: "dir" | "file" | "other") => {
    if (skip(rel, name)) return;
    if (kind === "dir") {
      // Directory entries carry their type, so a large tree isn't stat()ed one file at a time.
      for (const child of fs.readdirSync(abs, { withFileTypes: true })) {
        const childAbs = path.join(abs, child.name);
        const childRel = path.relative(root, childAbs).split(path.sep).join("/");
        if (child.isDirectory()) consider(childAbs, childRel, child.name, "dir");
        else if (child.isFile()) consider(childAbs, childRel, child.name, "file");
        else if (child.isSymbolicLink()) {
          // Follow links the way a plain stat would.
          try {
            const st = fs.statSync(childAbs);
            consider(childAbs, childRel, child.name, st.isDirectory() ? "dir" : st.isFile() ? "file" : "other");
          } catch {}
        }
      }
    } else if (kind === "file") {
      if (LOCKISH.some((r) => r.test(name))) return;
      out.push(rel);
    }
  };
  const st = fs.statSync(start);
  consider(start, path.relative(root, start).split(path.sep).join("/"), path.basename(start), st.isDirectory() ? "dir" : st.isFile() ? "file" : "other");
  return out.sort();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait until a file stops changing before reading it. A file modified in the last 2 seconds
 * is re-checked until its size and mtime hold still (up to `timeoutMs`).
 */
export async function waitUntilStable(abs: string, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let prev = await fsp.stat(abs);
  while (Date.now() - prev.mtimeMs < 2000) {
    if (Date.now() > deadline) throw new CliError(`${abs} is still being written. Close the program using it and try again.`);
    await sleep(1000);
    const next = await fsp.stat(abs);
    if (next.size === prev.size && next.mtimeMs === prev.mtimeMs) return next;
    prev = next;
  }
  return prev;
}

export type ChunkedFile = { blob: BlobObject; size: number; mtimeMs: number; chunks: { hash: string; offset: number; length: number; data?: Buffer }[] };

/** Chunk a file and build its blob. Fails if the file changes while it's being read. */
export async function chunkFile(abs: string, keepData = false): Promise<ChunkedFile> {
  const before = await waitUntilStable(abs);
  const whole = createHash("sha256");
  const chunks: ChunkedFile["chunks"] = [];
  // Small files are read in one call: a stream per file dominates the cost of a folder of thousands of them.
  const source: AsyncIterable<Buffer> =
    before.size <= 8 * 1024 * 1024
      ? (async function* () {
          yield await fsp.readFile(abs);
        })()
      : fs.createReadStream(abs, { highWaterMark: 4 * 1024 * 1024 });
  for await (const c of chunkStream(source, config.chunking)) {
    whole.update(c.data);
    chunks.push({ hash: c.hash, offset: c.offset, length: c.length, data: keepData ? c.data : undefined });
  }
  const after = await fsp.stat(abs);
  if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
    throw new CliError(`${abs} changed while it was being read. Wait for the program writing it to finish.`);
  }
  const blob: BlobObject = {
    type: "blob",
    size: before.size,
    sha256: whole.digest("hex"),
    chunks: chunks.map((c) => ({ hash: c.hash, size: c.length })),
  };
  return { blob, size: before.size, mtimeMs: before.mtimeMs, chunks };
}

/** Read one chunk back from a working file and make sure it still has the expected hash. */
export async function readChunkFromFile(abs: string, offset: number, length: number, hash: string) {
  const fh = await fsp.open(abs, "r");
  try {
    const buf = Buffer.alloc(length);
    await fh.read(buf, 0, length, offset);
    if (sha256Hex(buf) !== hash) throw new CliError(`${abs} changed since \`craton add\`. Run \`craton add\` again.`);
    return buf;
  } finally {
    await fh.close();
  }
}

export function formatBytes(n: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * How this file's bytes should be encoded: from its name, and for TIFF from its header (uncompressed rasters get the
 * byte shuffle, deflate/LZW/JPEG tiles are left alone). A file that cannot be probed is simply "auto".
 */
export function hintForFile(abs: string): Hint {
  const byName = hintForPath(abs.split("\\").join("/"));
  if (!/\.tiff?$/i.test(abs)) return byName;
  let fd: number | null = null;
  try {
    fd = fs.openSync(abs, "r");
    const open = fd;
    return (
      tiffHint((offset, length) => {
        const buf = Buffer.alloc(length);
        const n = fs.readSync(open, buf, 0, length, offset);
        return n > 0 ? buf.subarray(0, n) : null;
      }) ?? byName
    );
  } catch {
    return byName;
  } finally {
    if (fd !== null) fs.closeSync(fd);
  }
}
