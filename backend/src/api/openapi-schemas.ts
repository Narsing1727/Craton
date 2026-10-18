// Response schemas for the endpoints people script against first. Written by hand, and checked against the real
// responses in test/openapi.test.ts, so a field that is renamed or dropped fails a test rather than the document.
// Only fields that are always present are `required`; the schemas do not forbid extra fields.

type Schema = Record<string, unknown>;

const str: Schema = { type: "string" };
const int: Schema = { type: "integer" };
const num: Schema = { type: "number" };
const bool: Schema = { type: "boolean" };
const nullable = (s: Schema): Schema => ({ ...s, type: [s.type, "null"] });
const arr = (items: Schema): Schema => ({ type: "array", items });
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const obj = (properties: Record<string, Schema>, required: string[] = Object.keys(properties)): Schema => ({ type: "object", properties, required });

export const schemas: Record<string, Schema> = {
  Health: obj({ ok: bool, storage: str, time: str, version: str, apiVersion: int, minCliVersion: str }),
  User: obj(
    { handle: str, name: str, bio: str, email: str, plan: str, emailVerified: bool, twoFactor: bool, createdAt: str, writableOwners: arr(str) },
  ),
  Repo: obj({
    owner: str, name: str, description: str, visibility: { type: "string", enum: ["public", "private"] }, defaultBranch: str, crs: str,
    nodata: nullable(num), verticalDatum: nullable(int), requireChecks: bool, requireReview: bool, requireOwnerReview: bool, requireCog: bool,
    stars: int, forks: int, license: str, topics: arr(str), lockPatterns: arr(str), sizeBytes: int, createdAt: str, updatedAt: str,
  }),
  RepoDetail: {
    allOf: [ref("Repo"), obj({ access: { type: "string", enum: ["none", "read", "write", "admin"] }, starred: bool, branchCount: int, commitCount: int, openIssues: int, openPulls: int })],
  },
  Commit: obj({ sha: str, shortSha: str, tree: str, parents: arr(str), author: str, message: str, timestamp: str, merkleRoot: str }),
  Ref: obj({ name: str, kind: { type: "string", enum: ["branch", "tag"] }, commit_id: str, updated_at: str }),
  Refs: obj({ branches: arr(ref("Ref")), tags: arr(ref("Ref")), defaultBranch: str }),
  Release: obj(
    {
      tag: str, commit: str, title: str, notes: str, prerelease: bool, latest: bool, merkleRoot: str, sizeBytes: int, author: str, createdAt: str,
      checksums: arr(obj({ path: str, size: int, sha256: str })),
    },
  ),
  FileChange: obj({
    path: str, change: { type: "string", enum: ["added", "removed", "modified"] }, sizeBefore: int, sizeAfter: int,
    chunks: obj({ added: int, removed: int, shared: int, addedBytes: int }, ["added", "removed", "shared", "addedBytes"]),
  }, ["path", "change", "sizeBefore", "sizeAfter", "chunks"]),
  Compare: obj({
    base: obj({ ref: str, commit: str }), head: obj({ ref: str, commit: str }), mergeBase: nullable(str), ahead: int, behind: int,
    fastForward: bool, commits: arr(ref("Commit")), changes: arr(ref("FileChange")), conflicts: arr(str),
  }),
  CellSummary: obj({ validCells: int, nodataCells: int, min: num, max: num, mean: num, stdDev: num, p5: num, p50: num, p95: num }),
  RasterStats: obj({
    sampled: obj({ width: int, height: int, sourceWidth: int, sourceHeight: int, factor: num }),
    sameGrid: bool,
    before: ref("CellSummary"),
    after: ref("CellSummary"),
    change: {
      type: ["object", "null"],
      properties: { comparedCells: int, changedCells: int, meanChange: num, meanAbsChange: num, rmse: num, raisedPercent: num, loweredPercent: num, volumeChange: nullable(num) },
      required: ["comparedCells", "changedCells", "meanChange", "meanAbsChange", "rmse", "raisedPercent", "loweredPercent"],
    },
    histogram: obj({ min: num, max: num, before: arr(int), after: arr(int) }),
  }),
  Issue: obj({
    number: int, title: str, body: str, author: str, state: { type: "string", enum: ["open", "closed"] },
    label: { type: "string", enum: ["data-quality", "question", "enhancement", "bug"] },
    assignee: nullable(str), milestone: nullable(str), file: nullable(str), comments: int, createdAt: str, updatedAt: str,
  }),
  Lock: obj({ path: str, reason: str, holder: str, lockedAt: str, ageDays: int, stale: bool }),
  // The token list still uses snake_case names and a comma-separated scope string (unlike the rest of the API).
  Token: obj({ id: int, note: str, scopes: str, kind: str, created_at: str, expires_at: nullable(str), last_used_at: nullable(str), repos: { type: ["array", "string", "null"] }, current: bool }, ["id", "note", "scopes", "created_at", "current"]),
  Usage: obj({
    plan: str, limitBytes: int, storedBytes: int, sharedFreeBytes: int,
    repositories: obj({ total: int, public: int, private: int }),
    checks: obj({ passed: int, failed: int }),
  }),
  CheckStep: obj({ name: str, status: { type: "string", enum: ["passed", "failed", "skipped"] }, detail: str }, ["name", "status", "detail"]),
  CheckRun: obj({
    id: int, commit: str, branch: str, status: { type: "string", enum: ["passed", "failed"] },
    steps: arr(ref("CheckStep")), durationMs: int, createdAt: str,
  }),
  FileInfo: obj(
    {
      path: str, ref: str, commit: str, size: int, sha256: str, blob: str, dataType: nullable(str), chunkCount: int, uniqueChunks: int,
      storedBytes: int, codecs: arr(str), raster: { type: ["object", "null"] }, cog: { type: ["array", "null"], items: str }, pointCloud: { type: ["object", "null"] }, netcdf: { type: ["object", "null"] }, hdf5: { type: ["object", "null"] }, vector: { type: ["object", "null"] }, extent: { type: ["array", "null"], items: num },
      table: { type: ["object", "null"] }, history: arr(obj({ sha: str, message: str, author: str, timestamp: str, change: str })),
    },
    ["path", "ref", "commit", "size", "sha256", "blob", "chunkCount", "uniqueChunks", "storedBytes", "codecs", "history"],
  ),
  TreeEntry: obj(
    {
      name: str, path: str, type: { type: "string", enum: ["dir", "file"] }, size: int,
      lastCommit: obj({ sha: str, message: str, timestamp: str, author: str }),
    },
    ["name", "path", "type", "size"],
  ),
  Paths: obj({ commit: str, files: arr(obj({ path: str, size: int })) }),
  InboxCount: obj({ unread: int }),
  Session: obj({ id: int, createdAt: str, lastUsedAt: nullable(str), expiresAt: str, userAgent: nullable(str), ip: nullable(str), current: bool }),
  Pull: obj({
    number: int, title: str, body: str, author: str, source: str, target: str, state: { type: "string", enum: ["open", "merged", "closed"] },
    head: nullable(str), checks: str, approvals: int, comments: int, reviews: arr(obj({ author: str, state: str, commit: str, createdAt: str })), reviewRequests: arr(str),
    createdAt: str, updatedAt: str,
  }),
};

/** Which schema describes the 200 response of an operation, by "method path" as it appears in the document. */
export const responses: Record<string, Schema> = {
  "get /health": ref("Health"),
  "get /user": ref("User"),
  "get /repos": arr(ref("Repo")),
  "get /repos/{owner}/{repo}": ref("RepoDetail"),
  "get /repos/{owner}/{repo}/commits": arr(ref("Commit")),
  "get /repos/{owner}/{repo}/releases": arr(ref("Release")),
  "get /repos/{owner}/{repo}/refs": ref("Refs"),
  "get /repos/{owner}/{repo}/compare/{spec}": ref("Compare"),
  "get /repos/{owner}/{repo}/raster-stats/{ref}/{path}": ref("RasterStats"),
  "get /repos/{owner}/{repo}/pulls": arr(ref("Pull")),
  "get /repos/{owner}/{repo}/issues": arr(ref("Issue")),
  "get /repos/{owner}/{repo}/locks": arr(ref("Lock")),
  "get /user/tokens": arr(ref("Token")),
  "get /user/usage": ref("Usage"),
  "get /repos/{owner}/{repo}/checks": arr(ref("CheckRun")),
  "get /repos/{owner}/{repo}/file/{ref}/{path}": ref("FileInfo"),
  "get /repos/{owner}/{repo}/tree/{ref}": arr(ref("TreeEntry")),
  "get /repos/{owner}/{repo}/paths/{ref}": ref("Paths"),
  "get /user/inbox/count": ref("InboxCount"),
  "get /user/sessions": arr(ref("Session")),
};

/** Request bodies for the write endpoints people script, each with an example the tests actually send. */
export const requests: Record<string, { schema: Schema; example: Record<string, unknown> }> = {
  "post /repos": {
    schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Lowercase letters, numbers, dots, dashes, underscores." },
        owner: { type: "string", description: "An organization you can create repositories for; defaults to you." },
        description: str,
        visibility: { type: "string", enum: ["public", "private"] },
        crs: { type: "string", description: "For example EPSG:32643." },
        nodata: nullable(num),
        verticalDatum: nullable(int),
        sample: { type: "boolean", description: "Fill the repository with the sample project." },
      },
      required: ["name"],
    },
    example: { name: "river-model", visibility: "private", crs: "EPSG:32643" },
  },
  "post /repos/{owner}/{repo}/releases": {
    schema: {
      type: "object",
      properties: { tag: { type: "string", description: "A version such as v1.3.0 or v1.3.0-rc.1." }, target: { type: "string", description: "Branch or commit; defaults to the default branch." }, title: str, notes: str, prerelease: bool },
      required: ["tag"],
    },
    example: { tag: "v1.0.0", title: "First release", notes: "Terrain and gauges." },
  },
  "post /repos/{owner}/{repo}/issues": {
    schema: {
      type: "object",
      properties: { title: str, body: str, label: str, assignee: nullable(str), milestone: nullable(str), file: nullable(str) },
      required: ["title"],
    },
    example: { title: "Datum mismatch between surveys", body: "The 2023 DEM uses a different vertical datum.", label: "bug" },
  },
  "post /repos/{owner}/{repo}/pulls": {
    schema: { type: "object", properties: { title: str, body: str, source: { type: "string", description: "The branch with the changes." }, target: { type: "string", description: "Defaults to the default branch." } }, required: ["title", "source"] },
    example: { title: "Re-survey the right bank", source: "sample-resurvey" },
  },
  "post /repos/{owner}/{repo}/pulls/{n}/reviews": {
    schema: { type: "object", properties: { state: { type: "string", enum: ["approved", "changes_requested", "commented"] }, body: str }, required: ["state"] },
    example: { state: "commented", body: "Looks right to me." },
  },
  "post /repos/{owner}/{repo}/locks": {
    schema: { type: "object", properties: { path: { type: "string", description: "A file path in the repository." }, reason: str }, required: ["path"] },
    example: { path: "terrain/basin_dem.tif", reason: "Re-tiling" },
  },
};

/** Query parameters of the operations that take them (path parameters come from the route itself). */
export const queries: Record<string, { name: string; description: string; schema: Schema; required?: boolean }[]> = {
  "get /repos/{owner}/{repo}/commits": [
    { name: "ref", description: "Branch, tag or commit to walk back from. Default: the default branch.", schema: str },
    { name: "limit", description: "How many commits, 1 to 500. Default 50.", schema: int },
    { name: "offset", description: "Skip this many newest commits, to page through a long history.", schema: int },
    { name: "since", description: "Only commits at or after this date or time (2026-10-01 or 2026-10-01T12:00:00Z).", schema: str },
    { name: "until", description: "Only commits at or before this date or time.", schema: str },
    { name: "author", description: "Only commits by this handle.", schema: str },
    { name: "changes", description: "Set to 1 to include each commit's changed files with chunk counts.", schema: str },
  ],
  "get /repos/{owner}/{repo}/raster-stats/{ref}/{path}": [
    { name: "base", description: "The earlier version to compare against (branch, tag or commit).", schema: str, required: true },
    { name: "size", description: "Longest side of the sampled grid, 64 to 1024. Default 512.", schema: int },
  ],
  "get /repos/{owner}/{repo}/archive/{ref}": [{ name: "path", description: "Download only this folder.", schema: str }],
  "get /repos/{owner}/{repo}/render/{ref}/{path}": [
    { name: "base", description: "Draw the change from this version instead of the file itself.", schema: str },
    { name: "size", description: "Longest side of the image in pixels, 64 to 1024.", schema: int },
  ],
};

/** What the write endpoints answer with when they create something (status 201), or 200 for a review. */
export const created: Record<string, { status: "200" | "201"; schema: Schema }> = {
  "post /repos": { status: "201", schema: ref("Repo") },
  "post /repos/{owner}/{repo}/releases": { status: "201", schema: ref("Release") },
  "post /repos/{owner}/{repo}/issues": { status: "201", schema: ref("Issue") },
  "post /repos/{owner}/{repo}/pulls": { status: "201", schema: ref("Pull") },
  "post /repos/{owner}/{repo}/pulls/{n}/reviews": { status: "200", schema: ref("Pull") },
  "post /repos/{owner}/{repo}/locks": { status: "201", schema: ref("Lock") },
};
