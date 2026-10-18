// A line diff between two versions of a text file: a HEC-RAS plan or geometry file, an SWMM .inp, a README, a
// JSON or YAML config. What a person wants from it is "which Manning's n changed", so it is a plain unified diff
// with a few lines of context, computed on lines with Myers' O(ND) algorithm after trimming what both share.

import { describeStructured } from "./describe.ts";
import type { Ctx } from "./context.ts";
import { ApiError, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { BlobReader } from "./chunks.ts";
import { getObject, resolveRef } from "./history.ts";

export type DiffLine = { t: " " | "+" | "-"; text: string };
export type Hunk = { oldStart: number; newStart: number; oldLines: number; newLines: number; lines: DiffLine[] };
export type TextDiff = {
  path: string;
  base: string;
  head: string;
  added: number;
  removed: number;
  hunks: Hunk[];
  /** True when the file was too different (or too long) to diff line by line; hunks then hold one replacement. */
  replaced: boolean;
  /** True when more hunks existed than are returned. */
  truncated: boolean;
};

const MAX_BYTES = 1024 * 1024;
const MAX_LINES = 20_000;
const MAX_EDITS = 2000;
const CONTEXT = 3;
const MAX_HUNKS = 200;

/** Lines of a text file, or null when it is not text (a NUL byte, or not valid UTF-8). */
export function linesOf(buf: Buffer): string[] | null {
  if (buf.includes(0)) return null;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
  if (text === "") return [];
  const lines = text.replace(/^﻿/, "").split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Myers' shortest edit script between two line arrays, as a list of ops. Null when it needs more than MAX_EDITS. */
function myers(a: string[], b: string[]): { t: " " | "+" | "-"; text: string }[] | null {
  const n = a.length, m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])) x = v[off + k + 1];
      else x = v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        // Walk back through the trace to build the script.
        const ops: { t: " " | "+" | "-"; text: string }[] = [];
        let cx = n, cy = m;
        for (let dd = d; dd > 0; dd--) {
          const vv = trace[dd];
          const kk = cx - cy;
          let prevK: number;
          if (kk === -dd || (kk !== dd && vv[off + kk - 1] < vv[off + kk + 1])) prevK = kk + 1;
          else prevK = kk - 1;
          const prevX = vv[off + prevK];
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) {
            ops.push({ t: " ", text: a[cx - 1] });
            cx--;
            cy--;
          }
          if (cx === prevX) ops.push({ t: "+", text: b[cy - 1] });
          else ops.push({ t: "-", text: a[cx - 1] });
          cx = prevX;
          cy = prevY;
        }
        while (cx > 0 && cy > 0) {
          ops.push({ t: " ", text: a[cx - 1] });
          cx--;
          cy--;
        }
        return ops.reverse();
      }
    }
  }
  return null;
}

/** The diff of two line arrays as unified hunks. */
export function diffLines(oldLines: string[], newLines: string[]): { hunks: Hunk[]; added: number; removed: number; replaced: boolean; truncated: boolean } {
  // What both versions share at either end costs nothing to skip.
  let head = 0;
  while (head < oldLines.length && head < newLines.length && oldLines[head] === newLines[head]) head++;
  let tail = 0;
  while (tail < oldLines.length - head && tail < newLines.length - head && oldLines[oldLines.length - 1 - tail] === newLines[newLines.length - 1 - tail]) tail++;
  const a = oldLines.slice(head, oldLines.length - tail);
  const b = newLines.slice(head, newLines.length - tail);

  let middle = a.length + b.length === 0 ? [] : myers(a, b);
  let replaced = false;
  if (middle === null) {
    replaced = true;
    middle = [...a.map((text) => ({ t: "-" as const, text })), ...b.map((text) => ({ t: "+" as const, text }))];
  }
  const ops: DiffLine[] = [
    ...oldLines.slice(0, head).map((text) => ({ t: " " as const, text })),
    ...middle,
    ...oldLines.slice(oldLines.length - tail).map((text) => ({ t: " " as const, text })),
  ];

  let added = 0, removed = 0;
  for (const o of ops) {
    if (o.t === "+") added++;
    else if (o.t === "-") removed++;
  }
  // Group changes with CONTEXT lines around them; changes closer than twice that share a hunk.
  const hunks: Hunk[] = [];
  let i = 0, oldNo = 1, newNo = 1;
  const positions: { oldNo: number; newNo: number }[] = ops.map(() => ({ oldNo: 0, newNo: 0 }));
  for (let k = 0; k < ops.length; k++) {
    positions[k] = { oldNo, newNo };
    if (ops[k].t !== "+") oldNo++;
    if (ops[k].t !== "-") newNo++;
  }
  let truncated = false;
  while (i < ops.length) {
    while (i < ops.length && ops[i].t === " ") i++;
    if (i >= ops.length) break;
    if (hunks.length >= MAX_HUNKS) {
      truncated = true;
      break;
    }
    const start = Math.max(0, i - CONTEXT);
    let end = i, lastChange = i;
    while (end < ops.length && end - lastChange <= 2 * CONTEXT) {
      if (ops[end].t !== " ") lastChange = end;
      end++;
    }
    end = Math.min(ops.length, lastChange + CONTEXT + 1);
    const lines = ops.slice(start, end);
    hunks.push({
      oldStart: positions[start].oldNo,
      newStart: positions[start].newNo,
      oldLines: lines.filter((l) => l.t !== "+").length,
      newLines: lines.filter((l) => l.t !== "-").length,
      lines,
    });
    i = end;
  }
  return { hunks, added, removed, replaced, truncated };
}

async function textAt(ctx: Ctx, repo: RepoRow, ref: string, path: string): Promise<{ lines: string[] | null; size: number } | null> {
  const commit = getObject<CommitObject>(ctx, repo, resolveRef(ctx, repo, ref), "commit");
  const entry = getObject<TreeObject>(ctx, repo, commit.tree, "tree").entries.find((e) => e.path === path);
  if (!entry) return null;
  // A point cloud or NetCDF grid is compared by what its header says (any size: only the header is read).
  const described = await describeStructured(ctx, repo, entry.blob, path);
  if (described) return { lines: described, size: entry.size };
  if (entry.size > MAX_BYTES) return { lines: null, size: entry.size };
  const buf = await new BlobReader(ctx, getObject<BlobObject>(ctx, repo, entry.blob, "blob")).readAll();
  return { lines: linesOf(buf), size: entry.size };
}

export async function textDiff(ctx: Ctx, repo: RepoRow, base: string, head: string, path: string): Promise<TextDiff> {
  const [before, after] = await Promise.all([textAt(ctx, repo, base, path), textAt(ctx, repo, head, path)]);
  if (!after) throw notFound(`File ${path} at ${head}`);
  const notText = (r: { lines: string[] | null; size: number } | null) => r !== null && r.lines === null;
  if (notText(before) || notText(after)) {
    throw new ApiError(415, "not_text", before && before.size > MAX_BYTES || after.size > MAX_BYTES ? "That file is over 1 MB, which is too large to compare line by line." : "That file is not text, so there is no line diff.");
  }
  const oldLines = before?.lines ?? [];
  const newLines = after.lines!;
  if (oldLines.length > MAX_LINES || newLines.length > MAX_LINES) throw new ApiError(415, "not_text", `Files over ${MAX_LINES.toLocaleString("en-US")} lines are not compared line by line.`);
  const d = diffLines(oldLines, newLines);
  return { path, base, head, ...d };
}
