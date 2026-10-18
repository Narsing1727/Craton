// Saved filters for the issue and pull request lists: a name for a state, a label and a search, kept on the
// account so they follow a person from machine to machine. Private to the person; nothing is shared.

import type { Ctx } from "./context.ts";
import { badRequest, notFound } from "./context.ts";

export const FILTER_KINDS = ["issues", "pulls"] as const;
export type FilterKind = (typeof FILTER_KINDS)[number];
const MAX_PER_KIND = 20;

export type SavedFilter = { id: number; kind: FilterKind; name: string; state: string; label: string; q: string };

function kindOf(input: unknown): FilterKind {
  if (!FILTER_KINDS.includes(input as FilterKind)) throw badRequest("Say which list: issues or pulls.");
  return input as FilterKind;
}

export async function listFilters(ctx: Ctx, userId: number, kind: unknown): Promise<SavedFilter[]> {
  return await ctx.db.all("SELECT id, kind, name, state, label, q FROM saved_filters WHERE user_id = ? AND kind = ? ORDER BY name", userId, kindOf(kind)) as SavedFilter[];
}

/** Save (or replace, when the name already exists) a filter. */
export async function saveFilter(ctx: Ctx, userId: number, input: { kind?: unknown; name?: unknown; state?: unknown; label?: unknown; q?: unknown }): Promise<SavedFilter> {
  const kind = kindOf(input.kind);
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) throw badRequest("Give the filter a name of up to 60 characters.");
  const state = String(input.state ?? "").trim().slice(0, 30);
  const label = String(input.label ?? "").trim().slice(0, 60);
  const q = String(input.q ?? "").trim().slice(0, 300);
  if (!state && !label && !q) throw badRequest("There is nothing to save: choose a state, a label or type a search first.");
  const exists = await ctx.db.get("SELECT id FROM saved_filters WHERE user_id = ? AND kind = ? AND name = ?", userId, kind, name) as { id: number } | undefined;
  if (!exists) {
    const n = (await ctx.db.get("SELECT COUNT(*) AS n FROM saved_filters WHERE user_id = ? AND kind = ?", userId, kind) as { n: number }).n;
    if (n >= MAX_PER_KIND) throw badRequest(`You can keep ${MAX_PER_KIND} saved filters per list. Delete one first.`);
    const lastInsertRowid = await ctx.db.insert("INSERT INTO saved_filters (user_id, kind, name, state, label, q) VALUES (?, ?, ?, ?, ?, ?)", userId, kind, name, state, label, q);
    return { id: Number(lastInsertRowid), kind, name, state, label, q };
  }
  await ctx.db.run("UPDATE saved_filters SET state = ?, label = ?, q = ? WHERE id = ?", state, label, q, exists.id);
  return { id: exists.id, kind, name, state, label, q };
}

export async function deleteFilter(ctx: Ctx, userId: number, id: number) {
  const r = await ctx.db.run("DELETE FROM saved_filters WHERE id = ? AND user_id = ?", id, userId);
  if (r.changes === 0) throw notFound("Saved filter");
}
