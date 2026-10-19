// Server-side client for the Craton API (backend/). Reads CRATON_API_URL from .env.local and
// sends the signed-in user's session token (an httpOnly cookie, see lib/session.ts), so every
// page shows exactly what that user may see; signed-out visitors see public data. Reads return
// null when the API isn't reachable, so pages fall back to the demo data in lib/data.ts.
// Import only from server code.

import { unstable_rethrow } from "next/navigation";
import { headers } from "next/headers";
import { getSessionToken } from "@/lib/session";
import { RateLimited, waitMessage } from "@/lib/ratelimit";

const BASE = process.env.CRATON_API_URL ?? "http://localhost:4000";
/** The API address people type into the CLI (CRATON_PUBLIC_API_URL when the web app reaches it privately). */
export const PUBLIC_API_URL = (process.env.CRATON_PUBLIC_API_URL ?? BASE).replace(/\/+$/, "");

async function authHeaders(token?: string | null): Promise<Record<string, string>> {
  const t = token === undefined ? await getSessionToken() : token;
  return { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(await clientHeaders()) };
}

/**
 * The browser's address and user agent, passed on so the API rate-limits each visitor rather than
 * this server, and can name the device in "new sign-in" emails. The API only honours these from
 * trusted proxies (CRATON_TRUSTED_PROXIES).
 */
async function clientHeaders(): Promise<Record<string, string>> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip");
    const ua = h.get("user-agent");
    return { ...(ip ? { "x-craton-client-ip": ip } : {}), ...(ua ? { "x-craton-user-agent": ua.slice(0, 400) } : {}) };
  } catch (err) {
    unstable_rethrow(err); // let Next.js see dynamic-rendering signals (cookies, no-store) instead of swallowing them
    return {}; // outside a request (build time)
  }
}

export type ApiRepo = {
  owner: string;
  name: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  region: string;
  crs: string;
  nodata: number | null;
  verticalDatum: number | null;
  requireChecks: boolean;
  requireReview: boolean;
  requireOwnerReview?: boolean;
  requireCog?: boolean;
  stars: number;
  forks: number;
  tags: string[];
  license: string;
  topics: string[];
  /** Path patterns of files that must be locked before they are changed. */
  lockPatterns?: string[];
  /** [west, south, east, north] degrees around the repository's located files, or null. */
  footprint: number[] | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};
export type ApiLicense = { id: string; name: string; url: string | null };
export type ApiLock = { path: string; reason: string; holder: string; lockedAt: string; ageDays?: number; stale?: boolean };
export type WebhookFormat = "json" | "slack" | "teams" | "discord";
export type ApiWebhook = { id: number; url: string; format: WebhookFormat; events: string[]; active: boolean; pausedReason?: string | null; createdAt: string; lastDelivery: { status: string; responseCode: number | null; at: string } | null };
export type ApiDelivery = { id: number; event: string; messageId: string; attempts: number; status: "pending" | "succeeded" | "failed"; responseCode: number | null; error: string | null; nextAttemptAt: string | null; createdAt: string; deliveredAt: string | null };
export type ApiTableDiff = {
  base: string;
  head: string;
  matchedBy: { kind: "key"; columns: string[] } | { kind: "position" };
  columns: { added: string[]; removed: string[]; common: string[] };
  rows: { before: number; after: number; added: number; removed: number; changed: number; unchanged: number };
  changed: { key: string; row: number; cells: { column: string; before: string; after: string; delta: number | null }[] }[];
  added: { key: string; row: number; values: Record<string, string> }[];
  removed: { key: string; row: number; values: Record<string, string> }[];
  truncated: boolean;
};
export type ApiTwoFactor = { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number };
/** How an account signs in: connected identity providers, whether a password is set, and whether this server offers Google. */
export type ApiIdentities = { identities: { provider: string; email: string; since: string }[]; hasPassword: boolean; googleAvailable: boolean; githubAvailable: boolean; passkeys: number };
export type ApiShareLink = { id: number; note: string; ref: string; commit: string; createdBy: string; createdAt: string; expiresAt: string; revokedAt: string | null; lastUsedAt: string | null; uses: number; active: boolean };
export type ApiSharedView = {
  repository: { owner: string; name: string; description: string; license: string; topics: string[]; crs: string };
  snapshot: { ref: string; commit: string; message: string; author: string; timestamp: string };
  note: string;
  expiresAt: string;
  totalBytes: number;
  files: { path: string; size: number }[];
};
export type ApiCitation = { source: "generated" | "CITATION.cff"; cff: string; bibtex: string; apa: string; hints: string[] };
export type ApiCommit = { sha: string; shortSha: string; tree: string; parents: string[]; author: string; message: string; timestamp: string; merkleRoot: string };
export type ApiChange = {
  path: string;
  change: "added" | "removed" | "modified";
  sizeBefore: number;
  sizeAfter: number;
  chunks: { added: number; removed: number; shared: number; addedBytes: number; map?: string };
};
export type ApiStep = { name: string; status: "passed" | "failed" | "skipped"; detail: string; files?: string[] };
export type ApiCheckRun = { id: number; commit: string; branch: string; status: "passed" | "failed"; steps: ApiStep[]; durationMs: number; createdAt: string };
export type ApiBranch = { name: string; isDefault: boolean; commit: ApiCommit; ahead: number; behind: number; updatedAt: string };
export type ApiTreeEntry = { name: string; path: string; type: "dir" | "file"; size: number; blob?: string; lastCommit?: { sha: string; message: string; timestamp: string; author: string } };
export type ApiIssue = { number: number; title: string; body: string; author: string; state: "open" | "closed"; label: "data-quality" | "question" | "enhancement" | "bug"; assignee: string | null; milestone: string | null; file: string | null; comments: number; createdAt: string; updatedAt: string };
export type ApiComment = { id: number; author: string; body: string; createdAt: string; editedAt: string | null; reactions: Partial<Record<"thumbs_up" | "thumbs_down" | "laugh" | "hooray" | "confused" | "heart" | "rocket" | "eyes", { count: number; mine: boolean; by: string[] }>> };
export type ApiReview = { author: string; state: "approved" | "changes_requested" | "commented"; body: string; commit: string; createdAt: string };
export type ApiPull = {
  number: number;
  title: string;
  body: string;
  author: string;
  source: string;
  target: string;
  state: "open" | "merged" | "closed";
  status: "open" | "merged" | "closed" | "approved" | "changes-requested";
  head: string | null;
  checks: "passed" | "failed" | null;
  approvals: number;
  comments: number;
  reviews: ApiReview[];
  /** People asked to review who haven't yet. */
  reviewRequests?: string[];
  createdAt: string;
  updatedAt: string;
};
export type ApiTextDiff = { path: string; base: string; head: string; added: number; removed: number; replaced: boolean; truncated: boolean; hunks: { oldStart: number; newStart: number; oldLines: number; newLines: number; lines: { t: " " | "+" | "-"; text: string }[] }[] };
export type ApiBlame = { path: string; ref: string; commit: string; size: number; chunks: number; truncated: boolean; ranges: { start: number; end: number; chunks: number; commit: string; author: string; message: string; timestamp: string }[] };
export type ApiOwnersPreview = { rules: number; files: number; owned: number; unowned: number; people: { handle: string; files: number; problem: string | null }[]; unownedSample: string[]; skipped: { line: number; text: string }[] };
/** Someone named in CODEOWNERS for files a pull request changes, and where they stand. */
export type ApiPullOwner = { handle: string; files: string[]; requested: boolean; state: "approved" | "changes_requested" | "commented" | null; current: boolean };
export type ApiRelease = { tag: string; commit: string; title: string; notes: string; prerelease: boolean; latest: boolean; merkleRoot: string; sizeBytes: number; checksums: { path: string; size: number; sha256: string }[]; run?: { software?: string; version?: string; plan?: string; runtimeSeconds?: number; completedAt?: string; notes?: string; inputs?: { repo: string; commit: string; note?: string }[] } | null; author: string; createdAt: string };
export type ApiStorage = {
  logicalBytes: number;
  historyBytes: number;
  uniqueBytes: number;
  storedBytes: number;
  chunkCount: number;
  averageChunkBytes: number;
  compressionRatio: number;
  savedByHistoryBytes: number;
  sharedWithOtherReposBytes: number;
  sharedChunkCount: number;
  sharedWith?: { repository: string; chunks: number; bytes: number }[];
  folders: { path: string; logicalBytes: number; uniqueBytes: number; storedBytes: number; codecs: string[] }[];
  storage: string;
};

export type ApiActivity = { type: "commit" | "branch" | "pr" | "comment" | "review" | "issue" | "release"; actor: string; text: string; repo: string; href: string; detail: string; at: string };
export type ApiInboxItem = ApiActivity & { key: string; read: boolean; done: boolean; reason: "mention" | "reply" | "activity" | "lock" | "review" };
export type ApiPasskey = { id: string; name: string; createdAt: string; lastUsedAt: string | null; transports: string[]; synced: boolean; backedUp: boolean };
export type ApiAuditEvent = {
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
export type ApiAuditPage = { events: ApiAuditEvent[]; next: number | null };
export type ApiTokenRequest = { at: string; method: string; route: string; status: number; ms: number; ip: string | null };
export type AuditScope = { kind: "repo"; owner: string; repo: string } | { kind: "org"; org: string } | { kind: "user" };
export type ApiReviewCounts = { todo: number; pass: number; fail: number; na: number };
export type ApiReviewItem = {
  key: string;
  group: string;
  text: string;
  hint: string;
  source: string;
  status: "todo" | "pass" | "fail" | "na";
  note: string;
  updatedBy: string | null;
  updatedAt: string | null;
  suggestion: { status: "pass" | "fail" | null; detail: string } | null;
};
export type ApiModelReviewSummary = {
  number: number;
  title: string;
  status: "draft" | "in_review" | "changes_requested" | "approved";
  ref: string;
  commit: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  counts: ApiReviewCounts;
  lastDecision: { by: string | null; decision: string; at: string } | null;
};
export type ApiModelReview = {
  number: number;
  title: string;
  template: string;
  status: ApiModelReviewSummary["status"];
  ref: string;
  commit: string;
  merkleRoot: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  counts: ApiReviewCounts;
  items: ApiReviewItem[];
  log: { id: number; author: string | null; body: string; at: string }[];
  signoffs: { id: number; user: string | null; decision: "approve" | "request_changes"; comment: string; independent: boolean; commit: string; at: string }[];
  evidence: {
    capturedAt: string;
    commit: string;
    merkleRoot: string;
    files: { count: number; bytes: number };
    checks: { status: "passed" | "failed"; at: string; steps: { name: string; status: string; detail: string }[] } | null;
    runs: { path: string; solution: string | null; unstable: boolean; maxWselError: number | null; computeTotal: string | null; runWindow: string | null }[];
  };
};
export type ApiMilestone = { id: number; title: string; description: string; due: string | null; state: "open" | "closed"; open: number; closed: number; createdAt: string };
export type ApiIssueTemplate = { file: string; name: string; about: string; label: "data-quality" | "question" | "enhancement" | "bug" | null; body: string };
export type ApiCollaborator = { handle: string; name: string; role: "Read" | "Write" | "Admin" };
export type ApiUsage = { plan: string; limitBytes: number; storedBytes: number; sharedFreeBytes: number; repositories: { total: number; public: number; private: number }; checks: { passed: number; failed: number } };
export type ApiUser = {
  handle: string;
  name: string;
  bio: string;
  website?: string;
  location?: string;
  company?: string;
  pronouns?: string;
  /** Whether a profile picture is stored (it is served at /avatar/<handle>). */
  hasAvatar?: boolean;
  email: string;
  plan: string;
  role: string | null;
  onboardedAt: string | null;
  createdAt: string;
  emailVerified: boolean;
  twoFactor?: boolean;
  /** The optional weekly summary email: off unless switched on in Settings. */
  digest?: "off" | "weekly";
  /** Which emails are wanted (all on until switched off) and the visibility a new repository starts with. */
  notify?: Record<"review_requests" | "checks_failed" | "repo_access" | "webhook_paused" | "storage", boolean>;
  defaultVisibility?: "public" | "private";
  writableOwners: string[];
};
/** A signed-in browser (web session), for Settings → Security. */
export type ApiSecurityEvent = { id: number; type: string; detail: string; ip: string | null; userAgent: string | null; at: string };
export type ApiSavedFilter = { id: number; kind: "issues" | "pulls"; name: string; state: string; label: string; q: string };
export type ApiInvite = { id: number; email: string; role: "Read" | "Write" | "Admin"; invitedBy: string; createdAt: string; expiresAt: string };
export type ApiInvitePreview = { repo: string; role: "Read" | "Write" | "Admin"; invitedBy: string; emailHint: string; expiresAt: string; hasAccount: boolean };
export type ApiSession = { id: number; createdAt: string; lastUsedAt: string | null; expiresAt: string | null; userAgent: string | null; ip: string | null; current: boolean };
/** Getting-started steps, in order: account, repository, merge, cli, push. */
export type ApiChecklist = { id: "account" | "repository" | "merge" | "cli" | "push"; done: boolean }[];
export type ApiFile = {
  path: string;
  ref: string;
  commit: string;
  size: number;
  sha256: string;
  blob: string;
  dataType: string | null;
  chunkCount: number;
  uniqueChunks: number;
  storedBytes: number;
  codecs: string[];
  raster: { width: number; height: number; bitsPerSample: number; sampleFormat: string; epsg: number | null; verticalEpsg: number | null; nodata: number | null; pixelScale: [number, number] | null; origin: [number, number] | null } | null;
  /** Why a raster is not laid out as a Cloud Optimized GeoTIFF (empty: it is); null when unknown or not a raster. */
  cog?: string[] | null;
  hdf5?: { version: number; groups: number; datasets: number; top: string[]; biggest: { path: string; type: string | null; shape: number[] | null }[]; results: boolean; properties: { path: string; name: string; value: string }[]; run: { group: string; solution: string | null; unstable: boolean; maxWselError: number | null; computeTotal: string | null; runWindow: string | null; cores: number | null; unstableAt: string | null; volume: { group: string; name: string; value: string | number | number[] }[] } | null; problems: string[]; notes: string[]; limited: boolean } | null;
  netcdf?: { format: string; conventions: string | null; records: number; dimensions: { name: string; length: number | null }[]; variables: { name: string; type: string; dimensions: string[]; units: string | null; longName: string | null }[]; globals: { name: string; value: string | number | number[] }[]; problems: string[] } | null;
  pointCloud?: { version: string; pointFormat: number; pointRecordLength: number; pointCount: number; compressed: boolean; scale: number[]; offset: number[]; min: number[]; max: number[]; epsg: number | null; generatingSoftware: string; problems: string[] } | null;
  vector: { valid: boolean; shapeType: string; bbox: number[]; features: number | null; epsg: number | null; sidecars: string[]; fields?: { name: string; type: string; length: number; decimals: number }[] } | null;
  /** Where the file is on Earth, [west, south, east, north] degrees, when its coordinate system can be placed. */
  extent?: number[] | null;
  table: { columns: string[]; rows: number } | null;
  preview: string | null;
  truncated: boolean;
  history: { sha: string; message: string; author: string; timestamp: string; change: string }[];
};
export type ApiCompare = {
  base: { ref: string; commit: string };
  head: { ref: string; commit: string };
  mergeBase: string | null;
  ahead: number;
  behind: number;
  fastForward: boolean;
  commits: ApiCommit[];
  changes: ApiChange[];
  conflicts: string[];
};
export type ApiRepoDetail = ApiRepo & { access: "none" | "read" | "write" | "admin"; starred: boolean; branchCount: number; commitCount: number; head: ApiCommit | null; readme: string | null; openIssues: number; openPulls: number };
/** One of an organization's domains, as its owners see it: the DNS record to publish until it is verified. */
export type ApiOrgDomain = { domain: string; verified: boolean; verifiedAt: string | null; autoJoin: boolean; createdAt: string; record?: { type: string; name: string; value: string } };

/** An organization's single sign-on setup, as its owners see it (the client secret is never sent back). */
export type ApiOrgScim = { baseUrl: string; tokens: { id: number; note: string; createdAt: string; lastUsedAt: string | null }[]; provisioned: number; domains: string[] };
export type ApiOrgSaml = { configured: boolean; entityId?: string; ssoUrl?: string; certificateExpires?: string; fingerprint?: string; enforced?: boolean; testedAt?: string | null; sp: { entityId: string; acsUrl: string; metadataUrl: string }; domains: string[] };
export type ApiOrgSso = { configured: boolean; issuer?: string; clientId?: string; hasSecret?: boolean; enforced?: boolean; testedAt?: string | null; redirectUri: string; domains: string[] };

export type ApiOwner = {
  handle: string;
  kind: "user" | "org";
  name: string;
  bio: string;
  website?: string;
  location?: string;
  company?: string;
  pronouns?: string;
  hasAvatar?: boolean;
  createdAt: string;
  members?: { handle: string; name: string; role: string }[];
  /** Domains an organization has proved it controls (public). */
  verifiedDomains?: string[];
  orgs?: string[];
  commitCount?: number;
  repositories: ApiRepo[];
};

/**
 * How long a page waits for the API before it gives up. A refused connection fails at once whatever this is; the limit
 * only matters when the API is slow or silent, and a spinner for a few seconds is kinder than an error page at 2.5.
 */
const READ_TIMEOUT_MS = 8000;

async function get<T>(path: string, timeoutMs = READ_TIMEOUT_MS): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/v1${path}`, {
      headers: await authHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 429) throw new RateLimited(res.headers.get("retry-after"));
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") ? await res.json() : await res.text()) as T;
  } catch (err) {
    unstable_rethrow(err);
    if (err instanceof RateLimited) throw err;
    return null;
  }
}

/** The user a specific session token belongs to (right after sign-in, before the cookie is sent back). */
export async function fetchUser(token: string): Promise<ApiUser | null> {
  try {
    const res = await fetch(`${BASE}/v1/user`, { headers: await authHeaders(token), cache: "no-store", signal: AbortSignal.timeout(2500) });
    return res.ok ? ((await res.json()) as ApiUser) : null;
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** Raw file bytes from the API (for the download route), or null when unreachable. */
export async function fetchRaw(owner: string, repo: string, ref: string, path: string): Promise<Response | null> {
  try {
    return await fetch(`${BASE}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/raw/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`, {
      headers: await authHeaders(),
      cache: "no-store",
    });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** Summary numbers the API sends with a rendered preview (X-Craton-Render). */
export type ApiRasterSummary = { validCells: number; nodataCells: number; min: number; max: number; mean: number; stdDev: number; p5: number; p50: number; p95: number };
export type ApiRasterStats = {
  sampled: { width: number; height: number; sourceWidth: number; sourceHeight: number; factor: number };
  sameGrid: boolean;
  before: ApiRasterSummary;
  after: ApiRasterSummary;
  change: { comparedCells: number; changedCells: number; meanChange: number; meanAbsChange: number; rmse: number; raisedPercent: number; loweredPercent: number; volumeChange: number | null } | null;
  histogram: { min: number; max: number; before: number[]; after: number[] };
};

export type RenderMeta = {
  width?: number;
  height?: number;
  min?: number;
  max?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  changedPercent?: number;
  minChange?: number;
  maxChange?: number;
  features?: number;
  /** A point cloud: its point count, and the share of the file the picture was drawn from. */
  points?: number;
  sampledShare?: number;
  diff?: { added: number; removed: number; changed: number; same: number } | null;
};

const renderUrl = (owner: string, repo: string, ref: string, path: string, opts: { base?: string; size?: number }) => {
  const q = new URLSearchParams();
  if (opts.base) q.set("base", opts.base);
  if (opts.size) q.set("size", String(opts.size));
  return `${BASE}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/render/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}${q.size ? `?${q}` : ""}`;
};

/**
 * Pass a browser's multipart upload through to the API as the signed-in user, without holding the
 * files in this server's memory. The API enforces size, permissions, plan limits and locks.
 */
export async function forwardUpload(owner: string, repo: string, request: Request): Promise<Response | null> {
  try {
    const headers = await authHeaders();
    headers["content-type"] = request.headers.get("content-type") ?? "";
    const length = request.headers.get("content-length");
    if (length) headers["content-length"] = length;
    return await fetch(`${BASE}/v1${repoPath(owner, repo)}/upload`, { method: "POST", headers, body: request.body, duplex: "half", cache: "no-store" } as RequestInit & { duplex: "half" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/**
 * A share link's contents. Deliberately sent with no session: the token in the address is the only
 * credential, and being signed in must not change what a link shows.
 */
export async function fetchShared(token: string, path = ""): Promise<Response | null> {
  try {
    return await fetch(`${BASE}/v1/shared/${encodeURIComponent(token)}${path}`, { headers: await clientHeaders(), cache: "no-store" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** The page's view of a link: its snapshot, or why there isn't one. */
export async function sharedView(token: string): Promise<{ status: "ok"; view: ApiSharedView } | { status: "gone" } | { status: "busy" } | { status: "down" }> {
  const res = await fetchShared(token);
  if (!res) return { status: "down" };
  if (res.status === 404) return { status: "gone" };
  if (res.status === 429) return { status: "busy" };
  if (!res.ok) return { status: "down" };
  return { status: "ok", view: (await res.json()) as ApiSharedView };
}

/** The repository (or one folder) as a ZIP stream, for the archive route to pass to the browser. */
export async function fetchArchive(owner: string, repo: string, ref: string, path?: string): Promise<Response | null> {
  try {
    const q = path ? `?path=${encodeURIComponent(path)}` : "";
    return await fetch(`${BASE}/v1${repoPath(owner, repo)}/archive/${encodeURIComponent(ref)}${q}`, { headers: await authHeaders(), cache: "no-store" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

export type ApiTileInfo = { width: number; height: number; tileSize: number; maxZoom: number; min: number; max: number; cellSize: [number, number]; origin: [number, number] | null; geographic: boolean; epsg: number | null; overviews: number; histogram: number[] };
export type ApiVectorFeatures = { bbox: [number, number, number, number]; fields: { name: string; type: string; length: number; decimals: number }[]; count: number; shown: number; thinned: boolean; features: { i: number; kind: "point" | "line" | "polygon"; parts: number[][]; props: Record<string, string | number | boolean | null> }[] };
export type ApiPixel = { column: number; row: number; value: number | null; x: number | null; y: number | null };

/** A raster's layout for zooming, or why it can not be zoomed. */
export async function fetchTileInfo(owner: string, repo: string, ref: string, path: string): Promise<Response | null> {
  try {
    return await fetch(`${BASE}/v1${repoPath(owner, repo)}/tileinfo/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: await authHeaders(), cache: "no-store" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** A shapefile's features and attribute rows, for the features route. */
export async function fetchFeatures(owner: string, repo: string, ref: string, path: string, ifNoneMatch?: string): Promise<Response | null> {
  try {
    const headers = await authHeaders();
    return await fetch(`${BASE}/v1${repoPath(owner, repo)}/features/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: ifNoneMatch ? { ...headers, "if-none-match": ifNoneMatch } : headers, cache: "no-store" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** What is at one pixel of a raster (value and map position), for the pixel route. */
export async function fetchPixel(owner: string, repo: string, ref: string, path: string, column: string, row: string): Promise<Response | null> {
  try {
    return await fetch(`${BASE}/v1${repoPath(owner, repo)}/pixel/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}?${new URLSearchParams({ column, row })}`, { headers: await authHeaders(), cache: "no-store" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** One 256-pixel tile of a raster, for the tile route to stream to the browser. */
export async function fetchTile(owner: string, repo: string, ref: string, path: string, z: string, x: string, y: string, ifNoneMatch?: string): Promise<Response | null> {
  try {
    const headers = await authHeaders();
    return await fetch(`${BASE}/v1${repoPath(owner, repo)}/tiles/${encodeURIComponent(ref)}/${encodeURIComponent(z)}/${encodeURIComponent(x)}/${encodeURIComponent(y)}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: ifNoneMatch ? { ...headers, "if-none-match": ifNoneMatch } : headers, cache: "no-store" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/** The rendered preview itself (PNG or SVG), for the render route to stream to the browser. */
export async function fetchRender(owner: string, repo: string, ref: string, path: string, opts: { base?: string; size?: number; ifNoneMatch?: string } = {}): Promise<Response | null> {
  try {
    const headers = await authHeaders();
    // Pass the browser's validator on, so an unchanged preview costs a 304 and no drawing.
    return await fetch(renderUrl(owner, repo, ref, path, opts), { headers: opts.ifNoneMatch ? { ...headers, "if-none-match": opts.ifNoneMatch } : headers, cache: "no-store" });
  } catch (err) {
    unstable_rethrow(err);
    return null;
  }
}

/**
 * Render a preview on the server and keep only its numbers, so a page can caption the image
 * (and decide whether to show it) before the browser asks for it; the API caches the render.
 * `error` is the reason there's no preview, e.g. an unsupported compression.
 */
export async function renderMeta(owner: string, repo: string, ref: string, path: string, opts: { base?: string; size?: number } = {}): Promise<{ meta: RenderMeta | null; error: string | null }> {
  const res = await fetchRender(owner, repo, ref, path, opts);
  if (!res) return { meta: null, error: "The Craton API isn't reachable." };
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    return { meta: null, error: body?.error?.message ?? `Preview failed (${res.status})` };
  }
  await res.arrayBuffer();
  try {
    return { meta: JSON.parse(res.headers.get("x-craton-render") ?? "{}") as RenderMeta, error: null };
  } catch (err) {
    unstable_rethrow(err);
    return { meta: {}, error: null };
  }
}

/** Whether Craton draws a preview for this path. */
export const previewable = (path: string) => /\.(tiff?|shp)$/i.test(path);

const repoPath = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;

export const api = {
  health: () => get<{ ok: boolean; storage: string }>("/health"),
  repos: (owner?: string, topic?: string) => {
    const q = new URLSearchParams();
    if (owner) q.set("owner", owner);
    if (topic) q.set("topic", topic);
    return get<ApiRepo[]>(`/repos${q.size ? `?${q}` : ""}`);
  },
  licenses: () => get<ApiLicense[]>("/licenses"),
  readmeTemplates: () => get<{ id: string; name: string; about: string }[]>("/readme-templates"),
  locks: (owner: string, repo: string) => get<ApiLock[]>(`${repoPath(owner, repo)}/locks`),
  webhooks: (owner: string, repo: string) => get<{ events: string[]; webhooks: ApiWebhook[] }>(`${repoPath(owner, repo)}/webhooks`),
  webhookDeliveries: (owner: string, repo: string, id: number) => get<ApiDelivery[]>(`${repoPath(owner, repo)}/webhooks/${id}/deliveries`),
  rasterStats: (owner: string, repo: string, ref: string, path: string, base: string) =>
    get<ApiRasterStats>(`${repoPath(owner, repo)}/raster-stats/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}?base=${encodeURIComponent(base)}`),
  tableDiff: (owner: string, repo: string, ref: string, path: string, base: string) =>
    get<ApiTableDiff>(`${repoPath(owner, repo)}/table-diff/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}?base=${encodeURIComponent(base)}`),
  twoFactor: () => get<ApiTwoFactor>("/user/2fa"),
  identities: () => get<ApiIdentities>("/user/identities"),
  passkeys: () => get<ApiPasskey[]>("/user/passkeys"),
  /** Which sign-in buttons this server can honour (a visitor, so no session is needed). */
  providers: () => get<{ google: boolean; github: boolean; sso?: boolean; passkeys: boolean }>("/auth/providers", 2500),
  shared: () => get<{ owner: string; name: string; role: "Read" | "Write" | "Admin" }[]>("/user/shared"),
  invites: (owner: string, repo: string) => get<ApiInvite[]>(`${repoPath(owner, repo)}/invites`),
  invitePreview: (token: string) => get<ApiInvitePreview>(`/invites/${encodeURIComponent(token)}`),
  collaborators: (owner: string, repo: string) => get<ApiCollaborator[]>(`${repoPath(owner, repo)}/collaborators`),
  shareLinks: (owner: string, repo: string) => get<{ expiryChoices: number[]; links: ApiShareLink[] }>(`${repoPath(owner, repo)}/share-links`),
  citation: (owner: string, repo: string) => get<ApiCitation>(`${repoPath(owner, repo)}/citation`),
  /** schema.org Dataset markup for a public repository (404 for a private one, so null). */
  datasetJsonLd: (owner: string, repo: string) => get<Record<string, unknown>>(`${repoPath(owner, repo)}/dataset.jsonld`),
  paths: (owner: string, repo: string, ref: string) => get<{ commit: string; files: { path: string; size: number }[] }>(`${repoPath(owner, repo)}/paths/${encodeURIComponent(ref)}`),
  // The root layout asks for this on every page. A visitor with no session cookie is nobody: do not make every page wait on
  // an API round trip to learn that. A signed-in visitor's page waits only briefly; if the API is slow they look signed
  // out for that one page rather than stalling the shell.
  user: async () => ((await getSessionToken()) ? get<ApiUser>("/user", 2500) : null),
  checklist: () => get<ApiChecklist>("/user/onboarding"),
  sessions: () => get<ApiSession[]>("/user/sessions"),
  savedFilters: (kind: "issues" | "pulls") => get<ApiSavedFilter[]>(`/user/filters?kind=${kind}`),
  securityLog: () => get<ApiSecurityEvent[]>("/user/security-log?limit=100"),
  plans: () => get<Record<"free" | "team", { storageBytes: number; privateRepos: number | null }>>("/plans"),
  usage: () => get<ApiUsage>("/user/usage"),
  ownerUsage: (handle: string) => get<ApiUsage>(`/owners/${encodeURIComponent(handle)}/usage`),
  tokens: () => get<{ id: number; note: string; scopes: string; created_at: string; expires_at: string | null; last_used_at: string | null; current: boolean; repos: string[] | null }[]>("/user/tokens"),
  activity: (opts: { actor?: string; limit?: number } = {}) => get<ApiActivity[]>(`/activity?limit=${opts.limit ?? 30}${opts.actor ? `&actor=${encodeURIComponent(opts.actor)}` : ""}`),
  inbox: (view: "inbox" | "done" | "all" = "inbox", limit = 100) => get<{ items: ApiInboxItem[]; unread: number }>(`/user/inbox?view=${view}&limit=${limit}`),
  inboxCount: () => get<{ unread: number }>("/user/inbox/count"),
  templates: (owner: string, repo: string) => get<{ issues: ApiIssueTemplate[]; pull: string | null }>(`${repoPath(owner, repo)}/templates`),
  milestones: (owner: string, repo: string) => get<ApiMilestone[]>(`${repoPath(owner, repo)}/milestones`),
  auditLog: (scope: AuditScope, q: { actor?: string; outcome?: string; before?: number; limit?: number } = {}) => {
    const base = scope.kind === "repo" ? `${repoPath(scope.owner, scope.repo)}/audit-log` : scope.kind === "org" ? `/orgs/${encodeURIComponent(scope.org)}/audit-log` : "/user/audit-log";
    const params = new URLSearchParams();
    if (q.actor) params.set("actor", q.actor);
    if (q.outcome) params.set("outcome", q.outcome);
    if (q.before) params.set("before", String(q.before));
    if (q.limit) params.set("limit", String(q.limit));
    return get<ApiAuditPage>(`${base}${params.size ? `?${params}` : ""}`);
  },
  tokenRequests: (id: number) => get<ApiTokenRequest[]>(`/user/tokens/${id}/requests`),
  modelReviews: (owner: string, repo: string) => get<ApiModelReviewSummary[]>(`${repoPath(owner, repo)}/model-reviews`),
  modelReview: (owner: string, repo: string, n: number) => get<ApiModelReview>(`${repoPath(owner, repo)}/model-reviews/${n}`),
  repoActivity: (owner: string, repo: string, limit = 30) => get<ApiActivity[]>(`${repoPath(owner, repo)}/activity?limit=${limit}`),
  allIssues: () => get<(ApiIssue & { repo: string })[]>("/issues"),
  allPulls: () => get<(ApiPull & { repo: string })[]>("/pulls"),
  repo: (owner: string, repo: string) => get<ApiRepoDetail>(repoPath(owner, repo)),
  file: (owner: string, repo: string, ref: string, path: string) => get<ApiFile>(`${repoPath(owner, repo)}/file/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`),
  tree: (owner: string, repo: string, ref: string, dir = "") => get<ApiTreeEntry[]>(`${repoPath(owner, repo)}/tree/${encodeURIComponent(ref)}?path=${encodeURIComponent(dir)}`),
  raw: (owner: string, repo: string, ref: string, path: string) => get<string>(`${repoPath(owner, repo)}/raw/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`),
  commits: (owner: string, repo: string, ref?: string, limit = 50) => get<(ApiCommit & { changes: ApiChange[] })[]>(`${repoPath(owner, repo)}/commits?changes=1&limit=${limit}${ref ? `&ref=${encodeURIComponent(ref)}` : ""}`),
  commit: (owner: string, repo: string, sha: string) => get<ApiCommit & { changes: ApiChange[]; checks: ApiCheckRun | null }>(`${repoPath(owner, repo)}/commits/${encodeURIComponent(sha)}`),
  branches: (owner: string, repo: string) => get<ApiBranch[]>(`${repoPath(owner, repo)}/branches`),
  compare: (owner: string, repo: string, base: string, head: string) => get<ApiCompare>(`${repoPath(owner, repo)}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`),
  checks: (owner: string, repo: string) => get<ApiCheckRun[]>(`${repoPath(owner, repo)}/checks`),
  storage: (owner: string, repo: string) => get<ApiStorage>(`${repoPath(owner, repo)}/storage`),
  audit: (owner: string, repo: string) => get<Record<string, unknown>>(`${repoPath(owner, repo)}/audit`),
  issues: (owner: string, repo: string) => get<ApiIssue[]>(`${repoPath(owner, repo)}/issues`),
  issue: (owner: string, repo: string, n: number) => get<ApiIssue & { thread: ApiComment[] }>(`${repoPath(owner, repo)}/issues/${n}`),
  pulls: (owner: string, repo: string) => get<ApiPull[]>(`${repoPath(owner, repo)}/pulls`),
  pull: (owner: string, repo: string, n: number) => get<ApiPull & { thread: ApiComment[] }>(`${repoPath(owner, repo)}/pulls/${n}`),
  textDiff: (owner: string, repo: string, ref: string, path: string, base: string) => get<ApiTextDiff>(`${repoPath(owner, repo)}/text-diff/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}?base=${encodeURIComponent(base)}`),
  blame: (owner: string, repo: string, ref: string, path: string) => get<ApiBlame>(`${repoPath(owner, repo)}/blame/${encodeURIComponent(ref)}/${path.split("/").map(encodeURIComponent).join("/")}`),
  pullOwners: (owner: string, repo: string, n: number) => get<ApiPullOwner[]>(`${repoPath(owner, repo)}/pulls/${n}/owners`),
  releases: (owner: string, repo: string) => get<ApiRelease[]>(`${repoPath(owner, repo)}/releases`),
  search: (q: string) => get<{ repositories: ApiRepo[]; files: { repo: string; path: string; size: number }[]; people: { handle: string; name: string; bio: string }[]; organizations: { handle: string; name: string; bio: string }[] }>(`/search?q=${encodeURIComponent(q)}`),
  owner: (handle: string) => get<ApiOwner>(`/owners/${encodeURIComponent(handle)}`),
  orgSso: (org: string) => get<ApiOrgSso>(`/orgs/${encodeURIComponent(org)}/sso`),
  orgSaml: (org: string) => get<ApiOrgSaml>(`/orgs/${encodeURIComponent(org)}/saml`),
  orgScim: (org: string) => get<ApiOrgScim>(`/orgs/${encodeURIComponent(org)}/scim`),
  orgDomains: (org: string) => get<{ domains: ApiOrgDomain[] }>(`/orgs/${encodeURIComponent(org)}/domains`),
  starred: () => get<ApiRepo[]>("/user/starred"),
  trending: (period: "day" | "week" | "month") => get<(ApiRepo & { gained: number; starred: boolean })[]>(`/trending?period=${period}`),
  ownerStarred: (handle: string) => get<ApiRepo[]>(`/owners/${encodeURIComponent(handle)}/starred`),
};

/** Result of a write: the API's JSON on success, its error message otherwise. */
export type SendResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string; offline?: boolean };

/** Send raw bytes as the signed-in user (a profile picture). */
export async function sendBytes<T>(method: "PUT", path: string, bytes: Uint8Array, contentType: string): Promise<SendResult<T>> {
  try {
    const res = await fetch(`${BASE}/v1${path}`, { method, headers: { ...(await authHeaders()), "content-type": contentType }, body: bytes as BodyInit, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    const json = await res.json().catch(() => null);
    if (res.status === 401) return { ok: false, error: "Sign in to do this." };
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Request failed (${res.status}).`, code: json?.error?.code };
    return { ok: true, data: json as T };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, offline: true, error: "The Craton API isn't reachable right now. Your data is safe; try again in a moment." };
  }
}

/**
 * Write through the API as the signed-in user (server actions in app/actions.ts and
 * app/auth-actions.ts). Pass `token` to act with a specific session, e.g. right after signup.
 */
export async function send<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown, token?: string | null): Promise<SendResult<T>> {
  try {
    const res = await fetch(`${BASE}/v1${path}`, {
      method,
      headers: { ...(await authHeaders(token)), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 204) return { ok: true, data: null as T };
    const json = await res.json().catch(() => null);
    // The sign-in endpoints (password, two-step code, Google, passkey) answer 401 with their own, more useful messages.
    if (res.status === 401 && !path.startsWith("/auth/")) return { ok: false, error: "Sign in to do this." };
    if (res.status === 429) return { ok: false, error: waitMessage(res.headers.get("retry-after"), json?.error?.message), code: "rate_limited" };
    if (!res.ok) return { ok: false, error: json?.error?.message ?? `Request failed (${res.status}).`, code: json?.error?.code };
    return { ok: true, data: json as T };
  } catch (err) {
    unstable_rethrow(err);
    return { ok: false, offline: true, error: "The Craton API isn't reachable right now. Your data is safe; try again in a moment." };
  }
}
