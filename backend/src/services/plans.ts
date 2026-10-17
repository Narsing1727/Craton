// Plan limits, enforced where data comes in. Craton never deletes anything when a limit is hit:
// it refuses new private repositories or new chunks, and says what to do.

import type { Ctx } from "./context.ts";
import { ApiError } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { config } from "../config.ts";
import { sendStorageWarningEmail } from "./email.ts";

type PlanId = keyof typeof config.plans;

/** Organizations are on Team; people on their own plan. */
export function planOf(ctx: Ctx, ownerId: number): PlanId {
  const row = ctx.db.prepare("SELECT o.kind, u.plan FROM owners o LEFT JOIN users u ON u.owner_id = o.id WHERE o.id = ?").get(ownerId) as { kind: string; plan: string | null } | undefined;
  if (row?.kind === "org") return "team";
  return (row?.plan as PlanId) in config.plans ? (row!.plan as PlanId) : "free";
}

const cache = new Map<number, { at: number; bytes: number }>();

/** Compressed bytes of unique chunks an owner's repositories reference, cached for 30 s. */
export function ownerStoredBytes(ctx: Ctx, ownerId: number) {
  const hit = cache.get(ownerId);
  if (hit && Date.now() - hit.at < 30_000) return hit.bytes;
  const row = ctx.db
    .prepare(
      // Chunks that someone else's public repository also holds are shared base data: free, the
      // same rule the usage page shows (stats.usageOf).
      `SELECT COALESCE(SUM(c.stored_size), 0) AS bytes FROM chunks c
       WHERE c.hash IN (SELECT DISTINCT rc.hash FROM repo_chunks rc JOIN repos r ON r.id = rc.repo_id WHERE r.owner_id = ?)
         AND NOT EXISTS (SELECT 1 FROM repo_chunks o JOIN repos p ON p.id = o.repo_id WHERE o.hash = c.hash AND p.visibility = 'public' AND p.owner_id <> ?)`,
    )
    .get(ownerId, ownerId) as { bytes: number };
  cache.set(ownerId, { at: Date.now(), bytes: row.bytes });
  return row.bytes;
}

/** Before accepting a new chunk into `repo`: refuse once the owner is at their storage limit. */
export function assertStorageAvailable(ctx: Ctx, repo: RepoRow, incomingBytes: number) {
  const plan = planOf(ctx, repo.owner_id);
  const limit = config.plans[plan].storageBytes;
  const used = ownerStoredBytes(ctx, repo.owner_id);
  if (used + incomingBytes > limit) {
    const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
    throw new ApiError(
      413,
      "storage_limit",
      `${repo.owner} has used ${gb(used)} of ${gb(limit)} on the ${plan === "team" ? "Team" : "Free"} plan. Nothing was deleted; upgrade or remove old repositories to push more.`,
      { usedBytes: used, limitBytes: limit, plan },
    );
  }
  const entry = cache.get(repo.owner_id);
  if (entry) entry.bytes += incomingBytes;
  noteStorageUse(ctx, repo.owner_id, plan, used + incomingBytes, limit);
}

const THRESHOLDS = [80, 100];

/**
 * Warn once when an owner's storage use crosses 80% and again at 100%: a notice row remembers each, and is
 * cleared when use falls back below it so a later climb warns again. People get an email; organizations tell
 * their owners.
 */
export function noteStorageUse(ctx: Ctx, ownerId: number, plan: PlanId, used: number, limit: number) {
  if (limit <= 0) return;
  const percent = (used / limit) * 100;
  for (const t of THRESHOLDS) {
    const have = ctx.db.prepare("SELECT 1 FROM plan_notices WHERE owner_id = ? AND threshold = ?").get(ownerId, t);
    if (percent < t) {
      if (have) ctx.db.prepare("DELETE FROM plan_notices WHERE owner_id = ? AND threshold = ?").run(ownerId, t);
      continue;
    }
    if (have) continue;
    ctx.db.prepare("INSERT INTO plan_notices (owner_id, threshold) VALUES (?, ?)").run(ownerId, t);
    const who = ctx.db.prepare("SELECT handle, kind FROM owners WHERE id = ?").get(ownerId) as { handle: string; kind: string } | undefined;
    if (!who) continue;
    const recipients = (
      who.kind === "org"
        ? ctx.db.prepare("SELECT u.email FROM memberships m JOIN users u ON u.owner_id = m.user_id WHERE m.org_id = ? AND m.role = 'Owner'").all(ownerId)
        : ctx.db.prepare("SELECT email FROM users WHERE owner_id = ?").all(ownerId)
    ) as { email: string }[];
    const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GB`;
    for (const r of recipients) void sendStorageWarningEmail(r.email, `@${who.handle}`, t, gb(used), gb(limit), plan === "team" ? "Team" : "Free", `${config.webUrl}/settings/billing`);
  }
}

/** Before creating a private repository (or making one private) for `ownerId`. */
export function assertPrivateRepoAllowed(ctx: Ctx, ownerId: number) {
  const plan = planOf(ctx, ownerId);
  const max = config.plans[plan].privateRepos;
  const n = (ctx.db.prepare("SELECT COUNT(*) AS n FROM repos WHERE owner_id = ? AND visibility = 'private'").get(ownerId) as { n: number }).n;
  if (n >= max) {
    throw new ApiError(403, "private_repo_limit", `The ${plan === "team" ? "Team" : "Free"} plan includes ${max} private repositories and ${n} are in use. Make one public, or move it to an organization on Team.`, { limit: max });
  }
}
