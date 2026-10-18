// Secret scanning: stop a credential from entering a repository's history.
//
// Run on what a push or an upload would add (only the files that changed, only text, nothing stored yet), because
// history is append-only: once a key is in a commit it can't be taken out again, only rotated. Each finding is a
// pattern that is hard to hit by accident (a fixed prefix plus a checksum or a length), and for Craton's own tokens
// the server also asks whether the token is live, so a revoked one never blocks anybody.
//
// A finding names the file, the line and the kind, and shows only the first few characters of what it found.
// The secret itself is never written to a response, a log or the audit trail.

import { BlobReader } from "./chunks.ts";
import { config } from "../config.ts";
import type { Ctx } from "./context.ts";
import { ApiError } from "./context.ts";
import { liveToken, revokeExposedToken } from "./accounts.ts";
import * as audit from "./audit.ts";
import { commitsBetween, getObject } from "./history.ts";
import { diffTrees, type BlobObject, type CommitObject, type TreeObject } from "../core/objects.ts";
import { LEGACY_TOKEN_IN_TEXT, TOKEN_IN_TEXT, checksumValid } from "../core/tokens.ts";
import type { RepoRow } from "./repos.ts";

/** Files bigger than this are not read (a model or a raster, not a config file). */
export const MAX_SCAN_BYTES = 2 * 1024 * 1024;
const MAX_FINDINGS = 25;
const MAX_BLOBS = 2000;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** A line carrying this is skipped: for a harmless example that looks like a key. */
export const ALLOW_MARKER = "craton:allow-secret";

export type Finding = {
  path: string;
  line: number;
  kind: string;
  /** The first few characters only. */
  preview: string;
  /** A Craton token that works right now. */
  live?: boolean;
  /** The commit it was found in, for a push of several. */
  commit?: string;
  /** Not sent to clients. */
  tokenId?: number;
};

type Hit = { kind: string; match: string; index: number; live?: boolean; tokenId?: number; preview?: string };
type Detector = { kind: string; re: RegExp; check?: (m: RegExpExecArray, ctx: Ctx) => Promise<Omit<Hit, "kind" | "match" | "index"> | null> | Omit<Hit, "kind" | "match" | "index"> | null };

const PLACEHOLDER_PASSWORD = /^(?:password|passwd|pass|secret|changeme|change-me|example|your[-_ ]?password|xxx+|\*+|\.{3}|0+|1234\d*|test|admin|root)$/i;
const LOCAL_HOST = /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|host\.docker\.internal|(?:[a-z0-9-]+\.)?example\.(?:com|org|net))(?::\d+)?$/i;

const DETECTORS: Detector[] = [
  {
    kind: "Craton access token",
    re: new RegExp(TOKEN_IN_TEXT.source, "g"),
    check: async (m, ctx) => {
      if (!checksumValid(m[2])) return null;
      const live = await liveToken(ctx, m[0]);
      // A token that no longer works is not a secret any more.
      return live ? { live: true, tokenId: live.id, preview: `crt_${m[1]}_…` } : null;
    },
  },
  {
    kind: "Craton access token",
    re: new RegExp(LEGACY_TOKEN_IN_TEXT.source, "g"),
    check: async (m, ctx) => {
      const live = await liveToken(ctx, m[0]);
      return live ? { live: true, tokenId: live.id, preview: "bcn_…" } : null;
    },
  },
  { kind: "GitHub token", re: /(?<![A-Za-z0-9_])gh[pousr]_([0-9A-Za-z]{36})(?![A-Za-z0-9_])/g, check: (m) => (checksumValid(m[1]) ? { preview: m[0].slice(0, 4) + "…" } : null) },
  { kind: "GitHub token", re: /(?<![A-Za-z0-9_])github_pat_[0-9A-Za-z_]{82}(?![A-Za-z0-9_])/g, check: () => ({ preview: "github_pat_…" }) },
  { kind: "AWS access key id", re: /(?<![A-Za-z0-9])(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])/g, check: (m) => (m[0].endsWith("EXAMPLE") ? null : { preview: m[0].slice(0, 4) + "…" }) },
  { kind: "Google API key", re: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g, check: () => ({ preview: "AIza…" }) },
  { kind: "Google OAuth client secret", re: /(?<![A-Za-z0-9_-])GOCSPX-[0-9A-Za-z_-]{28}(?![A-Za-z0-9_-])/g, check: () => ({ preview: "GOCSPX-…" }) },
  { kind: "Slack token", re: /(?<![A-Za-z0-9-])xox[abprs]-[0-9A-Za-z]+(?:-[0-9A-Za-z]+){2,}(?![A-Za-z0-9-])/g, check: (m) => (m[0].length >= 24 ? { preview: m[0].slice(0, 5) + "…" } : null) },
  { kind: "Slack webhook", re: /hooks\.slack\.com\/services\/T[A-Z0-9]{8,}\/B[A-Z0-9]{8,}\/[A-Za-z0-9]{20,}/g, check: () => ({ preview: "hooks.slack.com/…" }) },
  { kind: "Stripe live key", re: /(?<![A-Za-z0-9_])[sr]k_live_[0-9A-Za-z]{20,}(?![A-Za-z0-9_])/g, check: (m) => ({ preview: m[0].slice(0, 8) + "…" }) },
  { kind: "Anthropic API key", re: /(?<![A-Za-z0-9_-])sk-ant-[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, check: () => ({ preview: "sk-ant-…" }) },
  { kind: "OpenAI API key", re: /(?<![A-Za-z0-9_-])sk-proj-[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g, check: () => ({ preview: "sk-proj-…" }) },
  {
    kind: "Private key",
    re: /-----BEGIN ((?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?)-----[ \t]*\r?\n(?:Proc-Type|[A-Za-z0-9+/=]{40,})/g,
    check: (m) => ({ preview: `BEGIN ${m[1]}` }),
  },
  {
    kind: "Database password in a connection address",
    re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/([^\s:@/'"<>]+):([^\s@/'"<>]{6,})@([^\s/'"<>]+)/g,
    check: (m) => {
      const [, user, password, host] = m;
      if (PLACEHOLDER_PASSWORD.test(password) || password === user || /^[$%{<]/.test(password) || LOCAL_HOST.test(host)) return null;
      return { preview: m[0].slice(0, m[0].indexOf("://") + 3) + "…" };
    },
  },
];

/** Every credential in one file's text. `path` only labels the findings. */
export async function scanText(ctx: Ctx, path: string, text: string): Promise<Finding[]> {
  const found: Finding[] = [];
  let starts: number[] | null = null;
  const lineOf = (index: number) => {
    if (!starts) {
      starts = [0];
      for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
    }
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= index) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  const seen = new Set<string>();
  for (const d of DETECTORS) {
    d.re.lastIndex = 0;
    for (let m = d.re.exec(text); m; m = d.re.exec(text)) {
      const hit = d.check ? await d.check(m, ctx) : {};
      if (!hit) continue;
      const line = lineOf(m.index);
      const lineStart = starts![line];
      const lineEnd = text.indexOf("\n", m.index);
      if (text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd).includes(ALLOW_MARKER)) continue;
      const key = `${line}|${d.kind}|${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({ path, line: line + 1, kind: d.kind, preview: hit.preview ?? "…", ...(hit.live ? { live: true } : {}), ...(hit.tokenId ? { tokenId: hit.tokenId } : {}) });
      if (found.length >= MAX_FINDINGS) return found;
    }
  }
  return found.sort((a, b) => a.line - b.line);
}

/** Text a person wrote, as opposed to a raster, a model or an archive: no NUL byte near the start. */
const looksLikeText = (data: Buffer) => !data.subarray(0, 8192).includes(0);

export type Candidate = { path: string; size: number; commit?: string; load: () => Promise<Buffer> };

export async function scanFiles(ctx: Ctx, files: Candidate[]): Promise<{ findings: Finding[]; scanned: number }> {
  const findings: Finding[] = [];
  let scanned = 0;
  let total = 0;
  if (!config.secretScan.enabled) return { findings, scanned };
  for (const f of files) {
    if (f.size > MAX_SCAN_BYTES || f.size === 0) continue;
    total += f.size;
    if (total > MAX_TOTAL_BYTES || scanned >= MAX_BLOBS) break;
    const data = await f.load();
    if (!looksLikeText(data)) continue;
    scanned++;
    for (const hit of await scanText(ctx, f.path, data.toString("utf8"))) {
      findings.push(f.commit ? { ...hit, commit: f.commit } : hit);
      if (findings.length >= MAX_FINDINGS) return { findings, scanned };
    }
  }
  return { findings, scanned };
}

/** What moving `branch` to `to` would add: every file added or changed by a commit the repository does not have on that branch yet. */
export async function scanPush(ctx: Ctx, repo: RepoRow, from: string | null, to: string) {
  if (!config.secretScan.enabled) return { findings: [] as Finding[], scanned: 0 };
  const commits = await commitsBetween(ctx, repo, from, to);
  const seen = new Set<string>();
  const files: Candidate[] = [];
  for (const id of commits) {
    const commit = await getObject<CommitObject>(ctx, repo, id, "commit");
    const after = await getObject<TreeObject>(ctx, repo, commit.tree, "tree");
    const parent = commit.parents[0] ? await getObject<CommitObject>(ctx, repo, commit.parents[0], "commit") : null;
    const before = parent ? await getObject<TreeObject>(ctx, repo, parent.tree, "tree") : null;
    for (const ch of diffTrees(before, after)) {
      if (ch.change === "removed" || !ch.newBlob || seen.has(ch.newBlob)) continue;
      seen.add(ch.newBlob);
      const blobId = ch.newBlob;
      files.push({ path: ch.path, size: ch.sizeAfter, commit: commits.length > 1 ? id.slice(0, 7) : undefined, load: async () => new BlobReader(ctx, await getObject<BlobObject>(ctx, repo, blobId, "blob")).readAll() });
    }
  }
  return scanFiles(ctx, files);
}

/** Scan what moving `branch` to commit `next` would add. A commit the repository does not have is left for the update itself to refuse. */
export async function scanBranchUpdate(ctx: Ctx, repo: RepoRow, branch: string, next: string) {
  const none = { findings: [] as Finding[], scanned: 0 };
  if (!config.secretScan.enabled || !await ctx.db.get("SELECT 1 FROM commits WHERE repo_id = ? AND id = ?", repo.id, next)) return none;
  const tipOf = async (name: string) => (await ctx.db.get("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?", repo.id, name) as { commit_id: string } | undefined)?.commit_id ?? null;
  // An existing branch: what is new since its tip. A new one: what is new since the default branch.
  const from = await tipOf(branch) ?? await tipOf(repo.default_branch);
  if (from === next) return none;
  return scanPush(ctx, repo, from, next);
}

export type Who = { id: number; handle: string; tokenId: number; tokenKind: string };

const uniqueKinds = (findings: Finding[]) => [...new Set(findings.map((f) => f.kind))];

function describe(findings: Finding[]): string {
  const label = (f: Finding) => {
    const what = `${f.live ? "live " : ""}${f.kind}`;
    return `${/^[AEIOU]/.test(what) ? "an" : "a"} ${what}`;
  };
  const shown = findings.slice(0, 5).map((f) => `${label(f)} in ${f.path} line ${f.line}${f.commit ? ` (commit ${f.commit})` : ""}`);
  const more = findings.length > shown.length ? `, and ${findings.length - shown.length} more` : "";
  return shown.join("; ") + more;
}

/**
 * Decide what to do with what the scan found. Nothing found: carry on. Something found: stop with a 422 that names
 * each place (never the secret), unless a repository administrator gave a reason to go ahead, in which case the push
 * is let through, the reason goes into the audit log, and a live Craton token in a public repository is revoked.
 */
export async function enforce(ctx: Ctx, repo: RepoRow, who: Who, findings: Finding[], bypass: string | null, route: string): Promise<{ bypassed: boolean; revoked: number }> {
  if (!findings.length) return { bypassed: false, revoked: 0 };
  const kinds = uniqueKinds(findings).join(", ");
  const note = { repo, ownerId: repo.owner_id, actor: who, route };
  if (!bypass) {
    await audit.recordNote(ctx, { ...note, action: "Push stopped: a credential was found", params: { findings: findings.length, kinds }, status: 422 });
    const clean = findings.map(({ tokenId: _unused, ...f }) => f);
    throw new ApiError(
      422,
      "secret_detected",
      `Nothing was pushed: ${describe(findings)}. History can’t be edited afterwards, so take ${findings.length === 1 ? "it" : "them"} out of the files (and rotate ${findings.length === 1 ? "it" : "them"} if ${findings.length === 1 ? "it was" : "they were"} ever real). A line that is only an example can carry “${ALLOW_MARKER}”. A repository administrator can push anyway with a reason.`,
      { findings: clean },
    );
  }
  let revoked = 0;
  if (repo.visibility === "public") {
    for (const f of findings) if (f.live && f.tokenId) revoked += await revokeExposedToken(ctx, f.tokenId);
  }
  await audit.recordNote(ctx, { ...note, action: "Pushed past the secret scan", params: { reason: bypass, findings: findings.length, kinds, ...(revoked ? { revoked } : {}) }, status: 200 });
  return { bypassed: true, revoked };
}

/** A bypass reason as typed, or an error when it is empty after trimming. */
export function cleanReason(input: unknown): string | null {
  if (input === undefined || input === null || input === false) return null;
  const reason = String(input).trim().slice(0, 200);
  if (reason.length < 5) throw new ApiError(400, "bad_request", "Say why in a few words (at least 5 characters) to push past the secret scan.");
  return reason;
}
