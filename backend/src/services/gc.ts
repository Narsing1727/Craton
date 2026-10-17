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
  const blobs = ctx.db.prepare("SELECT o.body FROM objects o WHERE o.type = 'blob' AND EXISTS (SELECT 1 FROM repo_objects ro WHERE ro.object_id = o.id)").all() as { body: string }[];
  for (const b of blobs) for (const c of (JSON.parse(b.body) as BlobObject).chunks) live.add(c.hash);

  // Sweep candidates: unreferenced and past the grace period.
  const all = ctx.db.prepare("SELECT hash, size, stored_size, created_at FROM chunks").all() as { hash: string; size: number; stored_size: number; created_at: string }[];
  const dead = all.filter((c) => !live.has(c.hash));
  const eligible = dead.filter((c) => c.created_at < cutoff);
  const orphanObjects = (ctx.db.prepare("SELECT COUNT(*) AS n FROM objects o WHERE NOT EXISTS (SELECT 1 FROM repo_objects ro WHERE ro.object_id = o.id)").get() as { n: number }).n;

  let removed = 0;
  if (opts.apply) {
    for (const c of eligible) {
      await ctx.store.delete(c.hash);
      ctx.db.prepare("DELETE FROM chunk_scopes WHERE hash = ?").run(c.hash);
      ctx.db.prepare("DELETE FROM repo_chunks WHERE hash = ?").run(c.hash);
      ctx.db.prepare("DELETE FROM chunks WHERE hash = ?").run(c.hash);
      removed++;
    }
    ctx.db.prepare("DELETE FROM objects WHERE NOT EXISTS (SELECT 1 FROM repo_objects ro WHERE ro.object_id = objects.id)").run();
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
    orphanObjects,
  };
}
