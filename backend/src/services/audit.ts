// The audit log: who changed what on whose repositories, and the last requests each access token made.
//
// Recorded from the request itself, after it has been answered, so every change is captured without each handler having
// to remember to. What is kept is the *shape* of the request (who, which route, which repository, which path parameters,
// the outcome and where from) and never a body, a query string, a token or a secret. A denied attempt by someone
// signed in is kept too, because "someone tried to remove the collaborator and was refused" is exactly what an
// administrator reads this log for. Reading is for the owners of what happened, not for the people it happened to.

import type { Ctx } from "./context.ts";

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Entries older than this are dropped as new ones arrive. */
const RETAIN_DAYS = 400;
/** Most requests kept per access token. */
const TOKEN_KEEP = 100;
/** Path parameters that carry a secret and must never be written down. */
const SECRET_PARAMS = new Set(["token", "secret", "code", "key"]);

/** Routes whose volume would drown the log; the push that caused them is recorded instead. */
const NOISE = [/^\/repos\/[^/]+\/[^/]+\/chunks(\/|$)/, /^\/repos\/[^/]+\/[^/]+\/model-reviews\/[^/]+\/items\//, /^\/repos\/[^/]+\/[^/]+\/locks\/refresh/];

/** Human labels for the routes people look for. Anything else is shown as its method and route. */
const LABELS: [string, RegExp, string][] = [
  ["PATCH", /^\/repos\/:owner\/:repo$/, "Changed repository settings"],
  ["DELETE", /^\/repos\/:owner\/:repo$/, "Deleted the repository"],
  ["POST", /^\/repos\/:owner\/:repo\/upload$/, "Uploaded files"],
  ["POST", /^\/repos\/:owner\/:repo\/push/, "Pushed"],
  ["PUT", /^\/repos\/:owner\/:repo\/collaborators\/:handle$/, "Set a collaborator's role"],
  ["DELETE", /^\/repos\/:owner\/:repo\/collaborators\/:handle$/, "Removed a collaborator"],
  ["POST", /^\/repos\/:owner\/:repo\/invites$/, "Invited someone by email"],
  ["DELETE", /^\/repos\/:owner\/:repo\/invites\/:id$/, "Cancelled an invitation"],
  ["POST", /^\/repos\/:owner\/:repo\/webhooks$/, "Created a webhook"],
  ["PATCH", /^\/repos\/:owner\/:repo\/webhooks\/:id$/, "Changed a webhook"],
  ["DELETE", /^\/repos\/:owner\/:repo\/webhooks\/:id$/, "Deleted a webhook"],
  ["POST", /^\/repos\/:owner\/:repo\/releases$/, "Published a release"],
  ["POST", /^\/repos\/:owner\/:repo\/branches$/, "Created a branch"],
  ["DELETE", /^\/repos\/:owner\/:repo\/branches\//, "Deleted a branch"],
  ["POST", /^\/repos\/:owner\/:repo\/share-links$/, "Created a share link"],
  ["DELETE", /^\/repos\/:owner\/:repo\/share-links\/:id$/, "Revoked a share link"],
  ["POST", /^\/repos\/:owner\/:repo\/locks$/, "Locked a file"],
  ["DELETE", /^\/repos\/:owner\/:repo\/locks\//, "Released a lock"],
  ["POST", /^\/repos\/:owner\/:repo\/pulls\/:n\/merge$/, "Merged a pull request"],
  ["PUT", /^\/repos\/:owner\/:repo\/star$/, "Starred the repository"],
  ["POST", /^\/repos\/:owner\/:repo\/model-reviews$/, "Opened a model review"],
  ["POST", /^\/repos\/:owner\/:repo\/model-reviews\/:n\/decision$/, "Decided a model review"],
  ["POST", /^\/repos\/:owner\/:repo\/model-reviews\/:n\/reopen$/, "Reopened a model review"],
  ["DELETE", /^\/repos\/:owner\/:repo\/model-reviews\/:n$/, "Deleted a model review"],
  ["PUT", /^\/orgs\/:org\/sso$/, "Set up single sign-on"],
  ["PATCH", /^\/orgs\/:org\/sso$/, "Changed whether single sign-on is required"],
  ["DELETE", /^\/orgs\/:org\/sso$/, "Removed single sign-on"],
  ["POST", /^\/orgs\/:org\/domains$/, "Added a domain"],
  ["POST", /^\/orgs\/:org\/domains\/:domain\/verify$/, "Checked a domain's DNS record"],
  ["PATCH", /^\/orgs\/:org\/domains\/:domain$/, "Changed a domain's join setting"],
  ["DELETE", /^\/orgs\/:org\/domains\/:domain$/, "Removed a domain"],
  ["PUT", /^\/orgs\/:org\/members\/:handle$/, "Set a member's role"],
  ["DELETE", /^\/orgs\/:org\/members\/:handle$/, "Removed a member"],
  ["POST", /^\/orgs\/:org\/members$/, "Added a member"],
  ["PATCH", /^\/orgs\/:org$/, "Changed organization settings"],
  ["DELETE", /^\/orgs\/:org$/, "Deleted the organization"],
];

export function labelFor(method: string, route: string): string {
  return LABELS.find(([m, re]) => m === method && re.test(route))?.[2] ?? `${method} ${route}`;
}

export type RequestFacts = {
  method: string;
  /** The route pattern ("/repos/:owner/:repo/webhooks"), without the /v1 prefix. */
  route: string;
  params: Record<string, string>;
  status: number;
  ms: number;
  ip: string | null;
  userAgent: string | null;
  actor: { id: number; handle: string; tokenId: number; tokenKind: string } | null;
  /** No route answered: `route` is then the requested path itself. Shown in a token's request log, never in the audit log. */
  unmatched?: boolean;
};

/** Called after every API response; keeps the few that belong in the log. */
export function recordRequest(ctx: Ctx, r: RequestFacts) {
  if (!r.actor) return;
  try {
    if (r.actor.tokenKind === "pat") recordTokenRequest(ctx, r);
    if (r.unmatched || !MUTATING.has(r.method)) return;
    // Only what happens to repositories and organizations; account changes have their own personal security log.
    if (!(r.route.startsWith("/repos/") || r.route.startsWith("/orgs/"))) return;
    if (NOISE.some((re) => re.test(r.route))) return;
    // Recorded: it worked, or someone signed in was refused. Not recorded: malformed or missing things.
    const refused = r.status === 401 || r.status === 403;
    if (!(r.status < 400 || refused)) return;

    const handle = r.params.owner ?? r.params.org;
    const owner = handle ? (ctx.db.prepare("SELECT id, handle FROM owners WHERE handle = ?").get(handle.toLowerCase()) as { id: number; handle: string } | undefined) : undefined;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.params)) if (!SECRET_PARAMS.has(k) && k !== "owner" && k !== "org" && k !== "repo") params[k] = String(v).slice(0, 200);
    const info = ctx.db
      .prepare(
        "INSERT INTO audit_events (owner_id, owner_handle, repo, actor_id, actor_handle, token_id, token_kind, action, method, route, params, status, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        owner?.id ?? null,
        owner?.handle ?? handle ?? null,
        r.params.repo?.toLowerCase() ?? null,
        r.actor.id,
        r.actor.handle,
        r.actor.tokenId,
        r.actor.tokenKind,
        labelFor(r.method, r.route),
        r.method,
        r.route,
        JSON.stringify(params),
        r.status,
        r.ip?.slice(0, 64) ?? null,
        r.userAgent?.slice(0, 200) ?? null,
      );
    if (Number(info.lastInsertRowid) % 100 === 0) {
      ctx.db.prepare("DELETE FROM audit_events WHERE at < ?").run(new Date(Date.now() - RETAIN_DAYS * 86_400_000).toISOString());
    }
  } catch {
    // A log that cannot be written must never make the request it describes fail.
  }
}

/**
 * An entry the request log cannot know on its own, such as a push that a scan stopped or one an administrator let
 * through on purpose. Same shape as any other entry; `params` must never carry a secret.
 */
export function recordNote(ctx: Ctx, n: { repo: { id: number; owner: string; name: string }; ownerId: number; actor: { id: number; handle: string; tokenId: number; tokenKind: string }; action: string; route: string; params: Record<string, string | number>; status: number }) {
  try {
    ctx.db
      .prepare(
        "INSERT INTO audit_events (owner_id, owner_handle, repo, actor_id, actor_handle, token_id, token_kind, action, method, route, params, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'POST', ?, ?, ?)",
      )
      .run(n.ownerId, n.repo.owner.toLowerCase(), n.repo.name.toLowerCase(), n.actor.id, n.actor.handle, n.actor.tokenId, n.actor.tokenKind, n.action, n.route, JSON.stringify(n.params), n.status);
  } catch {
    // Same rule as above: the log never breaks the request.
  }
}

function recordTokenRequest(ctx: Ctx, r: RequestFacts) {
  const id = r.actor!.tokenId;
  const info = ctx.db.prepare("INSERT INTO token_requests (token_id, method, route, status, ms, ip) VALUES (?, ?, ?, ?, ?, ?)").run(id, r.method, r.route, r.status, Math.round(r.ms * 10) / 10, r.ip?.slice(0, 64) ?? null);
  if (Number(info.lastInsertRowid) % 20 === 0) {
    ctx.db.prepare("DELETE FROM token_requests WHERE token_id = ? AND id NOT IN (SELECT id FROM token_requests WHERE token_id = ? ORDER BY id DESC LIMIT ?)").run(id, id, TOKEN_KEEP);
  }
}

export type AuditEvent = {
  id: number;
  at: string;
  actor: string | null;
  action: string;
  repo: string | null;
  owner: string | null;
  method: string;
  route: string;
  params: Record<string, string>;
  status: number;
  outcome: "done" | "denied";
  via: "token" | "browser" | null;
  ip: string | null;
};

type Row = {
  id: number;
  at: string;
  owner_handle: string | null;
  repo: string | null;
  actor_handle: string | null;
  token_kind: string | null;
  action: string;
  method: string;
  route: string;
  params: string;
  status: number;
  ip: string | null;
};

const toEvent = (r: Row): AuditEvent => ({
  id: r.id,
  at: r.at,
  actor: r.actor_handle,
  action: r.action,
  repo: r.repo,
  owner: r.owner_handle,
  method: r.method,
  route: r.route,
  params: JSON.parse(r.params) as Record<string, string>,
  status: r.status,
  outcome: r.status >= 400 ? "denied" : "done",
  via: r.token_kind === "pat" ? "token" : r.token_kind === "session" ? "browser" : null,
  ip: r.ip,
});

export function listEvents(ctx: Ctx, ownerId: number, opts: { repo?: string; actor?: string; outcome?: string; before?: number; limit?: number; max?: number } = {}) {
  const where = ["owner_id = ?"];
  const args: (string | number)[] = [ownerId];
  if (opts.repo) {
    where.push("repo = ?");
    args.push(opts.repo.toLowerCase());
  }
  if (opts.actor) {
    where.push("actor_handle = ?");
    args.push(opts.actor.replace(/^@/, "").toLowerCase());
  }
  if (opts.outcome === "denied") where.push("status >= 400");
  if (opts.outcome === "done") where.push("status < 400");
  if (opts.before) {
    where.push("id < ?");
    args.push(opts.before);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), opts.max ?? 500);
  const rows = ctx.db.prepare(`SELECT * FROM audit_events WHERE ${where.join(" AND ")} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1) as Row[];
  const more = rows.length > limit;
  const events = rows.slice(0, limit).map(toEvent);
  return { events, next: more ? events[events.length - 1].id : null };
}

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  // Cells that start with a formula character are neutralised, so a spreadsheet never runs a value as one.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function eventsCsv(events: AuditEvent[]): string {
  const head = ["time", "actor", "via", "action", "owner", "repository", "outcome", "status", "method", "route", "ip"];
  const lines = events.map((e) => [e.at, e.actor, e.via, e.action, e.owner, e.repo, e.outcome, e.status, e.method, e.route, e.ip].map(csvCell).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}

export function tokenRequests(ctx: Ctx, tokenId: number, limit = 100) {
  const rows = ctx.db.prepare("SELECT at, method, route, status, ms, ip FROM token_requests WHERE token_id = ? ORDER BY id DESC LIMIT ?").all(tokenId, Math.min(limit, TOKEN_KEEP)) as {
    at: string;
    method: string;
    route: string;
    status: number;
    ms: number;
    ip: string | null;
  }[];
  return rows;
}
