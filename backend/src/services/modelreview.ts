// Model review: the quality-assurance record a hydraulic model needs before its results are relied on.
//
// Flood-modelling practice asks for the same four things everywhere (the TUFLOW manual's QA checklist and modelling
// log, FEMA's submission form, state reviewers' checklists): a checklist worked through item by item, a log of what
// was done and decided, an independent reviewer who signs off, and proof of exactly which files that sign-off covers.
// A review here is pinned to one commit and its Merkle root, so "approved" always means "these bytes".
//
// What the software can see for itself is captured as evidence (the validation gate's findings and each HEC-RAS plan's
// own account of its run) and offered as a suggestion next to the item it bears on. A person still decides every item.

import { statement } from "../db/db.ts";
import type { Ctx } from "./context.ts";
import { badRequest, conflict, forbidden, inTransaction, lockNumbering, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { getObject, resolveRef } from "./history.ts";
import { BlobReader } from "./chunks.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { listCheckRuns } from "../checks/runner.ts";
import { readHdf5 } from "../checks/hdf5.ts";
import { summarizeRun } from "../checks/hecras.ts";

export type ItemStatus = "todo" | "pass" | "fail" | "na";
export type ReviewStatus = "draft" | "in_review" | "changes_requested" | "approved";

export type TemplateItem = { key: string; group: string; text: string; hint: string; source: string };

/**
 * The default checklist. Wording follows the TUFLOW manual's QA checklist (file management, version control, cell
 * size, topography, cross-sections, bed resistance, calibration, mass conservation, structures, eddy viscosity) and
 * FEMA's hydrology and hydraulics form (software, model progression, deliverables), made software-neutral.
 */
export const TEMPLATE_ID = "flood-model-qa";
export const TEMPLATE: TemplateItem[] = [
  { key: "files.naming", group: "Files and version control", text: "File names and folders are logical, and inputs use relative paths.", hint: "Open the model folder; try the project on another machine or folder.", source: "TUFLOW QA" },
  { key: "files.version", group: "Files and version control", text: "A version naming scheme was set before modelling and input names show it, so old runs can be traced and reproduced.", hint: "Check plan and geometry names against the log.", source: "TUFLOW QA" },
  { key: "files.software", group: "Files and version control", text: "The software and its version are recorded, and acceptable to the body that will review the study.", hint: "See the log and the plan file's program version.", source: "FEMA H&H" },
  { key: "files.complete", group: "Files and version control", text: "Every file needed to re-run the model is in the repository (geometry, plans, flows, terrain, boundary data).", hint: "Clone fresh and run it.", source: "Practice" },
  { key: "terrain.datum", group: "Terrain and geometry", text: "Horizontal and vertical datums and units are stated and consistent across terrain, geometry and results.", hint: "Compare the CRS and datum rows of each file.", source: "TUFLOW QA" },
  { key: "terrain.dem", group: "Terrain and geometry", text: "The terrain used is the intended one; breaklines and any base-data modifications are documented.", hint: "Compare a terrain profile with the source survey.", source: "TUFLOW QA" },
  { key: "terrain.sections", group: "Terrain and geometry", text: "1D cross-section locations and spacing are appropriate; conveyance changes steadily downstream and sudden changes are explained.", hint: "Plot conveyance against station.", source: "TUFLOW QA" },
  { key: "terrain.controls", group: "Terrain and geometry", text: "Hydraulic controls (levees, roads, embankments) are represented.", hint: "Overlay structures on the mesh.", source: "TUFLOW QA" },
  { key: "mesh.cell", group: "Mesh and resolution", text: "The 2D cell size captures the topography the study objectives need.", hint: "Compare cell size with the smallest feature that matters.", source: "TUFLOW QA" },
  { key: "mesh.1d", group: "Mesh and resolution", text: "1D resolution captures the water-surface gradient.", hint: "Look for steps in the profile between sections.", source: "TUFLOW QA" },
  { key: "mesh.quality", group: "Mesh and resolution", text: "Mesh quality was checked: no sliver or oversized cells where results matter.", hint: "Map cell area and aspect ratio.", source: "Practice" },
  { key: "rough.n", group: "Roughness and losses", text: "Manning's n values are consistent with land cover or material and within accepted calibration ranges.", hint: "Map roughness; compare with the material table.", source: "TUFLOW QA" },
  { key: "rough.loss", group: "Roughness and losses", text: "Contraction, expansion and structure loss coefficients are reasonable.", hint: "List coefficients that differ from defaults.", source: "FEMA H&H" },
  { key: "rough.eddy", group: "Roughness and losses", text: "The eddy viscosity formulation and coefficient are appropriate (2D).", hint: "Check the plan's 2D computational options.", source: "TUFLOW QA" },
  { key: "bc.inflow", group: "Boundaries and flows", text: "Inflow hydrographs or flows come from the stated source, in the stated units.", hint: "Plot the input; compare peak and volume with the source.", source: "Practice" },
  { key: "bc.downstream", group: "Boundaries and flows", text: "The downstream boundary condition is justified and far enough away not to control the area of interest.", hint: "Rerun with a different boundary and compare.", source: "Practice" },
  { key: "bc.initial", group: "Boundaries and flows", text: "Initial conditions are appropriate and the model is warmed up where needed.", hint: "Check the first time steps for adjustment.", source: "Practice" },
  { key: "struct.losses", group: "Structures", text: "Hydraulic structure head losses were validated against recorded data, hand calculation or another model.", hint: "Attach the comparison to the log.", source: "TUFLOW QA" },
  { key: "struct.geometry", group: "Structures", text: "Structure geometry matches survey or drawings.", hint: "Compare dimensions with the as-built.", source: "Practice" },
  { key: "run.stable", group: "Run and results", text: "The run completed without instability and the computation warnings were reviewed.", hint: "Automated: each plan file's own solution status.", source: "FEMA H&H" },
  { key: "run.mass", group: "Run and results", text: "Mass balance: inflow against outflow, allowing for storage, is within the accepted error.", hint: "Check volume accounting; use flow lines at boundaries and key locations.", source: "TUFLOW QA" },
  { key: "run.error", group: "Run and results", text: "The maximum water-surface error is acceptable.", hint: "Automated: maximum WSEL error from each plan file.", source: "Practice" },
  { key: "run.results", group: "Run and results", text: "Results are plausible: depths, velocities, profiles and floodplain extents were reviewed.", hint: "Walk the profile and the maps; look for drawdowns and critical-depth artefacts.", source: "Practice" },
  { key: "cal.done", group: "Calibration and validation", text: "Calibration and validation are satisfactory for the study objectives.", hint: "State the events used and the fit.", source: "TUFLOW QA" },
  { key: "cal.limits", group: "Calibration and validation", text: "Limitations and uncertainties are written down for anyone interpreting the results.", hint: "Add them to the log.", source: "TUFLOW QA" },
  { key: "del.maps", group: "Deliverables", text: "Inundation and floodway extents are delivered in the format required.", hint: "Open the shapefiles or GeoPackage; check CRS and attributes.", source: "FEMA H&H" },
  { key: "del.log", group: "Deliverables", text: "The modelling log is complete: versions, observations, assumptions and data sources.", hint: "Read the log below as a reviewer would.", source: "TUFLOW QA" },
];
const ITEM_KEYS = new Set(TEMPLATE.map((t) => t.key));

type Row = {
  id: number;
  repo_id: number;
  number: number;
  title: string;
  template: string;
  status: ReviewStatus;
  ref: string;
  commit_id: string;
  merkle_root: string;
  evidence: string;
  created_by: number;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
};

export type Evidence = {
  capturedAt: string;
  commit: string;
  merkleRoot: string;
  files: { count: number; bytes: number };
  checks: { status: "passed" | "failed"; at: string; steps: { name: string; status: string; detail: string }[] } | null;
  runs: { path: string; solution: string | null; unstable: boolean; maxWselError: number | null; computeTotal: string | null; runWindow: string | null }[];
};

const handleOf = async (ctx: Ctx, id: number | null) => (id === null ? null : ((await ctx.db.get("SELECT handle FROM owners WHERE id = ?", id) as { handle: string } | undefined)?.handle ?? "ghost"));

const clean = (v: unknown, max: number, what: string) => {
  const s = String(v ?? "").replace(/\r\n/g, "\n").trim();
  if (s.length > max) throw badRequest(`Keep ${what} to ${max} characters.`);
  return s;
};

const find = async (ctx: Ctx, repo: RepoRow, n: number) => {
  const row = await ctx.db.get("SELECT * FROM model_reviews WHERE repo_id = ? AND number = ?", repo.id, n) as Row | undefined;
  if (!row) throw notFound("Model review");
  return row;
};

// ── Evidence ─────────────────────────────────────────────────────────────────

/** What the software can see about one commit: the gate's last run, and each HEC-RAS plan's own run summary. */
export async function captureEvidence(ctx: Ctx, repo: RepoRow, commitId: string): Promise<Evidence> {
  const commit = await getObject<CommitObject>(ctx, repo, commitId, "commit");
  const tree = await getObject<TreeObject>(ctx, repo, commit.tree, "tree");
  const run = (await listCheckRuns(ctx, repo, { commit: commitId, limit: 1 }))[0] ?? null;
  const runs: Evidence["runs"] = [];
  for (const e of tree.entries.filter((x) => /\.(hdf|h5|hdf5)$/i.test(x.path)).slice(0, 20)) {
    try {
      const reader = new BlobReader(ctx, await getObject<BlobObject>(ctx, repo, e.blob, "blob"));
      const summary = summarizeRun((await readHdf5((o, l) => reader.read(o, l), reader.size)).objects);
      if (summary) runs.push({ path: e.path, solution: summary.solution, unstable: summary.unstable, maxWselError: summary.maxWselError, computeTotal: summary.computeTotal, runWindow: summary.runWindow });
    } catch {
      // A file that cannot be read is already a finding of the gate; it simply contributes no run here.
    }
  }
  return {
    capturedAt: new Date().toISOString(),
    commit: commitId,
    merkleRoot: commit.merkleRoot,
    files: { count: tree.entries.length, bytes: tree.entries.reduce((n, x) => n + (x.size ?? 0), 0) },
    checks: run ? { status: run.status, at: run.createdAt, steps: run.steps.map((s) => ({ name: s.name, status: s.status, detail: s.detail })) } : null,
    runs,
  };
}

/** Suggestions drawn from evidence, for the items they bear on. They never change an item by themselves. */
export function suggestions(ev: Evidence): Record<string, { status: "pass" | "fail" | null; detail: string }> {
  const out: Record<string, { status: "pass" | "fail" | null; detail: string }> = {};
  if (ev.runs.length) {
    const bad = ev.runs.filter((r) => r.unstable);
    out["run.stable"] = bad.length
      ? { status: "fail", detail: `${bad.map((r) => `${r.path}: ${r.solution}`).join("; ")}` }
      : { status: "pass", detail: `${ev.runs.length} plan ${ev.runs.length === 1 ? "file reports" : "files report"} a completed solution (${[...new Set(ev.runs.map((r) => r.solution ?? "no status"))].join("; ")}).` };
    const errs = ev.runs.filter((r) => r.maxWselError !== null);
    if (errs.length) out["run.error"] = { status: null, detail: errs.map((r) => `${r.path}: max WSEL error ${r.maxWselError}`).join("; ") };
  }
  const step = (name: string) => ev.checks?.steps.find((s) => s.name === name);
  const crs = step("Coordinate reference system");
  const vertical = step("Vertical datum");
  if (crs || vertical) {
    const parts = [crs && `CRS: ${crs.status} (${crs.detail})`, vertical && `vertical datum: ${vertical.status} (${vertical.detail})`].filter(Boolean);
    const failed = [crs, vertical].some((s) => s && s.status === "failed");
    out["terrain.datum"] = { status: failed ? "fail" : [crs, vertical].every((s) => !s || s.status === "passed") ? "pass" : null, detail: parts.join("; ") };
  }
  const integrity = step("Chunk integrity");
  if (integrity) out["files.complete"] = { status: null, detail: `Integrity: ${integrity.status} (${integrity.detail})` };
  return out;
}

// ── Reading ──────────────────────────────────────────────────────────────────

export async function listReviews(ctx: Ctx, repo: RepoRow) {
  const rows = await ctx.db.all("SELECT * FROM model_reviews WHERE repo_id = ? ORDER BY number DESC", repo.id) as Row[];
  return (await Promise.all(rows.map(async (r) => {
    const counts = await countsOf(ctx, r.id);
    const last = await ctx.db.get("SELECT user_id, decision, created_at FROM model_review_signoffs WHERE review_id = ? ORDER BY id DESC LIMIT 1", r.id) as { user_id: number; decision: string; created_at: string } | undefined;
    return {
      number: r.number,
      title: r.title,
      status: r.status,
      ref: r.ref,
      commit: r.commit_id,
      createdBy: await handleOf(ctx, r.created_by),
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      counts,
      lastDecision: last ? { by: await handleOf(ctx, last.user_id), decision: last.decision, at: last.created_at } : null,
    };
  })));
}

async function countsOf(ctx: Ctx, reviewId: number) {
  const rows = await ctx.db.all("SELECT status, COUNT(*) AS n FROM model_review_items WHERE review_id = ? GROUP BY status", reviewId) as { status: ItemStatus; n: number }[];
  const c = { todo: 0, pass: 0, fail: 0, na: 0 };
  for (const r of rows) c[r.status] = r.n;
  return c;
}

export async function getReview(ctx: Ctx, repo: RepoRow, n: number) {
  const r = await find(ctx, repo, n);
  const stored = new Map(
    (await ctx.db.all("SELECT key, status, note, updated_by, updated_at FROM model_review_items WHERE review_id = ?", r.id) as { key: string; status: ItemStatus; note: string; updated_by: number | null; updated_at: string | null }[]).map((i) => [i.key, i]),
  );
  const evidence = JSON.parse(r.evidence) as Evidence;
  const hints = suggestions(evidence);
  const items = (await Promise.all(TEMPLATE.map(async (t) => {
    const s = stored.get(t.key);
    return { ...t, status: (s?.status ?? "todo") as ItemStatus, note: s?.note ?? "", updatedBy: await handleOf(ctx, s?.updated_by ?? null), updatedAt: s?.updated_at ?? null, suggestion: hints[t.key] ?? null };
  })));
  const log = (await Promise.all((await ctx.db.all("SELECT id, author_id, body, created_at FROM model_review_log WHERE review_id = ? ORDER BY id", r.id) as { id: number; author_id: number; body: string; created_at: string }[]).map(async (l) => ({
    id: l.id,
    author: await handleOf(ctx, l.author_id),
    body: l.body,
    at: l.created_at,
  }))));
  const signoffs = (await Promise.all((
    await ctx.db.all("SELECT id, user_id, decision, comment, independent, commit_id, created_at FROM model_review_signoffs WHERE review_id = ? ORDER BY id", r.id) as {
      id: number;
      user_id: number;
      decision: string;
      comment: string;
      independent: number;
      commit_id: string;
      created_at: string;
    }[]
  ).map(async (s) => ({ id: s.id, user: await handleOf(ctx, s.user_id), decision: s.decision, comment: s.comment, independent: Boolean(s.independent), commit: s.commit_id, at: s.created_at }))));
  return {
    number: r.number,
    title: r.title,
    template: r.template,
    status: r.status,
    ref: r.ref,
    commit: r.commit_id,
    merkleRoot: r.merkle_root,
    createdBy: await handleOf(ctx, r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    submittedAt: r.submitted_at,
    counts: await countsOf(ctx, r.id),
    items,
    log,
    signoffs,
    evidence,
  };
}

// ── Writing ──────────────────────────────────────────────────────────────────

export async function createReview(ctx: Ctx, repo: RepoRow, userId: number, input: { title?: string; ref?: string }) {
  const title = clean(input.title, 120, "the title");
  if (!title) throw badRequest("Give the review a title, for example “Chalakudy 2D model, 100-year design event”.");
  const ref = clean(input.ref || repo.default_branch || "main", 200, "the ref");
  const commitId = await resolveRef(ctx, repo, ref);
  const commit = await getObject<CommitObject>(ctx, repo, commitId, "commit");
  const evidence = await captureEvidence(ctx, repo, commitId);
  const reviewNumber = await inTransaction(ctx, async (c) => {
    await lockNumbering(c.db, repo.id);
    const number = ((await c.db.get("SELECT MAX(number) AS n FROM model_reviews WHERE repo_id = ?", repo.id) as { n: number | null }).n ?? 0) + 1;
    const info = await c.db.insert("INSERT INTO model_reviews (repo_id, number, title, template, ref, commit_id, merkle_root, evidence, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", repo.id, number, title, TEMPLATE_ID, ref, commitId, commit.merkleRoot, JSON.stringify(evidence), userId);
    const stmt = statement(c.db, "INSERT INTO model_review_items (review_id, key) VALUES (?, ?)");
    for (const t of TEMPLATE) await stmt.run(info, t.key);
    await c.db.run("INSERT INTO model_review_log (review_id, author_id, body) VALUES (?, ?, ?)", info, userId, `Review opened on ${ref} at ${commitId.slice(0, 12)} (Merkle root ${commit.merkleRoot.slice(0, 16)}…).`);
    return number;
  });
  return getReview(ctx, repo, reviewNumber);
}

const touch = async (ctx: Ctx, id: number) => await ctx.db.run("UPDATE model_reviews SET updated_at = now_iso() WHERE id = ?", id);

function mustBeEditable(r: Row) {
  if (r.status === "approved") throw conflict("approved", "This review is approved and locked. Reopen it to change an item.");
}

export async function setItem(ctx: Ctx, repo: RepoRow, n: number, userId: number, key: string, input: { status?: string; note?: string }) {
  const r = await find(ctx, repo, n);
  mustBeEditable(r);
  if (!ITEM_KEYS.has(key)) throw notFound("Checklist item");
  const current = await ctx.db.get("SELECT status, note FROM model_review_items WHERE review_id = ? AND key = ?", r.id, key) as { status: ItemStatus; note: string };
  const status = (input.status ?? current.status) as ItemStatus;
  if (!["todo", "pass", "fail", "na"].includes(status)) throw badRequest("Status must be todo, pass, fail or na.");
  const note = input.note !== undefined ? clean(input.note, 2000, "a note") : current.note;
  await ctx.db.run("UPDATE model_review_items SET status = ?, note = ?, updated_by = ?, updated_at = now_iso() WHERE review_id = ? AND key = ?", status, note, userId, r.id, key);
  await touch(ctx, r.id);
  return getReview(ctx, repo, n);
}

export async function addLog(ctx: Ctx, repo: RepoRow, n: number, userId: number, bodyInput: unknown) {
  const r = await find(ctx, repo, n);
  const body = clean(bodyInput, 4000, "a log entry");
  if (!body) throw badRequest("Write what was done or decided.");
  // The log is append-only on purpose: it is the record of how the model was built, and it stays open after approval
  // so later observations can be added without unlocking the checklist.
  await ctx.db.run("INSERT INTO model_review_log (review_id, author_id, body) VALUES (?, ?, ?)", r.id, userId, body);
  await touch(ctx, r.id);
  return getReview(ctx, repo, n);
}

/** Capture the findings again, optionally re-pinning the review to another ref. Not possible once approved. */
export async function refreshEvidence(ctx: Ctx, repo: RepoRow, n: number, userId: number, input: { ref?: string }) {
  const r = await find(ctx, repo, n);
  mustBeEditable(r);
  const ref = input.ref ? clean(input.ref, 200, "the ref") : r.ref;
  const commitId = await resolveRef(ctx, repo, ref);
  const commit = await getObject<CommitObject>(ctx, repo, commitId, "commit");
  const evidence = await captureEvidence(ctx, repo, commitId);
  await ctx.db.run("UPDATE model_reviews SET ref = ?, commit_id = ?, merkle_root = ?, evidence = ? WHERE id = ?", ref, commitId, commit.merkleRoot, JSON.stringify(evidence), r.id);
  const moved = commitId !== r.commit_id;
  await ctx.db.run("INSERT INTO model_review_log (review_id, author_id, body) VALUES (?, ?, ?)", r.id, userId, moved ? `Evidence refreshed and review re-pinned to ${ref} at ${commitId.slice(0, 12)} (Merkle root ${commit.merkleRoot.slice(0, 16)}…).` : `Evidence refreshed at ${commitId.slice(0, 12)}.`);
  await touch(ctx, r.id);
  return getReview(ctx, repo, n);
}

export async function submit(ctx: Ctx, repo: RepoRow, n: number, userId: number) {
  const r = await find(ctx, repo, n);
  if (r.status !== "draft" && r.status !== "changes_requested") throw conflict("state", `A review that is ${r.status.replace("_", " ")} cannot be submitted.`);
  await ctx.db.run("UPDATE model_reviews SET status = 'in_review', submitted_at = now_iso() WHERE id = ?", r.id);
  await ctx.db.run("INSERT INTO model_review_log (review_id, author_id, body) VALUES (?, ?, ?)", r.id, userId, "Submitted for review.");
  await touch(ctx, r.id);
  return getReview(ctx, repo, n);
}

export async function decide(ctx: Ctx, repo: RepoRow, n: number, userId: number, input: { decision?: string; comment?: string }) {
  const r = await find(ctx, repo, n);
  if (r.status !== "in_review") throw conflict("state", "Only a review that has been submitted can be decided.");
  const decision = input.decision;
  if (decision !== "approve" && decision !== "request_changes") throw badRequest("Decision must be approve or request_changes.");
  const comment = clean(input.comment, 1000, "a comment");
  if (decision === "request_changes" && !comment) throw badRequest("Say what has to change.");
  if (decision === "approve") {
    const items = await ctx.db.all("SELECT key, status, note FROM model_review_items WHERE review_id = ?", r.id) as { key: string; status: ItemStatus; note: string }[];
    const open = items.filter((i) => i.status === "todo");
    if (open.length) throw conflict("incomplete", `${open.length} checklist ${open.length === 1 ? "item is" : "items are"} still to do. Mark each pass, fail or not applicable first.`, { open: open.map((i) => i.key) });
    const bare = items.filter((i) => i.status === "fail" && i.note.trim().length < 3);
    if (bare.length) throw conflict("unexplained", `${bare.length} failed ${bare.length === 1 ? "item has" : "items have"} no note. Say what was found and why it is accepted.`, { items: bare.map((i) => i.key) });
  }
  // Independence is recorded, not required: a one-person team can still finish a review, and the record says so.
  const independent = userId !== r.created_by;
  await ctx.db.run("INSERT INTO model_review_signoffs (review_id, user_id, decision, comment, independent, commit_id) VALUES (?, ?, ?, ?, ?, ?)", r.id, userId, decision, comment, independent ? 1 : 0, r.commit_id);
  await ctx.db.run("UPDATE model_reviews SET status = ? WHERE id = ?", decision === "approve" ? "approved" : "changes_requested", r.id);
  await ctx.db.run("INSERT INTO model_review_log (review_id, author_id, body) VALUES (?, ?, ?)", r.id, userId, decision === "approve" ? `Approved${independent ? "" : " (not independent: the author signed off their own review)"}.${comment ? ` ${comment}` : ""}` : `Changes requested: ${comment}`);
  await touch(ctx, r.id);
  return getReview(ctx, repo, n);
}

export async function reopen(ctx: Ctx, repo: RepoRow, n: number, userId: number, reason: unknown) {
  const r = await find(ctx, repo, n);
  if (r.status !== "approved") throw conflict("state", "Only an approved review can be reopened.");
  const why = clean(reason, 500, "the reason");
  if (!why) throw badRequest("Say why the approved review is being reopened.");
  await ctx.db.run("UPDATE model_reviews SET status = 'draft' WHERE id = ?", r.id);
  await ctx.db.run("INSERT INTO model_review_log (review_id, author_id, body) VALUES (?, ?, ?)", r.id, userId, `Reopened: ${why}`);
  await touch(ctx, r.id);
  return getReview(ctx, repo, n);
}

export async function deleteReview(ctx: Ctx, repo: RepoRow, n: number) {
  const r = await find(ctx, repo, n);
  if (r.status === "approved") throw forbidden("An approved review is a record and cannot be deleted. Reopen it first.");
  await ctx.db.run("DELETE FROM model_reviews WHERE id = ?", r.id);
}

// ── Export ───────────────────────────────────────────────────────────────────

const ICON: Record<ItemStatus, string> = { pass: "PASS", fail: "FAIL", na: "N/A", todo: "TO DO" };
const STATUS_TEXT: Record<ReviewStatus, string> = { draft: "Draft", in_review: "In review", changes_requested: "Changes requested", approved: "Approved" };

/** A document to attach to a submission: pinned commit, evidence, checklist, log and sign-offs. */
export async function exportMarkdown(ctx: Ctx, repo: RepoRow, n: number): Promise<string> {
  const r = await getReview(ctx, repo, n);
  const lines: string[] = [];
  const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n+/g, " ");
  lines.push(`# Model review ${r.number}: ${r.title}`, "");
  lines.push(`- Repository: ${repo.owner}/${repo.name}`);
  lines.push(`- Status: **${STATUS_TEXT[r.status]}**`);
  lines.push(`- Ref: \`${r.ref}\``);
  lines.push(`- Commit: \`${r.commit}\``);
  lines.push(`- Merkle root: \`${r.merkleRoot}\``);
  lines.push(`- Opened by @${r.createdBy} on ${r.createdAt.slice(0, 10)}`);
  const approval = await [...r.signoffs].reverse().find((s) => s.decision === "approve");
  if (r.status === "approved" && approval) lines.push(`- Approved by @${approval.user} on ${approval.at.slice(0, 10)} (${approval.independent ? "independent review" : "NOT independent: signed off by the author"})`);
  lines.push(`- Checklist: ${r.counts.pass} pass, ${r.counts.fail} fail, ${r.counts.na} not applicable, ${r.counts.todo} to do`, "");
  lines.push("The Merkle root identifies exactly which files this review covers. Any change to any file changes it.", "");

  lines.push("## Automated findings at capture", "");
  lines.push(`Captured ${r.evidence.capturedAt.slice(0, 19).replace("T", " ")} UTC · ${r.evidence.files.count} files · ${r.evidence.files.bytes.toLocaleString("en-US")} bytes`, "");
  if (r.evidence.checks) {
    lines.push(`Validation gate: **${r.evidence.checks.status}**`, "", "| Step | Result | Detail |", "|---|---|---|");
    for (const s of r.evidence.checks.steps) lines.push(`| ${cell(s.name)} | ${s.status} | ${cell(s.detail)} |`);
    lines.push("");
  } else lines.push("No validation gate run is recorded for this commit.", "");
  if (r.evidence.runs.length) {
    lines.push("HEC-RAS plan results", "", "| File | Solution | Max WSEL error | Computation time |", "|---|---|---|---|");
    for (const run of r.evidence.runs) lines.push(`| ${cell(run.path)} | ${cell(run.solution ?? "not recorded")} | ${run.maxWselError ?? "n/a"} | ${cell(run.computeTotal ?? "n/a")} |`);
    lines.push("");
  }

  lines.push("## Checklist", "");
  let group = "";
  for (const i of r.items) {
    if (i.group !== group) {
      group = i.group;
      lines.push(`### ${group}`, "", "| Result | Item | Note |", "|---|---|---|");
    }
    lines.push(`| ${ICON[i.status]} | ${cell(i.text)} | ${cell(i.note || (i.suggestion ? `(automated: ${i.suggestion.detail})` : ""))} |`);
  }
  lines.push("");

  lines.push("## Modelling log", "");
  for (const l of r.log) lines.push(`- ${l.at.slice(0, 16).replace("T", " ")} UTC, @${l.author}: ${l.body.replace(/\n+/g, " ")}`);
  lines.push("");

  lines.push("## Sign-off", "");
  if (!r.signoffs.length) lines.push("No decision has been recorded.");
  for (const s of r.signoffs) lines.push(`- ${s.at.slice(0, 16).replace("T", " ")} UTC, @${s.user}: **${s.decision === "approve" ? "approved" : "changes requested"}**${s.independent ? "" : " (the author)"}${s.comment ? `, ${s.comment}` : ""}`);
  lines.push("", "---", "Generated by Craton. Checklist wording follows the TUFLOW manual's QA checklist and FEMA's hydrology and hydraulics form; it is a working aid, not a regulatory template.");
  return lines.join("\n") + "\n";
}
