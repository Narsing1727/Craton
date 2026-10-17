// Where compressed chunk bytes live. The database knows which chunks exist and who may see
// them; a ChunkStore only moves bytes. Keys are chunk hashes, so writes are idempotent.

export interface ChunkStore {
  readonly kind: string;
  put(hash: string, stored: Buffer): Promise<void>;
  /** Replace what is stored under a hash with another encoding of the same chunk (repacking only): atomic, so a reader sees the old or the new, never a mixture. `put` keeps what is already there. */
  replace(hash: string, stored: Buffer): Promise<void>;
  get(hash: string): Promise<Buffer | null>;
  has(hash: string): Promise<boolean>;
  /** Remove a chunk's bytes (garbage collection only). Deleting a missing chunk is not an error. */
  delete(hash: string): Promise<void>;
}

/** In-memory store for tests. */
export class MemoryStore implements ChunkStore {
  readonly kind = "memory";
  private readonly map = new Map<string, Buffer>();
  async put(hash: string, stored: Buffer) {
    this.map.set(hash, Buffer.from(stored));
  }
  async replace(hash: string, stored: Buffer) {
    this.map.set(hash, Buffer.from(stored));
  }
  async get(hash: string) {
    return this.map.get(hash) ?? null;
  }
  async has(hash: string) {
    return this.map.has(hash);
  }
  async delete(hash: string) {
    this.map.delete(hash);
  }
}
