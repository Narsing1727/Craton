// Garbage collection for chunks nothing references any more (deleted repositories, pushes that
// uploaded chunks but never registered objects). Mark and sweep with a grace period: a chunk is
// only removed when no blob of any repository references it AND it's older than `graceDays`, so a
// push in progress can never lose data. Run it with `npm run gc` (dry run) or `npm run gc -- --apply`.

import type { Ctx } from "./context.ts";
import type { BlobObject } from "../core/objects.ts";

export async function collectGarbage(ctx: Ctx, opts: { apply: boolean; graceDays?: number; now?: number }) {
  const graceMs = (opts.graceDays ?? 30) * 86_400_000;
  const cutoff = new Date((opts.now ?? Date.now()) - graceMs).toISOString();

  // Mark: every chunk named by a blob that belongs to at least one repository.
  const live = new Set<string>();
  const blobs = await ctx.db.all("SELECT o.body FROM objects o WHERE o.type = 'blob' AND EXISTS (SELECT 1 FROM repo_objects ro WHERE ro.object_id = o.id)") as { body: string }[];
  for (const b of blobs) for (const c of (JSON.parse(b.body) as BlobObject).chunks) live.add(c.hash);

  // A chunk stored as a difference needs the chunks it names: they stay as long as it does.
  const needed = await ctx.db.all("SELECT chunk_hash, ref_hash FROM chunk_refs") as { chunk_hash: string; ref_hash: string }[];
  for (const r of needed) if (live.has(r.chunk_hash)) live.add(r.ref_hash);

  // A tile is kept while a chunk that is made of it is, and a tile that is a difference keeps the tile it is built on.
  const madeOf = await ctx.db.all("SELECT chunk_hash, tile_key FROM chunk_tiles") as { chunk_hash: string; tile_key: string }[];

  // Sweep candidates: unreferenced and past the grace period.
  const all = await ctx.db.all("SELECT hash, size, stored_size, created_at FROM chunks") as { hash: string; size: number; stored_size: number; created_at: string }[];
  const dead = all.filter((c) => !live.has(c.hash));
  const eligible = dead.filter((c) => c.created_at < cutoff);
  const orphanObjects = (await ctx.db.get("SELECT COUNT(*) AS n FROM objects o WHERE NOT EXISTS (SELECT 1 FROM repo_objects ro WHERE ro.object_id = o.id)") as { n: number }).n;

  let removed = 0;
  let tilesRemoved = 0;
  if (opts.apply) {
    for (const c of eligible) {
      await ctx.store.delete(c.hash);
      await ctx.db.run("DELETE FROM chunk_scopes WHERE hash = ?", c.hash);
      await ctx.db.run("DELETE FROM repo_chunks WHERE hash = ?", c.hash);
      await ctx.db.run("DELETE FROM chunk_refs WHERE chunk_hash = ?", c.hash);
      await ctx.db.run("DELETE FROM chunk_tiles WHERE chunk_hash = ?", c.hash);
      await ctx.db.run("DELETE FROM chunks WHERE hash = ?", c.hash);
      removed++;
    }
    await ctx.db.run("DELETE FROM objects WHERE NOT EXISTS (SELECT 1 FROM repo_objects ro WHERE ro.object_id = objects.id)");
    // Tiles nothing stored needs any more (after the chunks above are gone), once they are past the same grace period.
    const wanted = new Set<string>();
    const removedChunks = new Set(eligible.map((c) => c.hash));
    for (const m of madeOf) if (!removedChunks.has(m.chunk_hash)) wanted.add(m.tile_key);
    const bases = await ctx.db.all("SELECT key, base_key, created_at FROM tiles") as { key: string; base_key: string | null; created_at: string }[];
    for (const t of bases) if (wanted.has(t.key) && t.base_key) wanted.add(t.base_key);
    for (const t of bases) {
      if (wanted.has(t.key) || t.created_at >= cutoff) continue;
      await ctx.store.delete(t.key);
      await ctx.db.run("DELETE FROM blob_tiles WHERE tile_key = ?", t.key);
      await ctx.db.run("DELETE FROM tiles WHERE key = ?", t.key);
      tilesRemoved++;
    }
  }

  return {
    applied: opts.apply,
    totalChunks: all.length,
    referenced: all.length - dead.length,
    unreferenced: dead.length,
    inGracePeriod: dead.length - eligible.length,
    eligible: eligible.length,
    eligibleBytes: eligible.reduce((n, c) => n + c.stored_size, 0),
    removed,
    tilesRemoved,
    orphanObjects,
  };
}
