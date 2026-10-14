#!/usr/bin/env node
// craton: version control for geospatial data. Run `craton help` for commands.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { BlobObject, CommitObject, TreeEntry, TreeObject } from "../core/objects.ts";
import { diffTrees, makeCommit, makeTree, objectId, shortId, treeMerkleRoot } from "../core/objects.ts";
import { sha256Hex } from "../core/fastcdc.ts";
import { dataTypeOf } from "../core/datatypes.ts";
import { parseCsv, sniffDelimiter } from "../core/csv.ts";
import { fitByGroup, fitStatistics, numericColumn, rateNse, type Fit } from "../core/fit.ts";
import { CliError, LocalRepo, handleFor, inSparse, normaliseSparse, parseRemote, saveToken, tokenFor } from "./local.ts";
import { chunkFile, formatBytes, hintForFile, ignoreRules, readChunkFromFile, walk } from "./files.ts";
import { PendingChunks } from "./pending.ts";
import { Remote, networkReason, unreachableMessage } from "./remote.ts";
import { compressChunk, decompressChunk, type Hint } from "../core/compress.ts";
import { commandDoc, completionScript, detailText, listText, SHELLS, type Shell } from "./commands.ts";
import { applyLocks, listLocksCommand, lockCommand, releaseReadOnly, repoPathOf, unlockCommand, whoAmI, type RemoteLock } from "./locks.ts";

// ── Argument helpers ────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
// `craton --help`, `craton <command> --help` and `-h` all print help instead of running anything.
const wantsHelp = argv.some((a) => a === "--help" || a === "-h");
const cmd = wantsHelp ? "help" : (argv[0] ?? "help");
const rest = argv.slice(1);
const opt = (name: string, short?: string) => {
  const i = rest.findIndex((a) => a === `--${name}` || (short && a === `-${short}`));
  if (i === -1) return undefined;
  const v = rest[i + 1];
  rest.splice(i, 2);
  return v;
};
const flag = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  if (i === -1) return false;
  rest.splice(i, 1);
  return true;
};
const out = (s = ""): void => {
  process.stdout.write(s + "\n");
};

function remoteFor(repo: LocalRepo): Remote {
  const url = repo.config().remote;
  if (!url) throw new CliError("No remote. Add one: craton remote add origin http://localhost:4000/owner/repo");
  const r = parseRemote(url);
  return new Remote(r.server, r.owner, r.name, tokenFor(r.server));
}

function headTree(repo: LocalRepo): TreeObject | null {
  const tip = repo.ref(repo.head());
  return tip ? repo.tree(repo.commit(tip).tree) : null;
}

// ── Checkout: write a tree to the working directory ─────────────────────────

/**
 * Make the working files match `target`, touching only paths that differ from `current`.
 * Chunks come from existing working files when possible and from the server otherwise,
 * so switching between branches downloads only what actually changed.
 */
async function checkout(repo: LocalRepo, current: TreeObject | null, target: TreeObject, remote: Remote | null) {
  const index = repo.index();
  const local = new Map<string, { abs: string; offset: number; length: number }>();
  for (const [p, e] of Object.entries(index.entries)) {
    if (e.absent || !repo.hasObject(e.blob)) continue;
    let offset = 0;
    for (const c of repo.blob(e.blob).chunks) {
      if (!local.has(c.hash)) local.set(c.hash, { abs: repo.abs(p), offset, length: c.size });
      offset += c.size;
    }
  }
  const pending = new PendingChunks(repo.dir);
  // Chunks already downloaded by an earlier run that didn't finish: a retry picks up where it stopped.
  const fetched = new PendingChunks(repo.dir, "fetched");
  // For tests: lose the connection after this many chunk downloads.
  const failAfter = Number(process.env.CRATON_FAIL_AFTER_CHUNKS ?? 0);
  let fromNetwork = 0;
  const MAX_CHUNK_BYTES = 512 * 1024 + 64;
  /** Bytes that actually crossed the network for chunks in this run (encoded size), as opposed to the chunks' own size. */
  let wireBytes = 0;
  // The chunks this checkout will need from the server, in the order it will ask for them, so a miss can fetch the next
  // few hundred with it. A server without the batch route answers 404 and everything goes one by one.
  let batching = Boolean(remote);
  /** Chunks that came over the network in this run (so "downloaded" counts them even though they now sit in the cache). */
  const viaNetwork = new Set<string>();
  const wanted: string[] = [];
  const wantedAt = new Map<string, number>();
  if (remote) {
    const sparseNow = repo.config().sparse;
    for (const ch of diffTrees(current, target)) {
      if (ch.change === "removed" || !inSparse(sparseNow, ch.path)) continue;
      const entry = target.entries.find((e) => e.path === ch.path);
      if (!entry || !repo.hasObject(entry.blob)) continue;
      for (const c of repo.blob(entry.blob).chunks) {
        if (!local.has(c.hash) && !wantedAt.has(c.hash)) {
          wantedAt.set(c.hash, wanted.length);
          wanted.push(c.hash);
        }
      }
    }
  }
  const fetchChunk = async (hash: string): Promise<Buffer> => {
    const src = local.get(hash);
    if (src) {
      try {
        return await readChunkFromFile(src.abs, src.offset, src.length, hash);
      } catch {}
    }
    const p = pending.get(hash) ?? fetched.get(hash);
    if (p) return p;
    if (!remote) throw new CliError(`Chunk ${hash.slice(0, 12)} isn’t available locally and there’s no remote.`);
    if (failAfter > 0 && fromNetwork >= failAfter) throw new CliError("The connection was lost. Run the command again to resume.");
    if (batching && failAfter === 0 && wantedAt.has(hash)) {
      // A run of the chunks this checkout will need next, in one request; the first is the one wanted now.
      const start = wantedAt.get(hash)!;
      const batch: string[] = [];
      for (let i = start; i < wanted.length && batch.length < 200; i++) {
        const h = wanted[i];
        if (!local.has(h) && !pending.has(h) && !fetched.has(h)) batch.push(h);
      }
      try {
        const frames = await remote.request<Buffer>("POST", "/chunks/fetch", { hashes: batch });
        for (let at = 0; at + 69 <= frames.length; ) {
          const h = frames.subarray(at, at + 64).toString("latin1");
          const length = frames.readUInt32BE(at + 64);
          const encoding = frames[at + 68];
          const payload = frames.subarray(at + 69, at + 69 + length);
          at += 69 + length;
          let bytes: Buffer | null = null;
          try {
            // Each chunk arrives in its stored encoding; it only counts once it decodes to the bytes its hash names.
            if (payload.length === length && batch.includes(h)) bytes = decompressChunk(Buffer.concat([Buffer.from([encoding]), payload]), MAX_CHUNK_BYTES);
          } catch {}
          if (!bytes || sha256Hex(bytes) !== h) throw new CliError(`Chunk ${h.slice(0, 12)} from the server failed verification.`);
          fromNetwork++;
          viaNetwork.add(h);
          wireBytes += length + 1;
          fetched.put(h, bytes);
        }
        const got = fetched.get(hash);
        if (got) return got;
      } catch (err) {
        if ((err as { status?: number }).status !== 404) throw err;
        batching = false;
      }
    }
    const data = await remote.request<Buffer>("GET", `/chunks/${hash}`);
    if (sha256Hex(data) !== hash) throw new CliError(`Chunk ${hash.slice(0, 12)} from the server failed verification.`);
    fromNetwork++;
    viaNetwork.add(hash);
    wireBytes += data.length;
    fetched.put(hash, data);
    return data;
  };

  const sparse = repo.config().sparse;
  const changes = diffTrees(current, target);
  // Files outside the sparse set are recorded in the index but never written.
  const outside = new Map<string, TreeEntry>();
  // Build new files into temp files first, so a failed download never leaves a half-written file.
  const staged: { rel: string; tmp: string; entry: TreeEntry }[] = [];
  let currentTmp: string | null = null;
  try {
    for (const ch of changes) {
      if (ch.change === "removed") continue;
      const entry = target.entries.find((e) => e.path === ch.path)!;
      if (!inSparse(sparse, ch.path)) {
        outside.set(ch.path, entry);
        if (!repo.hasObject(entry.blob) && remote) repo.putObject(await remote.request<BlobObject>("GET", `/objects/${entry.blob}`));
        continue;
      }
      let blob: BlobObject;
      if (repo.hasObject(entry.blob)) blob = repo.blob(entry.blob);
      else if (remote) {
        blob = await remote.request<BlobObject>("GET", `/objects/${entry.blob}`);
        repo.putObject(blob);
      } else throw new CliError(`Blob for ${ch.path} is missing.`);
      const tmp = `${repo.abs(ch.path)}.craton-${process.pid}.tmp`;
      currentTmp = tmp;
      await fsp.mkdir(path.dirname(tmp), { recursive: true });
      const fh = await fsp.open(tmp, "w");
      const whole = createHash("sha256");
      try {
        for (const c of blob.chunks) {
          const data = await fetchChunk(c.hash);
          whole.update(data);
          await fh.write(data);
        }
      } finally {
        await fh.close();
      }
      if (whole.digest("hex") !== blob.sha256) throw new CliError(`${ch.path} failed its SHA-256 check after download.`);
      staged.push({ rel: ch.path, tmp, entry });
    }
  } catch (err) {
    // A failed run leaves no half-written files; the downloaded chunks stay cached for the retry.
    await Promise.all([...staged.map((x) => x.tmp), ...(currentTmp ? [currentTmp] : [])].map((f) => fsp.rm(f, { force: true })));
    throw err;
  }
  for (const s of staged) {
    await fsp.rename(s.tmp, repo.abs(s.rel));
    const st = await fsp.stat(repo.abs(s.rel));
    index.entries[s.rel] = { size: st.size, mtimeMs: st.mtimeMs, blob: s.entry.blob };
  }
  for (const ch of changes) {
    if (ch.change !== "removed") continue;
    await fsp.rm(repo.abs(ch.path), { force: true });
    delete index.entries[ch.path];
  }
  for (const [p, e] of outside) index.entries[p] = { size: e.size, mtimeMs: 0, blob: e.blob, absent: true };
  repo.writeIndex(index);
  fetched.clear();
  // What crossed the network in this run: the encoded size of the batched chunks plus the single downloads.
  return { changed: changes.length - outside.size, downloaded: wireBytes };
}

/** Local changes that would be lost by overwriting the working tree. */
function dirtyPaths(repo: LocalRepo): string[] {
  const index = repo.index();
  const tree = headTree(repo);
  const committed = new Map((tree?.entries ?? []).map((e) => [e.path, e.blob]));
  const dirty: string[] = [];
  for (const [p, e] of Object.entries(index.entries)) {
    if (committed.get(p) !== e.blob) dirty.push(p);
    else if (e.absent && !fs.existsSync(repo.abs(p))) continue;
    else {
      try {
        const st = fs.statSync(repo.abs(p));
        if (st.size !== e.size || st.mtimeMs !== e.mtimeMs) dirty.push(p);
      } catch {
        dirty.push(p);
      }
    }
  }
  for (const p of committed.keys()) if (!index.entries[p]) dirty.push(p);
  return dirty;
}

// ── Commands ────────────────────────────────────────────────────────────────

async function cmdInit() {
  const remote = opt("remote");
  const branch = opt("branch") ?? "main";
  const dir = path.resolve(rest[0] ?? ".");
  fs.mkdirSync(dir, { recursive: true });
  LocalRepo.init(dir, { remote: remote ?? null, branch });
  out(`Initialized an empty Craton repository in ${path.join(dir, ".craton")}`);
  if (!remote) out("Next: craton remote add origin http://localhost:4000/<owner>/<repo>");
}

async function cmdRemote() {
  const repo = LocalRepo.find();
  if (rest[0] === "add") {
    const url = rest[2] ?? rest[1];
    parseRemote(url);
    repo.writeConfig({ ...repo.config(), remote: url });
    out(`origin → ${url}`);
  } else out(repo.config().remote ?? "(no remote)");
}

async function cmdAuth() {
  if (rest[0] !== "login") {
    out("Usage: craton auth login --token <token> [--server http://localhost:4000]");
    return;
  }
  rest.shift();
  const token = opt("token") ?? process.env.CRATON_TOKEN;
  const server = (opt("server") ?? "http://localhost:4000").replace(/\/+$/, "");
  if (!token) throw new CliError("Pass --token. Create one in Settings → Personal access tokens.");
  const res = await fetch(`${server}/v1/user`, { headers: { authorization: `Bearer ${token}` } }).catch((err) => {
    throw new CliError(unreachableMessage(server, err));
  });
  if (!res.ok) throw new CliError("That token wasn’t accepted.");
  const user = (await res.json()) as { handle: string };
  saveToken(server, token, user.handle);
  out(`Signed in to ${server} as ${user.handle}.`);
}

async function cmdAdd() {
  const repo = LocalRepo.find();
  const targets = rest.length ? rest : ["."];
  const rules = ignoreRules(repo.root);
  const index = repo.index();
  const pending = new PendingChunks(repo.dir, "pending", { packed: true });
  let changed = 0, bytes = 0, chunkCount = 0;
  const seen = new Set<string>();
  for (const t of targets) {
    const abs = path.resolve(t);
    if (!fs.existsSync(abs)) {
      // A deleted file or folder: stage the removal.
      const rel = repo.rel(abs);
      for (const p of Object.keys(index.entries)) if ((p === rel || p.startsWith(`${rel}/`)) && !index.entries[p].absent) delete index.entries[p];
      continue;
    }
    const files = walk(repo.root, abs, rules);
    // Files whose size and modification time still match the index are skipped; the rest are read a few at a
    // time (a folder of thousands of small files is dominated by per-file latency, not by CPU).
    const todo: string[] = [];
    for (const rel of files) {
      seen.add(rel);
      const st = fs.statSync(repo.abs(rel));
      const prev = index.entries[rel];
      if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) continue;
      todo.push(rel);
    }
    const queue = [...todo];
    const worker = async () => {
      for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
        const prev = index.entries[rel];
        const cf = await chunkFile(repo.abs(rel), true);
        const blobId = repo.putObject(cf.blob);
        if (prev?.blob !== blobId) {
          const hint = hintForFile(repo.abs(rel));
          for (const c of cf.chunks) pending.put(c.hash, c.data!, hint);
          changed++;
          bytes += cf.size;
          chunkCount += cf.chunks.length;
        }
        index.entries[rel] = { size: cf.size, mtimeMs: cf.mtimeMs, blob: blobId };
      }
    };
    await Promise.all(Array.from({ length: Math.min(8, todo.length) }, worker));
    // Files that disappeared under a staged folder.
    const relDir = repo.rel(abs);
    for (const p of Object.keys(index.entries)) {
      if ((relDir === "" || p === relDir || p.startsWith(`${relDir}/`)) && !seen.has(p) && !index.entries[p].absent && !fs.existsSync(repo.abs(p))) delete index.entries[p];
    }
  }
  pending.flush(); // chunks must be on disk before the index says they are staged
  repo.writeIndex(index);
  out(changed ? `Staged ${changed} changed files (${formatBytes(bytes)}, ${chunkCount} chunks).` : "Nothing new to stage.");
}

async function cmdStatus() {
  const asJson = flag("json");
  const repo = LocalRepo.find();
  const index = repo.index();
  const tree = headTree(repo);
  const staged = diffTrees(tree, makeTree(Object.entries(index.entries).map(([p, e]) => ({ path: p, blob: e.blob, size: e.size }))));
  const rules = ignoreRules(repo.root);
  const working = walk(repo.root, repo.root, rules);
  const modified = working.filter((p) => {
    const e = index.entries[p];
    if (!e) return false;
    const st = fs.statSync(repo.abs(p));
    return st.size !== e.size || st.mtimeMs !== e.mtimeMs;
  });
  const untracked = working.filter((p) => !index.entries[p]);
  const deleted = Object.keys(index.entries).filter((p) => !index.entries[p].absent && !fs.existsSync(repo.abs(p)));
  const notHere = Object.values(index.entries).filter((e) => e.absent).length;
  if (asJson) {
    return out(
      JSON.stringify(
        {
          branch: repo.head(),
          commit: repo.ref(repo.head()),
          staged: staged.map((s) => {
            let chunksChanged: number | null = null, chunksTotal: number | null = null;
            if (s.change === "modified" && s.oldBlob && s.newBlob && repo.hasObject(s.oldBlob)) {
              const before = new Set(repo.blob(s.oldBlob).chunks.map((c) => c.hash));
              const after = repo.blob(s.newBlob).chunks;
              chunksTotal = after.length;
              chunksChanged = after.filter((c) => !before.has(c.hash)).length;
            }
            return { path: s.path, change: s.change, type: dataTypeOf(s.path) ?? null, size: s.sizeAfter, chunksChanged, chunksTotal };
          }),
          modified,
          deleted,
          untracked,
          notInThisFolder: notHere,
          clean: !staged.length && !modified.length && !deleted.length && !untracked.length,
        },
        null,
        2,
      ),
    );
  }
  out(`On branch ${repo.head()}${repo.ref(repo.head()) ? ` at ${shortId(repo.ref(repo.head())!)}` : " (no commits yet)"}`);
  if (notHere) out(`Sparse checkout: ${notHere} files outside ${(repo.config().sparse ?? []).join(", ")} are not in this folder (craton sparse).`);
  if (staged.length) {
    out("\nReady to commit:");
    for (const s of staged) {
      const type = dataTypeOf(s.path);
      let detail = s.change === "removed" ? "" : formatBytes(s.sizeAfter);
      if (s.change === "modified" && s.oldBlob && s.newBlob && repo.hasObject(s.oldBlob)) {
        const before = new Set(repo.blob(s.oldBlob).chunks.map((c) => c.hash));
        const after = repo.blob(s.newBlob).chunks;
        const fresh = after.filter((c) => !before.has(c.hash)).length;
        detail = `${fresh} of ${after.length} chunks changed`;
      }
      out(`  ${s.change.padEnd(9)} ${s.path}${type ? ` [${type}]` : ""}  ${detail}`);
    }
  }
  if (modified.length || deleted.length) {
    out("\nChanged but not staged (craton add):");
    for (const p of modified) out(`  modified  ${p}`);
    for (const p of deleted) out(`  deleted   ${p}`);
  }
  if (untracked.length) {
    out("\nNot tracked yet (craton add):");
    for (const p of untracked.slice(0, 20)) out(`  ${p}`);
    if (untracked.length > 20) out(`  …and ${untracked.length - 20} more`);
  }
  if (!staged.length && !modified.length && !deleted.length && !untracked.length) out("Nothing to commit; the working tree matches the last commit.");
}

async function cmdCommit() {
  const message = opt("message", "m");
  if (!message?.trim()) throw new CliError('Add a message: craton commit -m "Describe the change"');
  const repo = LocalRepo.find();
  const index = repo.index();
  const tree = makeTree(Object.entries(index.entries).map(([p, e]) => ({ path: p, blob: e.blob, size: e.size })));
  const branch = repo.head();
  const parent = repo.ref(branch);
  if (parent && repo.commit(parent).tree === objectId(tree)) throw new CliError("Nothing to commit. Stage changes with `craton add` first.");
  const treeId = repo.putObject(tree);
  const server = repo.config().remote ? parseRemote(repo.config().remote!).server : null;
  const commit = makeCommit({ tree: treeId, parents: parent ? [parent] : [], author: handleFor(server), message: message.trim(), timestamp: new Date().toISOString() }, tree);
  const id = repo.putObject(commit);
  repo.setRef(branch, id);
  const changes = diffTrees(parent ? repo.tree(repo.commit(parent).tree) : null, tree);
  out(`[${branch} ${shortId(id)}] ${message.trim()}`);
  out(`${changes.length} files changed · Merkle root ${commit.merkleRoot.slice(0, 16)}…`);
}

async function cmdLog() {
  const repo = LocalRepo.find();
  const n = Number(opt("n", "n") ?? opt("limit") ?? 20);
  const asJson = flag("json");
  const tip = repo.ref(repo.head());
  if (!tip) return out(asJson ? "[]" : "No commits yet.");
  // craton log <path>: the commits that changed one file, from the server (up to its 20 most recent).
  if (rest[0]) {
    const rel = repoPathOf(repo, rest[0]);
    let info: { history: { sha: string; message: string; author: string; timestamp: string; change: string }[] };
    try {
      info = await remoteFor(repo).request("GET", `/file/${encodeURIComponent(tip)}/${rel.split("/").map(encodeURIComponent).join("/")}`);
    } catch (err) {
      if ((err as { status?: number }).status === 404) throw new CliError(`${rel} isn’t on the server at ${shortId(tip)}. Push first if the commit is only local.`);
      throw err;
    }
    if (asJson) return out(JSON.stringify(info.history.slice(0, n), null, 2));
    if (!info.history.length) return out(`No commits changed ${rel}.`);
    for (const h of info.history.slice(0, n)) out(`${shortId(h.sha)}  ${h.timestamp.slice(0, 16).replace("T", " ")}  ${h.author.padEnd(10)}  ${h.change.padEnd(8)}  ${h.message.split(String.fromCharCode(10))[0]}`);
    return;
  }
  if (asJson) return out(JSON.stringify(repo.log(tip, n).map((c) => ({ sha: c.id, author: c.author, timestamp: c.timestamp, message: c.message, parents: c.parents })), null, 2));
  for (const c of repo.log(tip, n)) out(`${shortId(c.id)}  ${c.timestamp.slice(0, 16).replace("T", " ")}  ${c.author.padEnd(10)}  ${c.message.split("\n")[0]}`);
}

async function cmdPush() {
  // --json: one JSON object per line (plan, upload progress, done) instead of text, for wrappers and CI logs.
  const json = flag("json");
  const ev = (o: Record<string, unknown>) => out(JSON.stringify(o));
  const repo = LocalRepo.find();
  const remote = remoteFor(repo);
  const branch = opt("branch") ?? repo.head();
  const tip = repo.ref(branch);
  if (!tip) throw new CliError(`${branch} has no commits to push.`);

  // Commits the server already has come with everything they reference, so only the new ones are walked:
  // a fresh clone holds the tip's files and trees, not those of every older commit.
  const commits = repo.log(tip, 100_000);
  const { missing: newCommitIds } = await remote.request<{ missing: string[] }>("POST", "/objects/missing", { ids: commits.map((c) => c.id) });
  const fresh = new Set(newCommitIds);
  const newCommits = commits.filter((c) => fresh.has(c.id));
  const trees = new Map<string, TreeObject>();
  const blobs = new Map<string, BlobObject>();
  for (const c of newCommits) {
    const t = repo.tree(c.tree);
    trees.set(c.tree, t);
    for (const e of t.entries) if (!blobs.has(e.blob)) blobs.set(e.blob, repo.blob(e.blob));
  }
  const allIds = [...blobs.keys(), ...trees.keys(), ...newCommits.map((c) => c.id)];
  const { missing: missingObjects } = await remote.request<{ missing: string[] }>("POST", "/objects/missing", { ids: allIds });
  const needObj = new Set(missingObjects);

  // Chunks of the blobs the server doesn't have yet.
  const chunkSize = new Map<string, number>();
  for (const [id, b] of blobs) if (needObj.has(id)) for (const c of b.chunks) chunkSize.set(c.hash, c.size);
  const hashes = [...chunkSize.keys()];
  const missing: string[] = [];
  for (let i = 0; i < hashes.length; i += 10_000) {
    const r = await remote.request<{ missing: string[] }>("POST", "/chunks/missing", { hashes: hashes.slice(i, i + 10_000) });
    missing.push(...r.missing);
  }
  const uploadBytes = missing.reduce((n, h) => n + (chunkSize.get(h) ?? 0), 0);
  const totalBytes = hashes.reduce((n, h) => n + (chunkSize.get(h) ?? 0), 0);
  if (json) ev({ event: "plan", chunksToUpload: missing.length, chunksTotal: hashes.length, bytesToUpload: uploadBytes, bytesTotal: totalBytes });
  else out(`${missing.length} of ${hashes.length} chunks to upload (${formatBytes(uploadBytes)} of ${formatBytes(totalBytes)}); the rest are already on the server.`);

  // Find each missing chunk in the pending cache, or in an unchanged working file.
  const pending = new PendingChunks(repo.dir);
  const index = repo.index();
  const fromFile = new Map<string, { abs: string; offset: number; length: number }>();
  for (const [p, e] of Object.entries(index.entries)) {
    let offset = 0;
    for (const c of repo.blob(e.blob).chunks) {
      fromFile.set(c.hash, { abs: repo.abs(p), offset, length: c.size });
      offset += c.size;
    }
  }
  let done = 0;
  let sentBytes = 0;
  let rawBytes = 0;
  const uploadStarted = Date.now();
  const queue = [...missing];
  const progress = () => {
    const seconds = Math.max(0.001, (Date.now() - uploadStarted) / 1000);
    const rate = `${formatBytes(sentBytes / seconds)}/s`;
    if (json) ev({ event: "upload", done, total: missing.length, sentBytes, rawBytes, bytesPerSecond: Math.round(sentBytes / seconds) });
    else process.stdout.write(`\r  uploaded ${done.toLocaleString("en-US")}/${missing.length.toLocaleString("en-US")} chunks · ${formatBytes(sentBytes)} sent · ${rate}   `);
  };
  // What kind of bytes each file holds decides how its chunks are encoded (byte-shuffled for uncompressed rasters,
  // left alone when already compressed); asked once per file.
  const hints = new Map<string, Hint>();
  const hintFor = (abs: string) => {
    let h = hints.get(abs);
    if (!h) hints.set(abs, (h = hintForFile(abs)));
    return h;
  };
  /** A chunk as it will travel: the staged encoding when there is one (already verified), else encoded from the file. */
  const encodedOf = async (hash: string): Promise<{ hash: string; stored: Buffer; size: number }> => {
    const staged = pending.getStored(hash);
    if (staged) return { hash, ...staged };
    const src = fromFile.get(hash);
    if (!src) throw new CliError(`Chunk ${hash.slice(0, 12)} isn’t available locally anymore.`);
    const data = await readChunkFromFile(src.abs, src.offset, src.length, hash);
    return { hash, stored: compressChunk(data, hash, hintFor(src.abs)).stored, size: data.length };
  };
  const account = (parts: { stored: Buffer; size: number }[]) => {
    for (const p of parts) {
      sentBytes += p.stored.length - 1;
      rawBytes += p.size;
    }
  };
  // Small chunks travel together (one request per ~2 MB or 200 chunks); a server without the batch route answers 404 and
  // the rest goes one by one.
  let batching = true;
  const BATCH_BYTES = 2 * 1024 * 1024;
  const BATCH_CHUNKS = 200;
  const worker = async () => {
    while (queue.length) {
      const group: { hash: string; stored: Buffer; size: number }[] = [];
      let size = 0;
      while (queue.length && group.length < (batching ? BATCH_CHUNKS : 1) && size < BATCH_BYTES) {
        const item = await encodedOf(queue.shift()!);
        group.push(item);
        size += item.stored.length;
      }
      if (batching && group.length > 1) {
        const frames = group.flatMap(({ hash, stored }) => {
          const header = Buffer.alloc(69);
          header.write(hash, 0, 64, "latin1");
          header.writeUInt32BE(stored.length - 1, 64);
          header[68] = stored[0];
          return [header, stored.subarray(1)];
        });
        try {
          await remote.request("POST", "/chunks", undefined, Buffer.concat(frames));
          const before = done;
          done += group.length;
          account(group);
          if (Math.floor(done / 50) > Math.floor(before / 50) || done === missing.length) progress();
          continue;
        } catch (err) {
          if ((err as { status?: number }).status !== 404) throw err;
          batching = false;
        }
      }
      // One by one: a server without the batch route, or a single chunk left over. The single route takes raw bytes.
      for (const item of group) {
        await remote.request("PUT", `/chunks/${item.hash}`, undefined, decompressChunk(item.stored));
        done++;
        account([item]);
        if (done % 50 === 0 || done === missing.length) progress();
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (missing.length) {
    const seconds = (Date.now() - uploadStarted) / 1000;
    const saved = rawBytes > 0 ? Math.round((1 - sentBytes / rawBytes) * 100) : 0;
    if (json) ev({ event: "uploaded", chunks: missing.length, sentBytes, rawBytes, seconds });
    else out(`\n  Sent ${formatBytes(sentBytes)} for ${formatBytes(rawBytes)} of new data${saved > 0 ? ` (${saved}% smaller)` : ""} in ${seconds.toFixed(1)} s.`);
  }

  // Objects in dependency order, then move the branch (compare-and-swap on the server's tip).
  const order = [...[...blobs].filter(([id]) => needObj.has(id)).map(([, o]) => o), ...[...trees].filter(([id]) => needObj.has(id)).map(([, o]) => o), ...[...commits].reverse().filter((c) => needObj.has(c.id)).map(({ id: _id, ...c }) => c as CommitObject)];
  for (let i = 0; i < order.length; i += 500) await remote.request("POST", "/objects", { objects: order.slice(i, i + 500) });
  const refs = await remote.request<{ branches: { name: string; commit_id: string }[] }>("GET", "/refs");
  const expected = refs.branches.find((b) => b.name === branch)?.commit_id ?? null;
  try {
    const res = await remote.request<{ updated: boolean; checks: { status: string; steps: { name: string; status: string; detail: string }[] } | null }>("POST", `/refs/heads/${branch}`, { commit: tip, expected });
    pending.clear();
    if (json) {
      return ev({ event: "done", updated: res.updated, branch, from: expected, to: tip, checks: res.checks ? { status: res.checks.status, steps: res.checks.steps.map((x) => ({ name: x.name, status: x.status, detail: x.detail })) } : null });
    }
    out(res.updated ? `Pushed ${branch}: ${expected ? shortId(expected) : "(new)"} → ${shortId(tip)}` : `${branch} is already up to date.`);
    if (res.checks) {
      out(`Checks ${res.checks.status}:`);
      for (const s of res.checks.steps) out(`  ${s.status === "passed" ? "✓" : s.status === "failed" ? "✗" : "–"} ${s.name}: ${s.detail}`);
    }
  } catch (err) {
    const e = err as CliError & { code?: string };
    if (e.code === "non_fast_forward" || e.code === "stale_ref") throw new CliError(`${e.message}\nRun \`craton pull\`, then push again.`);
    throw err;
  }
}

async function fetchCommits(remote: Remote, repo: LocalRepo, ref: string) {
  const list = await remote.request<{ id: string; commit: CommitObject }[]>("GET", `/commit-objects?ref=${encodeURIComponent(ref)}&limit=10000`);
  for (const { commit } of list) repo.putObject(commit);
  return list;
}

async function cmdClone() {
  const json = flag("json");
  const target = rest[0];
  if (!target) throw new CliError("Usage: craton clone owner/repo [folder]   (or a full URL: http://localhost:4000/owner/repo)");
  const url = target.startsWith("http") ? target : `${(opt("server") ?? "http://localhost:4000").replace(/\/+$/, "")}/${target}`;
  const r = parseRemote(url);
  const remote = new Remote(r.server, r.owner, r.name, tokenFor(r.server));
  const refs = await remote.request<{ branches: { name: string; commit_id: string }[]; defaultBranch: string }>("GET", "/refs");
  // --tag v1.2.0 checks out a release's commit on a local branch named release/v1.2.0.
  const tag = opt("tag");
  let branch = opt("branch") ?? refs.defaultBranch;
  let tip = refs.branches.find((b) => b.name === branch)?.commit_id;
  if (tag) {
    const releases = await remote.request<{ tag: string; commit: string }[]>("GET", "/releases");
    const release = releases.find((x) => x.tag === tag);
    if (!release) throw new CliError(`${r.owner}/${r.name} has no release ${tag}.`);
    tip = release.commit;
    branch = `release/${tag}`;
  }
  const dir = path.resolve(rest[1] ?? r.name);
  // A clone that was interrupted left a repository with no branch tip yet: carry on in it instead of refusing.
  let resuming: LocalRepo | null = null;
  if (fs.existsSync(dir) && fs.readdirSync(dir).length) {
    try {
      const existing = new LocalRepo(dir);
      if (existing.config().remote === url && existing.ref(branch) === null) resuming = existing;
    } catch {}
    if (!resuming) throw new CliError(`${dir} already exists and isn’t empty.`);
  }
  const only = opt("only");
  const sparse = only ? normaliseSparse(only.split(",")) : [];
  if (only !== undefined && sparse.length === 0) throw new CliError("--only needs one or more folders or files, separated by commas.");
  const repo = resuming ?? LocalRepo.init(dir, { remote: url, branch, ...(sparse.length ? { sparse } : {}) });
  if (resuming) out(json ? JSON.stringify({ event: "resuming" }) : "Resuming an unfinished clone; chunks already downloaded are reused.");
  if (resuming && sparse.length) repo.writeConfig({ ...repo.config(), sparse });
  const sparseNow = repo.config().sparse ?? [];
  if (!tip) return out(`Cloned an empty repository into ${dir}`);
  const ref = tag ? tip : branch;
  const manifest = await remote.request<{ commitId: string; commit: CommitObject; tree: TreeObject; blobs: Record<string, BlobObject> }>("GET", `/manifest/${encodeURIComponent(ref)}`);
  await fetchCommits(remote, repo, ref);
  repo.putObject(manifest.tree);
  for (const b of Object.values(manifest.blobs)) repo.putObject(b);
  const started = Date.now();
  const res = await checkout(repo, null, manifest.tree, remote);
  repo.setRef(branch, manifest.commitId);
  const total = manifest.tree.entries.reduce((n, e) => n + e.size, 0);
  const here = manifest.tree.entries.filter((e) => inSparse(sparseNow, e.path));
  const what = sparseNow.length ? `${here.length} of ${manifest.tree.entries.length} files, ${formatBytes(here.reduce((n, e) => n + e.size, 0))} of ${formatBytes(total)}; only ${sparseNow.join(", ")}` : `${manifest.tree.entries.length} files, ${formatBytes(total)}`;
  if (json) {
    return out(JSON.stringify({ event: "done", repository: `${r.owner}/${r.name}`, directory: dir, files: manifest.tree.entries.length, filesHere: here.length, bytes: total, bytesDownloaded: res.downloaded, sparse: sparseNow, seconds: (Date.now() - started) / 1000 }));
  }
  out(`Cloned ${r.owner}/${r.name} (${what}) into ${dir} in ${((Date.now() - started) / 1000).toFixed(1)} s; downloaded ${formatBytes(res.downloaded)}.`);
}

async function cmdPull() {
  const json = flag("json");
  const repo = LocalRepo.find();
  const remote = remoteFor(repo);
  const branch = repo.head();
  const refs = await remote.request<{ branches: { name: string; commit_id: string }[] }>("GET", "/refs");
  const remoteTip = refs.branches.find((b) => b.name === branch)?.commit_id;
  const localTip = repo.ref(branch);
  if (!remoteTip) return out(json ? JSON.stringify({ event: "done", updated: false, reason: "not_on_server", branch }) : `${branch} doesn’t exist on the server yet. Push it with \`craton push\`.`);
  if (remoteTip === localTip) return out(json ? JSON.stringify({ event: "done", updated: false, reason: "up_to_date", branch, commit: localTip }) : "Already up to date.");
  await fetchCommits(remote, repo, branch);
  if (localTip && !repo.log(remoteTip, 100_000).some((c) => c.id === localTip)) {
    if (repo.log(localTip, 100_000).some((c) => c.id === remoteTip)) return out(`Your ${branch} is ahead of the server. Push with \`craton push\`.`);
    throw new CliError(`Your ${branch} and the server’s have both changed. Push yours to a new branch and open a pull request.`);
  }
  const dirty = dirtyPaths(repo);
  const manifest = await remote.request<{ commitId: string; tree: TreeObject; blobs: Record<string, BlobObject> }>("GET", `/manifest/${encodeURIComponent(branch)}`);
  const incoming = new Set(diffTrees(headTree(repo), manifest.tree).map((c) => c.path));
  const clash = dirty.filter((p) => incoming.has(p));
  if (clash.length) throw new CliError(`Pull would overwrite local changes in:\n  ${clash.join("\n  ")}\nCommit them first.`);
  repo.putObject(manifest.tree);
  for (const b of Object.values(manifest.blobs)) repo.putObject(b);
  const res = await checkout(repo, headTree(repo), manifest.tree, remote);
  repo.setRef(branch, manifest.commitId);
  if (json) return out(JSON.stringify({ event: "done", updated: true, branch, from: localTip, to: manifest.commitId, filesUpdated: res.changed, bytesDownloaded: res.downloaded }));
  out(`Fast-forwarded ${branch} to ${shortId(manifest.commitId)}: ${res.changed} files updated, ${formatBytes(res.downloaded)} downloaded.`);
}

async function cmdBranch() {
  const asJson = flag("json");
  const repo = LocalRepo.find();
  const name = rest[0];
  if (!name && asJson) return out(JSON.stringify(repo.branches().map((b) => ({ name: b, commit: repo.ref(b), current: b === repo.head() })), null, 2));
  if (!name) {
    for (const b of repo.branches()) out(`${b === repo.head() ? "*" : " "} ${b}  ${shortId(repo.ref(b) ?? "")}`);
    return;
  }
  if (!/^[a-z0-9][a-z0-9._/-]{0,99}$/.test(name)) throw new CliError("Branch names use lowercase letters, numbers, dots, dashes and slashes.");
  if (repo.ref(name)) throw new CliError(`${name} already exists.`);
  const tip = repo.ref(repo.head());
  if (!tip) throw new CliError("Commit something before creating a branch.");
  repo.setRef(name, tip);
  out(`Created ${name} at ${shortId(tip)}. Switch to it with \`craton switch ${name}\`.`);
}

async function cmdSwitch() {
  const repo = LocalRepo.find();
  const name = rest[0];
  if (!name) throw new CliError("Usage: craton switch <branch>");
  if (name === repo.head()) return out(`Already on ${name}.`);
  let target = repo.ref(name);
  let remote: Remote | null = null;
  try {
    remote = remoteFor(repo);
  } catch {}
  if (!target && remote) {
    const refs = await remote.request<{ branches: { name: string; commit_id: string }[] }>("GET", "/refs");
    target = refs.branches.find((b) => b.name === name)?.commit_id ?? null;
    if (target) {
      await fetchCommits(remote, repo, name);
      const m = await remote.request<{ tree: TreeObject; blobs: Record<string, BlobObject> }>("GET", `/manifest/${encodeURIComponent(name)}`);
      repo.putObject(m.tree);
      for (const b of Object.values(m.blobs)) repo.putObject(b);
      repo.setRef(name, target);
    }
  }
  if (!target) throw new CliError(`No branch called ${name}.`);
  const dirty = dirtyPaths(repo);
  if (dirty.length) throw new CliError(`Commit or undo your changes first:\n  ${dirty.join("\n  ")}`);
  const res = await checkout(repo, headTree(repo), repo.tree(repo.commit(target).tree), remote);
  repo.setHead(name);
  out(`Switched to ${name} (${res.changed} files changed, ${formatBytes(res.downloaded)} downloaded).`);
}

async function cmdRevert() {
  const repo = LocalRepo.find();
  const ref = rest[0];
  if (!ref) throw new CliError("Usage: craton revert <commit>");
  const branch = repo.head();
  const tip = repo.ref(branch);
  if (!tip) throw new CliError("Nothing to revert.");
  const target = repo.log(tip, 100_000).find((c) => c.id.startsWith(ref));
  if (!target) throw new CliError(`No commit ${ref} on ${branch}.`);
  if (dirtyPaths(repo).length) throw new CliError("Commit or undo your changes first.");
  const parentTree = target.parents[0] ? repo.tree(repo.commit(target.parents[0]).tree) : null;
  const targetTree = repo.tree(target.tree);
  const current = repo.tree(repo.commit(tip).tree);
  const entries = new Map(current.entries.map((e) => [e.path, e]));
  const conflicts: string[] = [];
  for (const ch of diffTrees(parentTree, targetTree)) {
    const now = entries.get(ch.path)?.blob;
    if (now !== ch.newBlob) {
      conflicts.push(ch.path);
      continue;
    }
    const old = parentTree?.entries.find((e) => e.path === ch.path);
    if (old) entries.set(ch.path, old);
    else entries.delete(ch.path);
  }
  if (conflicts.length) throw new CliError(`These files changed again after ${shortId(target.id)}, so it can’t be reverted automatically:\n  ${conflicts.join("\n  ")}`);
  const tree = makeTree([...entries.values()]);
  await checkout(repo, current, tree, (() => { try { return remoteFor(repo); } catch { return null; } })());
  const treeId = repo.putObject(tree);
  const server = repo.config().remote ? parseRemote(repo.config().remote!).server : null;
  const commit = makeCommit({ tree: treeId, parents: [tip], author: handleFor(server), message: `Revert "${target.message}"\n\nThis reverts ${target.id}.`, timestamp: new Date().toISOString() }, tree);
  const id = repo.putObject(commit);
  repo.setRef(branch, id);
  out(`[${branch} ${shortId(id)}] Revert "${target.message}". History is kept; the undo is a new commit.`);
}

async function cmdFsck() {
  const repo = LocalRepo.find();
  const verify = flag("verify");
  const tip = repo.ref(repo.head());
  const problems: string[] = [];
  if (tip) {
    const c = repo.commit(tip);
    if (treeMerkleRoot(repo.tree(c.tree)) !== c.merkleRoot) problems.push("HEAD Merkle root doesn’t match its tree.");
  }
  const index = repo.index();
  let checked = 0;
  for (const [p, e] of Object.entries(index.entries)) {
    const abs = repo.abs(p);
    if (e.absent && !fs.existsSync(abs)) continue; // outside the sparse set, not expected here
    if (!fs.existsSync(abs)) {
      problems.push(`${p}: missing`);
      continue;
    }
    if (verify) {
      const cf = await chunkFile(abs);
      if (objectId(cf.blob) !== e.blob) problems.push(`${p}: contents differ from the recorded version`);
    } else {
      const st = fs.statSync(abs);
      if (st.size !== e.size) problems.push(`${p}: size changed`);
    }
    checked++;
  }
  // Staged chunks waiting for a push: listed, present and (with --verify) re-hashed.
  const staging = new PendingChunks(repo.dir).check(verify);
  for (const p of staging.problems) problems.push(`staging cache: ${p}`);
  if (staging.orphans.length) out(`Note: ${staging.orphans.length} unused staging file${staging.orphans.length === 1 ? "" : "s"} in .craton/pending from an interrupted add; safe to delete.`);
  if (problems.length) {
    out(`${problems.length} problems:`);
    for (const p of problems) out(`  ✗ ${p}`);
    process.exitCode = 1;
  } else out(`OK: ${checked} files ${verify ? "re-hashed and verified" : "present with expected sizes"}${tip ? `; Merkle root of ${shortId(tip)} checks out` : ""}${staging.chunks ? `; ${staging.chunks} staged chunks ${verify ? "re-hashed" : "present"}` : ""}.`);
}

// ── File locks ──────────────────────────────────────────────────────────────

async function cmdLock() {
  const repo = LocalRepo.find();
  const reason = opt("reason", "m") ?? "";
  await lockCommand(repo, remoteFor(repo), whoAmI(repo.config().remote!), { target: rest[0], reason }, out);
}

async function cmdUnlock() {
  const repo = LocalRepo.find();
  const force = flag("force");
  await unlockCommand(repo, remoteFor(repo), whoAmI(repo.config().remote!), { target: rest[0], force }, out);
}

async function cmdLocks() {
  const repo = LocalRepo.find();
  await listLocksCommand(repo, remoteFor(repo), whoAmI(repo.config().remote!), out, flag("json"));
}

/**
 * Files others have locked are read-only here; a pull or switch has to be able to rewrite them,
 * so make them writable for the duration and re-apply the locks afterwards.
 */
async function withLocks(fn: () => Promise<void>) {
  let repo: LocalRepo | null = null;
  try {
    repo = LocalRepo.find();
  } catch {}
  if (repo) releaseReadOnly(repo);
  try {
    await fn();
  } finally {
    if (repo) {
      try {
        const remote = remoteFor(repo);
        applyLocks(repo, await remote.request<RemoteLock[]>("GET", "/locks"), whoAmI(repo.config().remote!));
      } catch {
        // Offline or no remote: the server still refuses a push of a locked file.
      }
    }
  }
}

// ── Statistics: numbers behind a change, from the terminal ─────────────────

type Summary = { validCells: number; nodataCells: number; min: number; max: number; mean: number; stdDev: number; p5: number; p50: number; p95: number };
type RasterStats = {
  sampled: { width: number; height: number; factor: number };
  sameGrid: boolean;
  before: Summary;
  after: Summary;
  change: null | { comparedCells: number; changedCells: number; meanChange: number; meanAbsChange: number; rmse: number; raisedPercent: number; loweredPercent: number; volumeChange: number | null };
};

const g = (v: number) => (Number.isFinite(v) ? String(Number(v.toPrecision(5))) : "n/a");
const signed = (v: number) => `${v > 0 ? "+" : ""}${g(v)}`;

function fitLines(label: string, f: Fit) {
  const rate = rateNse(f.nse);
  return `${label.padEnd(14)} n=${String(f.n).padEnd(6)} NSE ${g(f.nse ?? NaN).padEnd(8)} KGE ${g(f.kge ?? NaN).padEnd(8)} PBIAS ${f.pbias === null ? "n/a".padEnd(8) : `${f.pbias.toFixed(1)}%`.padEnd(8)} RMSE ${g(f.rmse).padEnd(8)}${rate ? ` ${rate}` : ""}`;
}

/**
 * craton stats <raster.tif> [--base REF] [--ref REF]
 *   Cell statistics of a raster at --ref (the current branch) against --base (the commit before it), and the
 *   change between them: what the Change card on the website shows, computed by the server from its sampled grids.
 * craton stats <table.csv> --obs COL --sim COL [--by COL]
 *   Goodness of fit of a simulated column against an observed one (NSE, KGE, PBIAS, RMSE), from the working file,
 *   and per value of --by (a station column) when given.
 * Add --json for machine-readable output.
 */
async function cmdStats() {
  const asJson = flag("json");
  const obs = opt("obs"), sim = opt("sim"), by = opt("by");
  const baseOpt = opt("base"), refOpt = opt("ref");
  const target = rest[0];
  if (!target) throw new CliError("Usage: craton stats <file> [--base REF] [--ref REF]   or   craton stats <table.csv> --obs COL --sim COL [--by COL]");
  const repo = LocalRepo.find();
  const rel = repoPathOf(repo, target);

  if (/\.(csv|tsv|txt)$/i.test(rel)) {
    if (!obs || !sim) throw new CliError("Name the columns to compare: --obs <observed column> --sim <simulated column>.");
    const abs = repo.abs(rel);
    if (!fs.existsSync(abs)) throw new CliError(`${rel} isn’t in the working folder.`);
    const text = fs.readFileSync(abs, "utf8");
    const rows = parseCsv(text, sniffDelimiter(text));
    const header = rows[0] ?? [];
    const col = (name: string) => {
      const i = header.indexOf(name);
      if (i < 0) throw new CliError(`${rel} has no column “${name}”. Columns: ${header.join(", ")}`);
      return i;
    };
    const oi = col(obs), si = col(sim);
    if (oi === si) throw new CliError("Choose two different columns.");
    const body = rows.slice(1);
    const overall = fitStatistics(numericColumn(body, oi), numericColumn(body, si));
    if (!overall) throw new CliError("Not enough numeric pairs in those two columns to compare.");
    const groups = by ? fitByGroup(body, oi, si, col(by), 200) : [];
    if (asJson) return out(JSON.stringify({ path: rel, observed: obs, simulated: sim, overall, by: by ?? null, groups }, null, 2));
    out(`${rel}: ${sim} against ${obs}`);
    out(fitLines("all rows", overall));
    for (const gr of groups) out(fitLines(gr.name.slice(0, 14), gr.fit));
    out("NSE and KGE: 1 is perfect. PBIAS is positive when the model underestimates. Rows with a missing value are left out.");
    return;
  }

  if (!/\.tiff?$/i.test(rel)) throw new CliError("Statistics are computed for GeoTIFF rasters, and for CSV tables with --obs and --sim.");
  const remote = remoteFor(repo);
  const tip = repo.ref(repo.head());
  if (!tip && !refOpt) throw new CliError("No commits yet.");
  const ref = refOpt ?? repo.head();
  let base = baseOpt;
  if (!base) {
    const parent = tip ? repo.commit(tip).parents[0] : undefined;
    if (!parent) throw new CliError("There is no earlier version to compare with. Pass --base <branch|tag|commit>.");
    base = parent;
  }
  const s = await remote.request<RasterStats>("GET", `/raster-stats/${encodeURIComponent(ref)}/${rel.split("/").map(encodeURIComponent).join("/")}?base=${encodeURIComponent(base)}`);
  if (asJson) return out(JSON.stringify(s, null, 2));
  const row = (label: string, v: Summary) => `${label.padEnd(8)} min ${g(v.min).padEnd(10)} mean ${g(v.mean).padEnd(10)} max ${g(v.max).padEnd(10)} sd ${g(v.stdDev).padEnd(9)} p5/p50/p95 ${g(v.p5)} / ${g(v.p50)} / ${g(v.p95)}  (${v.validCells} cells, ${v.nodataCells} no-data)`;
  out(`${rel}: ${shortId(base)} -> ${ref.length > 20 ? shortId(ref) : ref}`);
  out(row("before", s.before));
  out(row("after", s.after));
  if (s.change) {
    const c = s.change;
    out(`change   mean ${signed(c.meanChange)}  mean abs ${g(c.meanAbsChange)}  rmse ${g(c.rmse)}  raised ${c.raisedPercent.toFixed(1)}%  lowered ${c.loweredPercent.toFixed(1)}%${c.volumeChange === null ? "" : `  volume ${signed(c.volumeChange)} m3`}`);
  } else out("change   the two versions are on different grids, so cells can't be compared one to one.");
  out(`Computed on a ${s.sampled.width} x ${s.sampled.height} sample${s.sampled.factor > 1.01 ? ` (about 1 of every ${Math.round(s.sampled.factor)} cells)` : ""} of the full raster.`);
}

// ── Diff: what changed between two versions, from local history ────────────

/** A branch, HEAD, HEAD~N, or a commit id (any unambiguous prefix) from this repository's own history. */
function resolveLocal(repo: LocalRepo, spec: string): string {
  const head = repo.ref(repo.head());
  const m = /^HEAD(?:~(\d+))?$/i.exec(spec);
  if (m) {
    let cur = head;
    for (let i = 0; i < Number(m[1] ?? 0); i++) {
      if (!cur) break;
      cur = repo.commit(cur).parents[0] ?? null;
    }
    if (!cur) throw new CliError(`${spec} is before the first commit.`);
    return cur;
  }
  const branch = repo.ref(spec);
  if (branch) return branch;
  if (/^[0-9a-f]{4,64}$/.test(spec)) {
    const all = new Set<string>();
    for (const b of repo.branches()) for (const c of repo.log(repo.ref(b), 5000)) all.add(c.id);
    const hits = [...all].filter((id) => id.startsWith(spec));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) throw new CliError(`${spec} matches more than one commit; use more characters.`);
  }
  throw new CliError(`No branch or commit called ${spec} here. Try craton log.`);
}

/**
 * craton diff [<from> [<to>]]   Files that differ between two committed versions, with how many chunks were rewritten.
 * No arguments: the last commit against the one before it. One argument: that version against HEAD.
 */
async function cmdDiff() {
  const asJson = flag("json");
  const textPath = opt("text");
  const repo = LocalRepo.find();
  const tip = repo.ref(repo.head());
  if (!tip) throw new CliError("No commits yet.");
  let from: string | null, to: string;
  if (rest.length === 0) {
    to = tip;
    from = repo.commit(tip).parents[0] ?? null;
  } else if (rest.length === 1) {
    from = resolveLocal(repo, rest[0]);
    to = tip;
  } else {
    from = resolveLocal(repo, rest[0]);
    to = resolveLocal(repo, rest[1]);
  }
  // --text <path>: the changed lines of one text file (computed by the server, which has both versions).
  if (textPath) {
    if (!from) throw new CliError("There is no earlier version to compare with.");
    const rel = repoPathOf(repo, textPath);
    type Diff = { added: number; removed: number; replaced: boolean; hunks: { oldStart: number; newStart: number; oldLines: number; newLines: number; lines: { t: string; text: string }[] }[] };
    let d: Diff;
    try {
      d = await remoteFor(repo).request<Diff>("GET", `/text-diff/${encodeURIComponent(to)}/${rel.split("/").map(encodeURIComponent).join("/")}?base=${encodeURIComponent(from)}`);
    } catch (err) {
      const e = err as { status?: number; message: string };
      if (e.status === 404) throw new CliError(`${rel} isn’t on the server at ${shortId(to)}. Push first if the commit is only local.`);
      throw new CliError(e.message);
    }
    if (asJson) return out(JSON.stringify(d, null, 2));
    out(`${rel}  ${shortId(from)} -> ${shortId(to)}  +${d.added} -${d.removed}`);
    for (const h of d.hunks) {
      out(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
      for (const l of h.lines) out(`${l.t}${l.text}`);
    }
    if (!d.hunks.length) out("No lines changed.");
    return;
  }
  const before = from ? repo.tree(repo.commit(from).tree) : null;
  const after = repo.tree(repo.commit(to).tree);
  const changes = diffTrees(before, after).map((c) => {
    let chunks: { rewritten: number; total: number } | null = null;
    if (c.change === "modified" && c.oldBlob && c.newBlob && repo.hasObject(c.oldBlob) && repo.hasObject(c.newBlob)) {
      const old = new Set(repo.blob(c.oldBlob).chunks.map((k) => k.hash));
      const now = repo.blob(c.newBlob).chunks;
      chunks = { rewritten: now.filter((k) => !old.has(k.hash)).length, total: now.length };
    }
    return { path: c.path, change: c.change, type: dataTypeOf(c.path) ?? null, sizeBefore: c.sizeBefore, sizeAfter: c.sizeAfter, chunks };
  });
  if (asJson) return out(JSON.stringify({ from, to, changes }, null, 2));
  out(`${from ? shortId(from) : "(nothing)"} -> ${shortId(to)}`);
  if (!changes.length) return out("No files differ.");
  for (const c of changes) {
    const detail = c.chunks ? `${c.chunks.rewritten} of ${c.chunks.total} chunks rewritten` : c.change === "removed" ? "" : formatBytes(c.sizeAfter);
    out(`  ${c.change.padEnd(9)} ${c.path}${c.type ? ` [${c.type}]` : ""}  ${detail}`);
  }
  const rewritten = changes.reduce((n, c) => n + (c.chunks?.rewritten ?? 0), 0);
  out(`${changes.length} file${changes.length === 1 ? "" : "s"} changed${rewritten ? `, ${rewritten} chunks rewritten` : ""}.`);
}

// ── Sparse checkout ─────────────────────────────────────────────────────────

/**
 * craton sparse                  Show which folders are in the working folder.
 * craton sparse add <paths…>     Bring more folders or files into the working folder (downloads only those).
 * craton sparse all              Bring in everything.
 * Files outside the set stay in history and in every commit; they are simply not written here.
 */
async function cmdSparse() {
  const repo = LocalRepo.find();
  const config = repo.config();
  const sub = rest[0];
  if (!sub) {
    const notHere = Object.values(repo.index().entries).filter((e) => e.absent).length;
    if (!config.sparse?.length) return out("The whole repository is in this folder.");
    out(`Only these are in this folder: ${config.sparse.join(", ")}  (${notHere} other files stay in history)`);
    return;
  }
  const tree = headTree(repo);
  if (!tree) throw new CliError("No commits yet.");
  let next: string[] | undefined;
  if (sub === "all") next = undefined;
  else if (sub === "add") {
    const add = normaliseSparse(rest.slice(1));
    if (!add.length) throw new CliError("Usage: craton sparse add <folder or file> [more…]");
    if (!config.sparse?.length) return out("The whole repository is already in this folder.");
    const unknown = add.filter((a) => !tree.entries.some((e) => e.path === a || e.path.startsWith(`${a}/`)));
    if (unknown.length) throw new CliError(`Nothing in this repository is called ${unknown.join(", ")}.`);
    next = [...new Set([...config.sparse, ...add])];
  } else throw new CliError("Usage: craton sparse [add <paths…> | all]");

  // Treat the newly included files as not yet checked out, so the normal checkout downloads exactly those.
  const wasHere = tree.entries.filter((e) => inSparse(config.sparse, e.path));
  const { sparse: _old, ...withoutSparse } = config;
  repo.writeConfig(next ? { ...withoutSparse, sparse: next } : withoutSparse);
  let remote: Remote | null = null;
  try {
    remote = remoteFor(repo);
  } catch {}
  const res = await checkout(repo, makeTree(wasHere), tree, remote);
  if (flag("json")) return out(JSON.stringify({ event: "done", filesBroughtIn: res.changed, bytesDownloaded: res.downloaded, sparse: next ?? [] }));
  out(`${res.changed} files brought into this folder, ${formatBytes(res.downloaded)} downloaded.`);
}

// ── Blame: which commit introduced each part of a file ──────────────────────

/**
 * craton blame <path> [--ref REF]   Which commit last rewrote each part of a file, by byte range (the server walks
 * the history; files are chunked by content, so a re-surveyed strip of a DEM shows up as its own range).
 */
async function cmdBlame() {
  const asJson = flag("json");
  const refOpt = opt("ref");
  const target = rest[0];
  if (!target) throw new CliError("Usage: craton blame <path> [--ref <branch|tag|commit>]");
  const repo = LocalRepo.find();
  const rel = repoPathOf(repo, target);
  const tip = repo.ref(repo.head());
  const ref = refOpt ?? tip;
  if (!ref) throw new CliError("No commits yet.");
  const remote = remoteFor(repo);
  type Range = { start: number; end: number; chunks: number; commit: string; author: string; message: string; timestamp: string };
  let b: { size: number; chunks: number; commit: string; ranges: Range[]; truncated: boolean };
  try {
    b = await remote.request("GET", `/blame/${encodeURIComponent(ref)}/${rel.split("/").map(encodeURIComponent).join("/")}`);
  } catch (err) {
    if ((err as { status?: number }).status === 404) throw new CliError(`${rel} isn’t on the server at ${ref.length > 20 ? shortId(ref) : ref}. Push first if the commit is only local.`);
    throw err;
  }
  if (asJson) return out(JSON.stringify(b, null, 2));
  out(`${rel} at ${shortId(b.commit)}: ${b.chunks} ${b.chunks === 1 ? "chunk" : "chunks"}, ${formatBytes(b.size)}`);
  const span = (r: Range) => `${formatBytes(r.start)} - ${formatBytes(r.end)}`.padEnd(22);
  for (const r of b.ranges) out(`  ${span(r)} ${shortId(r.commit)}  ${r.timestamp.slice(0, 10)}  ${r.author.padEnd(10)}  ${r.message.split(String.fromCharCode(10))[0].slice(0, 60)}`);
  if (b.truncated) out("History was longer than the walk limit; the oldest ranges may be older than shown.");
}

// ── Doctor: why isn't this working? ─────────────────────────────────────────

const CLI_VERSION: string = (() => {
  try {
    return (JSON.parse(fs.readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** True when version `a` is older than `b` (numeric parts compared in order; a missing part is 0). */
function olderThan(a: string, b: string): boolean {
  const x = a.split(".").map((n) => parseInt(n, 10) || 0), y = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}

/**
 * craton doctor [--json]   One line per thing that has to be true for pushing and pulling to work, with the fix
 * beside any that is not: Node version, the remote, the server, the token, access to the repository, free disk.
 */
async function cmdDoctor() {
  const asJson = flag("json");
  type Row = { check: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };
  const rows: Row[] = [];
  const add = (check: string, status: Row["status"], detail: string, fix?: string) => rows.push({ check, status, detail, fix });

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major > 23 || (major === 23 && minor >= 6)) add("Node.js", "ok", `v${process.versions.node}`);
  else add("Node.js", "fail", `v${process.versions.node}`, "Install Node.js 23.6 or newer.");

  let repo: LocalRepo | null = null;
  try {
    repo = LocalRepo.find();
    add("Repository", "ok", repo.root);
  } catch {
    add("Repository", "warn", "this folder is not a Craton repository", "Run craton clone owner/repo, or craton init, in the folder you work in.");
  }
  const url = repo?.config().remote ?? null;
  if (repo && !url) add("Remote", "warn", "no remote set", "craton remote add origin http://host:4000/owner/repo");
  let remote: { server: string; owner: string; name: string } | null = null;
  if (url) {
    try {
      remote = parseRemote(url);
      add("Remote", "ok", url);
    } catch (e) {
      add("Remote", "fail", (e as Error).message, "craton remote add origin http://host:4000/owner/repo");
    }
  }
  if (remote) {
    // Server reachable, and whether our clock agrees with it (tokens and signed links have expiry times).
    let reachable = false;
    try {
      const t0 = Date.now();
      const res = await fetch(`${remote.server}/v1/health`);
      const body = (await res.json()) as { time?: string; version?: string; apiVersion?: number; minCliVersion?: string };
      reachable = res.ok;
      const skew = body.time ? Math.abs(Date.now() - Date.parse(body.time)) : 0;
      if (!res.ok) add("Server", "fail", `${remote.server} answered ${res.status}`, "Check the address, or ask whoever runs the server.");
      else add("Server", "ok", `${remote.server} answered in ${Date.now() - t0} ms${body.version ? `; Craton ${body.version}, API ${body.apiVersion ?? "?"}` : ""}`);
      if (res.ok && body.minCliVersion && olderThan(CLI_VERSION, body.minCliVersion)) add("CLI version", "warn", `this CLI is ${CLI_VERSION}; the server expects ${body.minCliVersion} or newer`, "Update the CLI (git pull, then npm install in backend).");
      else if (res.ok) add("CLI version", "ok", CLI_VERSION);
      if (reachable && skew > 5 * 60_000) add("Clock", "warn", `this machine is ${Math.round(skew / 60_000)} minutes off the server`, "Set the system clock automatically.");
    } catch (e) {
      add("Server", "fail", `can’t reach ${remote.server}: ${networkReason(e)}`, "Check the address and your connection (VPN, proxy).");
    }
    const token = tokenFor(remote.server);
    if (reachable) {
      if (!token) add("Sign-in", "warn", "no token for this server (public repositories can still be read)", `craton auth login --token <token> --server ${remote.server}`);
      else {
        const who = await fetch(`${remote.server}/v1/user`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
        if (who?.ok) add("Sign-in", "ok", `signed in as ${((await who.json()) as { handle: string }).handle}`);
        else add("Sign-in", "fail", "the saved token was not accepted", "Create a new token in Settings → Personal access tokens, then craton auth login.");
      }
      const res = await fetch(`${remote.server}/v1/repos/${remote.owner}/${remote.name}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }).catch(() => null);
      if (!res) add("Repository access", "fail", "request failed");
      else if (res.status === 404) add("Repository access", "fail", `${remote.owner}/${remote.name} was not found, or you can’t see it`, "Check the name, and that your token belongs to someone with access.");
      else if (res.ok) {
        const info = (await res.json()) as { access?: string; sizeBytes?: number };
        const canWrite = info.access === "write" || info.access === "admin";
        add("Repository access", canWrite ? "ok" : "warn", `${remote.owner}/${remote.name}: ${info.access ?? "read"}`, canWrite ? undefined : "You can read this repository but not push to it; ask for write access.");
        // Room for the data: the working copy plus the staging cache.
        if (repo && typeof info.sizeBytes === "number") {
          try {
            const st = fs.statfsSync(repo.root);
            const free = Number(st.bavail) * Number(st.bsize);
            if (free < info.sizeBytes * 1.2) add("Disk space", "warn", `${formatBytes(free)} free, the repository is ${formatBytes(info.sizeBytes)}`, "Free some space, or clone only the folders you need: craton clone --only terrain/");
            else add("Disk space", "ok", `${formatBytes(free)} free for a ${formatBytes(info.sizeBytes)} repository`);
          } catch {}
        }
      } else add("Repository access", "fail", `the server answered ${res.status}`);
    }
  }

  if (asJson) {
    out(JSON.stringify({ ok: rows.every((r) => r.status !== "fail"), checks: rows }, null, 2));
  } else {
    const width = Math.max(...rows.map((r) => r.check.length));
    for (const r of rows) {
      out(`${r.status === "ok" ? "ok  " : r.status === "warn" ? "warn" : "FAIL"}  ${r.check.padEnd(width)}  ${r.detail}`);
      if (r.fix) out(`      ${" ".repeat(width)}  -> ${r.fix}`);
    }
  }
  if (rows.some((r) => r.status === "fail")) process.exitCode = 1;
}

function help() {
  // `craton help <command>` and `craton <command> --help` both give that command's options and an example.
  const target = argv[0] === "help" ? rest[0] : argv.find((a) => !a.startsWith("-") && a !== "help");
  if (target === undefined) return out(listText());
  const doc = commandDoc(target === "checkout" ? "switch" : target);
  if (!doc) {
    process.stderr.write(`craton: no command called ${target}. Run \`craton help\` for the list.${String.fromCharCode(10)}`);
    process.exitCode = 2;
    return;
  }
  out(detailText(doc));
}

/**
 * craton webhook verify ...   The check a receiver should make, for debugging one: HMAC-SHA256 over
 * "<id>.<timestamp>.<raw body>" keyed with the secret's base64-decoded bytes, in constant time, with a fresh timestamp.
 */
async function cmdWebhook() {
  if (rest[0] !== "verify") throw new CliError("Usage: craton webhook verify --secret S --id ID --timestamp T --signature SIG [--body-file F]");
  rest.shift();
  const secret = opt("secret"), id = opt("id"), timestamp = opt("timestamp"), signature = opt("signature"), bodyFile = opt("body-file");
  const tolerance = Number(opt("tolerance") ?? 300);
  if (!secret || !id || !timestamp || !signature) throw new CliError("Usage: craton webhook verify --secret S --id ID --timestamp T --signature SIG [--body-file F]");
  const body = bodyFile ? fs.readFileSync(bodyFile, "utf8") : fs.readFileSync(0, "utf8");
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = Buffer.from("v1," + createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64"));
  const matches = signature.split(" ").some((s) => {
    const given = Buffer.from(s);
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches) {
    out("invalid: none of the signatures matches. Check the secret, that the body is exactly what was received, and the id and timestamp.");
    process.exitCode = 1;
    return;
  }
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (tolerance > 0 && !(age <= tolerance)) {
    out(`invalid: the signature is right but the timestamp is ${Math.round(age)} seconds off (limit ${tolerance}); a receiver should refuse a replay.`);
    process.exitCode = 1;
    return;
  }
  out("valid");
}

async function cmdCompletion() {
  const shell = rest[0] as Shell | undefined;
  if (!shell || !SHELLS.includes(shell)) throw new CliError(`Usage: craton completion ${SHELLS.join("|")}`);
  out(completionScript(shell));
}

const commands: Record<string, () => Promise<void>> = {
  init: cmdInit,
  remote: cmdRemote,
  auth: cmdAuth,
  add: cmdAdd,
  status: cmdStatus,
  commit: cmdCommit,
  log: cmdLog,
  push: cmdPush,
  clone: cmdClone,
  pull: () => withLocks(cmdPull),
  branch: cmdBranch,
  switch: () => withLocks(cmdSwitch),
  checkout: () => withLocks(cmdSwitch),
  revert: cmdRevert,
  fsck: cmdFsck,
  lock: cmdLock,
  unlock: cmdUnlock,
  locks: cmdLocks,
  stats: cmdStats,
  diff: cmdDiff,
  blame: cmdBlame,
  sparse: cmdSparse,
  doctor: cmdDoctor,
  completion: cmdCompletion,
  webhook: cmdWebhook,
  help: async () => help(),
};

const run = commands[cmd];
if (!run) {
  help();
  process.exitCode = 2;
} else {
  run().catch((err) => {
    process.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    // 2 is a usage mistake (wrong arguments), 1 is anything that went wrong while doing the job.
    process.exitCode = err instanceof Error && /^Usage:/.test(err.message) ? 2 : 1;
  });
}
