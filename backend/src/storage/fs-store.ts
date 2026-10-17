// Local-disk chunk store: data/chunks/ab/cd/<hash>. Writes go to a temp file and are renamed
// into place, so a crash never leaves a half-written chunk under a valid name.

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChunkStore } from "./chunk-store.ts";

export class FsStore implements ChunkStore {
  readonly kind = "local-disk";
  private readonly root: string;
  /** Chunks being replaced right now: a read waits for the new file to be in place (on Windows a read can otherwise land in the gap and see nothing). */
  private readonly replacing = new Map<string, Promise<void>>();

  constructor(root: string) {
    this.root = root;
  }

  private pathFor(hash: string) {
    if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error(`Invalid chunk hash: ${hash}`);
    return path.join(this.root, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  async put(hash: string, stored: Buffer) {
    const file = this.pathFor(hash);
    try {
      await fs.access(file);
      return; // already stored; content-addressed writes are idempotent
    } catch {}
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, stored);
    await fs.rename(tmp, file);
  }

  async replace(hash: string, stored: Buffer) {
    const file = this.pathFor(hash);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(tmp, stored);
    const swap = fs.rename(tmp, file); // replaces the old file in one step
    this.replacing.set(hash, swap.then(() => undefined, () => undefined));
    try {
      await swap;
    } finally {
      this.replacing.delete(hash);
    }
  }

  async get(hash: string) {
    await this.replacing.get(hash);
    try {
      return await fs.readFile(this.pathFor(hash));
    } catch {
      return null;
    }
  }

  async has(hash: string) {
    try {
      await fs.access(this.pathFor(hash));
      return true;
    } catch {
      return false;
    }
  }

  async delete(hash: string) {
    await fs.rm(this.pathFor(hash), { force: true });
  }
}
