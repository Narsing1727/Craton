// Chunks staged but not yet on the server, kept compressed in .craton/pending until a push
// confirms them. Without this, committing twice and changing a file in between would lose the
// first version's bytes before they were ever uploaded.
//
// Two layouts live side by side. A *loose* chunk is one file at pending/<xx>/<hash>. A *packed* chunk lives in
// pending/pack-<id>.bin, with its offsets in pending/pack-<id>.idx.json: staging a folder of thousands of small
// files then writes a handful of files instead of one per chunk, which is what file creation costs on Windows.
// Reading finds a chunk in either; only `add` writes packed (the checkout cache keeps loose files so a chunk is on
// disk the moment it arrives, which is what makes an interrupted clone resumable).

import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { compressChunk, decompressChunk, type Hint } from "../core/compress.ts";
import { sha256Hex } from "../core/fastcdc.ts";

type Where = { pack: string; offset: number; length: number };
const FLUSH_BYTES = 8 * 1024 * 1024;

export class PendingChunks {
  private readonly dir: string;
  private readonly packed: boolean;
  /** Chunks put since the last flush, already compressed. */
  private buffer = new Map<string, Buffer>();
  private bufferBytes = 0;
  /** Where each flushed chunk is, loaded from the pack indexes the first time it is needed. */
  private packs: Map<string, Where> | null = null;

  /** `name` keeps two caches apart: "pending" holds chunks to upload, "fetched" holds chunks a checkout already downloaded. */
  constructor(repoDir: string, name = "pending", opts: { packed?: boolean } = {}) {
    this.dir = path.join(repoDir, name);
    this.packed = Boolean(opts.packed);
  }

  private file(hash: string) {
    return path.join(this.dir, hash.slice(0, 2), hash);
  }

  private index(): Map<string, Where> {
    if (this.packs) return this.packs;
    const map = new Map<string, Where>();
    try {
      for (const f of fs.readdirSync(this.dir)) {
        if (!f.endsWith(".idx.json")) continue;
        const pack = path.join(this.dir, f.replace(/\.idx\.json$/, ".bin"));
        try {
          const entries = JSON.parse(fs.readFileSync(path.join(this.dir, f), "utf8")) as Record<string, [number, number]>;
          for (const [hash, [offset, length]] of Object.entries(entries)) map.set(hash, { pack, offset, length });
        } catch {
          // A pack whose index is unreadable is ignored: its chunks are simply not there, and `add` restages them.
        }
      }
    } catch {}
    this.packs = map;
    return map;
  }

  has(hash: string) {
    return this.buffer.has(hash) || this.index().has(hash) || fs.existsSync(this.file(hash));
  }

  put(hash: string, data: Buffer, hint?: Hint) {
    if (this.has(hash)) return;
    const stored = compressChunk(data, hash, hint).stored;
    if (!this.packed) {
      const f = this.file(hash);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, stored);
      return;
    }
    this.buffer.set(hash, stored);
    this.bufferBytes += stored.length;
    if (this.bufferBytes >= FLUSH_BYTES) this.flush();
  }

  /** Write buffered chunks to a new pack. Call before anything that relies on them being on disk. */
  flush() {
    if (this.buffer.size === 0) return;
    fs.mkdirSync(this.dir, { recursive: true });
    const id = `pack-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
    const index: Record<string, [number, number]> = {};
    const parts: Buffer[] = [];
    let offset = 0;
    for (const [hash, stored] of this.buffer) {
      index[hash] = [offset, stored.length];
      parts.push(stored);
      offset += stored.length;
    }
    const bin = path.join(this.dir, `${id}.bin`);
    fs.writeFileSync(bin, Buffer.concat(parts));
    // The index goes last: a pack without one is never read.
    fs.writeFileSync(path.join(this.dir, `${id}.idx.json`), JSON.stringify(index));
    const map = this.index();
    for (const [hash, [o, l]] of Object.entries(index)) map.set(hash, { pack: bin, offset: o, length: l });
    this.buffer.clear();
    this.bufferBytes = 0;
  }

  /** The chunk as staged (its first byte names the encoding) and its size once decoded, after checking it is the chunk. */
  getStored(hash: string): { stored: Buffer; size: number } | null {
    try {
      let stored = this.buffer.get(hash) ?? null;
      if (!stored) {
        const where = this.index().get(hash);
        if (where) {
          const fd = fs.openSync(where.pack, "r");
          try {
            stored = Buffer.alloc(where.length);
            fs.readSync(fd, stored, 0, where.length, where.offset);
          } finally {
            fs.closeSync(fd);
          }
        } else stored = fs.readFileSync(this.file(hash));
      }
      const data = decompressChunk(stored);
      return sha256Hex(data) === hash ? { stored, size: data.length } : null;
    } catch {
      return null;
    }
  }

  get(hash: string): Buffer | null {
    const found = this.getStored(hash);
    return found ? decompressChunk(found.stored) : null;
  }

  /**
   * Is the staging cache sound? With `deep`, every chunk is read back and re-hashed (what push will do later).
   * `problems` are chunks that are listed but cannot be used; `orphans` are packs with no index (an interrupted
   * `add`), harmless and safe to delete.
   */
  check(deep: boolean) {
    const problems: string[] = [];
    const orphans: string[] = [];
    let chunks = 0;
    let packs = 0;
    try {
      const names = fs.readdirSync(this.dir);
      for (const f of names) if (f.endsWith(".bin") && !names.includes(f.replace(/\.bin$/, ".idx.json"))) orphans.push(f);
      packs = names.filter((f) => f.endsWith(".idx.json")).length;
    } catch {
      return { chunks, packs, problems, orphans };
    }
    for (const [hash, where] of this.index()) {
      chunks++;
      let size = -1;
      try {
        size = fs.statSync(where.pack).size;
      } catch {}
      if (size < where.offset + where.length) {
        problems.push(`chunk ${hash.slice(0, 12)}: its pack ${path.basename(where.pack)} is missing or too short`);
        continue;
      }
      if (deep && this.get(hash) === null) problems.push(`chunk ${hash.slice(0, 12)}: does not decompress to its hash`);
    }
    return { chunks, packs, problems, orphans };
  }

  clear() {
    this.buffer.clear();
    this.bufferBytes = 0;
    this.packs = null;
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  sizeOnDisk() {
    let n = 0;
    const walk = (dir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (!e.name.endsWith(".idx.json")) n += fs.statSync(p).size;
      }
    };
    walk(this.dir);
    return n + this.bufferBytes;
  }
}
