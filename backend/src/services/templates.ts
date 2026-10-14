// Issue and pull request templates, kept in the repository itself so they are versioned and
// reviewed like everything else:
//
//   .craton-templates/issue/<anything>.md     one per kind of issue
//   .craton-templates/pull_request.md         the starting text of a new pull request
//
// (Not `.craton/`: that is the CLI's own local folder, which is never pushed.)
//
// An issue template may start with a small header (name, about, label); the rest is the text
// that fills the description. They are read from the default branch.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { BlobReader } from "./chunks.ts";
import { getObject, resolveRef } from "./history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { LABELS } from "./collab.ts";

export type IssueTemplate = { file: string; name: string; about: string; label: (typeof LABELS)[number] | null; body: string };

const DIR = ".craton-templates/issue/";
const PULL = ".craton-templates/pull_request.md";
const MAX_TEMPLATES = 10;
const MAX_BYTES = 16 * 1024;

/** `---\nkey: value\n---\nbody`; anything else is all body. Quotes around a value are dropped. */
export function parseTemplate(text: string): { meta: Record<string, string>; body: string } {
  const m = text.replace(/^﻿/, "").match(/^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^\s*([A-Za-z_-]+)\s*:\s*(.*?)\s*$/);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^(["'])(.*)\1$/, "$2");
  }
  return { meta, body: m[2] };
}

async function read(ctx: Ctx, repo: RepoRow, blobId: string) {
  const blob = getObject<BlobObject>(ctx, repo, blobId, "blob");
  return (await new BlobReader(ctx, blob).read(0, MAX_BYTES)).toString("utf8");
}

function defaultTree(ctx: Ctx, repo: RepoRow): TreeObject | null {
  let id: string;
  try {
    id = resolveRef(ctx, repo, repo.default_branch);
  } catch {
    return null; // an empty repository has no branch yet
  }
  return getObject<TreeObject>(ctx, repo, getObject<CommitObject>(ctx, repo, id, "commit").tree, "tree");
}

export async function issueTemplates(ctx: Ctx, repo: RepoRow): Promise<IssueTemplate[]> {
  const tree = defaultTree(ctx, repo);
  if (!tree) return [];
  const entries = tree.entries
    .filter((e) => e.path.startsWith(DIR) && /\.md$/i.test(e.path) && !e.path.slice(DIR.length).includes("/"))
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, MAX_TEMPLATES);
  const out: IssueTemplate[] = [];
  for (const e of entries) {
    const file = e.path.slice(DIR.length);
    const { meta, body } = parseTemplate(await read(ctx, repo, e.blob));
    const label = LABELS.find((l) => l === meta.label?.toLowerCase()) ?? null;
    out.push({ file, name: (meta.name || file.replace(/\.md$/i, "").replace(/[-_]+/g, " ")).slice(0, 80), about: (meta.about ?? "").slice(0, 200), label, body: body.replace(/^\r?\n/, "") });
  }
  return out;
}

export async function pullTemplate(ctx: Ctx, repo: RepoRow): Promise<string | null> {
  const tree = defaultTree(ctx, repo);
  const entry = tree?.entries.find((e) => e.path === PULL);
  return entry ? parseTemplate(await read(ctx, repo, entry.blob)).body : null;
}
