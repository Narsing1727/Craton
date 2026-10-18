// Code owners: who should look at a change to certain files. A `CODEOWNERS` file at the root of the branch a pull
// request targets lists a path pattern and one or more people on each line, the way GitHub's does:
//
//   # terrain and its processing belong to the survey team
//   terrain/**        @priyam @arjun
//   *.shp             @lakshmi
//   gauges.csv        @arjun
//
// The last matching line for a file wins. Patterns are the same as lock patterns (see core/globs.ts). The file is
// read from the *target* branch, so the author of a change cannot give their own files away.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { patternToRegExp } from "../core/globs.ts";
import { BlobReader } from "./chunks.ts";
import { compareRefs, getObject, resolveRef } from "./history.ts";
import { getPull, requestReview } from "./collab.ts";
import { repoAccess } from "./accounts.ts";

export const OWNERS_FILE = "CODEOWNERS";

export type OwnerRule = { pattern: string; owners: string[]; line: number };

export function parseOwners(text: string | null | undefined): OwnerRule[] {
  if (!text || text.length > 64 * 1024) return [];
  const rules: OwnerRule[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) return;
    const [pattern, ...rest] = line.split(/\s+/);
    const owners = [...new Set(rest.filter((t) => t.startsWith("@") && t.length > 1).map((t) => t.slice(1).toLowerCase()))];
    if (pattern && owners.length && rules.length < 500) rules.push({ pattern, owners, line: i + 1 });
  });
  return rules;
}

/** Owners of one path: the last matching rule's list (none when no rule matches). */
export function ownersOf(rules: OwnerRule[], path: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) if (patternToRegExp(rules[i].pattern).test(path)) return rules[i].owners;
  return [];
}

/** For a set of changed paths: each owner with the files they own. */
export function ownersForPaths(rules: OwnerRule[], paths: string[]): { handle: string; files: string[] }[] {
  const byOwner = new Map<string, string[]>();
  for (const p of paths) for (const h of ownersOf(rules, p)) (byOwner.get(h) ?? byOwner.set(h, []).get(h)!).push(p);
  return [...byOwner.entries()].map(([handle, files]) => ({ handle, files })).sort((a, b) => b.files.length - a.files.length || a.handle.localeCompare(b.handle));
}

/** The CODEOWNERS file at the tip of a branch, or null. */
export async function ownersFileAt(ctx: Ctx, repo: RepoRow, ref: string): Promise<string | null> {
  try {
    const commit = await getObject<CommitObject>(ctx, repo, await resolveRef(ctx, repo, ref), "commit");
    const tree = await getObject<TreeObject>(ctx, repo, commit.tree, "tree");
    const entry = tree.entries.find((e) => e.path === OWNERS_FILE);
    if (!entry || entry.size > 64 * 1024) return null;
    return (await new BlobReader(ctx, await getObject<BlobObject>(ctx, repo, entry.blob, "blob")).readAll()).toString("utf8");
  } catch {
    return null;
  }
}

export type PullOwner = {
  handle: string;
  files: string[];
  requested: boolean;
  state: "approved" | "changes_requested" | "commented" | null;
  /** False when the review was of an earlier version of the branch than its current tip. */
  current: boolean;
};

/** Who owns what a pull request changes, and where each owner stands. Names that aren't people here are skipped. */
export async function ownersOfPull(ctx: Ctx, repo: RepoRow, number: number): Promise<PullOwner[]> {
  const pull = await getPull(ctx, repo, number);
  const rules = parseOwners(await ownersFileAt(ctx, repo, pull.target));
  if (!rules.length) return [];
  const changed = (await compareRefs(ctx, repo, pull.target, pull.source)).changes.map((c) => c.path);
  const waiting = new Set(
    (await ctx.db.all("SELECT o.handle FROM review_requests r JOIN owners o ON o.id = r.user_id WHERE r.repo_id = ? AND r.number = ?", repo.id, number) as { handle: string }[]).map((r) => r.handle),
  );
  const latest = new Map<string, { state: PullOwner["state"]; commit: string }>();
  for (const r of (pull as { reviews?: { author: string; state: PullOwner["state"]; commit: string }[] }).reviews ?? []) latest.set(r.author, { state: r.state, commit: r.commit });
  const people = await ctx.db.all("SELECT handle FROM owners WHERE kind = 'user'") as { handle: string }[];
  const known = new Set(people.map((p) => p.handle));
  return ownersForPaths(rules, changed)
    .filter((o) => known.has(o.handle) && o.handle !== pull.author)
    .map((o) => {
      const review = latest.get(o.handle);
      return { ...o, files: o.files.slice(0, 20), requested: waiting.has(o.handle), state: review?.state ?? null, current: !review || review.commit === pull.head };
    });
}

/**
 * Ask the owners of the changed files to review a pull request that was just opened. A person who can't see the
 * repository or isn't a user is skipped rather than failing the pull request. Returns who was asked.
 */
export async function requestOwnerReviews(ctx: Ctx, repo: RepoRow, number: number, authorId: number): Promise<string[]> {
  const asked: string[] = [];
  let owners: PullOwner[] = [];
  try {
    owners = await ownersOfPull(ctx, repo, number);
  } catch {
    return asked;
  }
  for (const o of owners) {
    const row = await ctx.db.get("SELECT id FROM owners WHERE handle = ?", o.handle) as { id: number } | undefined;
    if (!row || await repoAccess(ctx, repo, row.id) === "none") continue;
    try {
      await requestReview(ctx, repo, number, authorId, o.handle);
      asked.push(o.handle);
    } catch {
      // Over the reviewer limit, or similar: the rest of the owners are still asked.
    }
  }
  return asked;
}

export type OwnersPreview = {
  rules: number;
  files: number;
  owned: number;
  unowned: number;
  /** Each person named, with how many files they own at the checked ref. */
  people: { handle: string; files: number; problem: string | null }[];
  /** A few files nobody owns, to help spot a missing rule. */
  unownedSample: string[];
  /** Lines that were not understood (no pattern, or no @name). */
  skipped: { line: number; text: string }[];
};

/**
 * What a CODEOWNERS text would do against the files at a ref: how many files each person would own, who isn't a
 * person here or can't see the repository, and which files nobody owns. Nothing is saved.
 */
export async function previewOwners(ctx: Ctx, repo: RepoRow, text: string, ref?: string): Promise<OwnersPreview> {
  const rules = parseOwners(text);
  const commit = await getObject<CommitObject>(ctx, repo, await resolveRef(ctx, repo, ref ?? repo.default_branch), "commit");
  const paths = (await getObject<TreeObject>(ctx, repo, commit.tree, "tree")).entries.map((e) => e.path).filter((p) => p !== OWNERS_FILE);
  const counts = new Map<string, number>();
  const unowned: string[] = [];
  for (const p of paths) {
    const o = ownersOf(rules, p);
    if (!o.length) unowned.push(p);
    for (const h of o) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const handles = new Set<string>(rules.flatMap((r) => r.owners));
  const people = (await Promise.all([...handles].map(async (handle) => {
    const row = await ctx.db.get("SELECT id, kind FROM owners WHERE handle = ?", handle) as { id: number; kind: string } | undefined;
    let problem: string | null = null;
    if (!row || row.kind !== "user") problem = "No person with this name";
    else if (await repoAccess(ctx, repo, row.id) === "none") problem = "Cannot see this repository";
    return { handle, files: counts.get(handle) ?? 0, problem };
  }))).sort((a, b) => b.files - a.files || a.handle.localeCompare(b.handle));
  const understood = new Set(rules.map((r) => r.line));
  const skipped: OwnersPreview["skipped"] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (line && !line.startsWith("#") && !understood.has(i + 1)) skipped.push({ line: i + 1, text: line.slice(0, 80) });
  });
  return { rules: rules.length, files: paths.length, owned: paths.length - unowned.length, unowned: unowned.length, people, unownedSample: unowned.slice(0, 5), skipped: skipped.slice(0, 10) };
}
