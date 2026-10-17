// `craton lock`, `unlock` and `locks`: file locks from the command line, where people edit files.
//
// A lock tells everyone else "I'm editing this; don't push a change to it". Files someone else
// has locked are made read-only in the working copy, so a save from QGIS, ArcGIS or HEC-RAS can't
// quietly start a change the server will refuse; they are made writable again when the lock goes.

import fs from "node:fs";
import path from "node:path";
import { CliError, LocalRepo, handleFor, parseRemote } from "./local.ts";
import { Remote } from "./remote.ts";

export type RemoteLock = { path: string; reason: string; holder: string; lockedAt: string };

const recordFile = (repo: LocalRepo) => path.join(repo.dir, "readonly.json");

function recorded(repo: LocalRepo): string[] {
  try {
    return JSON.parse(fs.readFileSync(recordFile(repo), "utf8")) as string[];
  } catch {
    return [];
  }
}

function setMode(repo: LocalRepo, rel: string, mode: number) {
  try {
    const abs = repo.abs(rel);
    if (fs.existsSync(abs)) fs.chmodSync(abs, mode);
  } catch {
    // A file we can't change the mode of is still protected by the server's check.
  }
}

/** Make every file this tool previously marked read-only writable again, and forget them. */
export function releaseReadOnly(repo: LocalRepo) {
  for (const rel of recorded(repo)) setMode(repo, rel, 0o644);
  fs.rmSync(recordFile(repo), { force: true });
}

/** Read-only for what others hold; writable again for what was released. Returns the paths now protected. */
export function applyLocks(repo: LocalRepo, locks: RemoteLock[], me: string): string[] {
  const now: string[] = [];
  for (const l of locks) {
    if (l.holder === me || !fs.existsSync(repo.abs(l.path))) continue;
    setMode(repo, l.path, 0o444);
    now.push(l.path);
  }
  for (const rel of recorded(repo)) if (!now.includes(rel)) setMode(repo, rel, 0o644);
  if (now.length) fs.writeFileSync(recordFile(repo), JSON.stringify(now));
  else fs.rmSync(recordFile(repo), { force: true });
  return now;
}

export function whoAmI(remoteUrl: string) {
  return handleFor(parseRemote(remoteUrl).server);
}

/** A path typed on the command line, as the repository path the server knows it by. */
export function repoPathOf(repo: LocalRepo, arg: string) {
  const rel = repo.rel(path.resolve(arg));
  if (!rel || rel === ".." || rel.startsWith("../") || path.isAbsolute(rel)) throw new CliError(`${arg} is outside this repository.`);
  return rel;
}

const encodePath = (p: string) => p.split("/").map(encodeURIComponent).join("/");

export async function lockCommand(repo: LocalRepo, remote: Remote, me: string, args: { target?: string; reason: string }, out: (s?: string) => void) {
  if (!args.target) throw new CliError('Usage: craton lock <path> [--reason "why"]');
  const rel = repoPathOf(repo, args.target);
  const lock = await remote.request<RemoteLock>("POST", "/locks", { path: rel, reason: args.reason });
  out(`Locked ${rel}${lock.reason ? ` (${lock.reason})` : ""}. Others can still read it, but can’t push a change to it. Release it with \`craton unlock ${rel}\`.`);
  applyLocks(repo, await remote.request<RemoteLock[]>("GET", "/locks"), me);
}

export async function unlockCommand(repo: LocalRepo, remote: Remote, me: string, args: { target?: string; force: boolean }, out: (s?: string) => void) {
  if (!args.target) throw new CliError("Usage: craton unlock <path> [--force]");
  const rel = repoPathOf(repo, args.target);
  await remote.request("DELETE", `/locks/${encodePath(rel)}${args.force ? "?force=true" : ""}`);
  out(`Unlocked ${rel}.`);
  applyLocks(repo, await remote.request<RemoteLock[]>("GET", "/locks"), me);
}

export async function listLocksCommand(repo: LocalRepo, remote: Remote, me: string, out: (s?: string) => void, asJson = false) {
  const locks = await remote.request<RemoteLock[]>("GET", "/locks");
  const protectedPaths = applyLocks(repo, locks, me);
  if (asJson) return out(JSON.stringify(locks.map((l) => ({ ...l, mine: l.holder === me })), null, 2));
  if (!locks.length) return out("No files are locked.");
  const width = Math.max(...locks.map((l) => l.path.length));
  for (const l of locks) {
    const note = l.holder === me ? "you" : `@${l.holder}`;
    out(`  ${l.path.padEnd(width)}  ${note}${l.reason ? `  ${l.reason}` : ""}`);
  }
  if (protectedPaths.length) out(`\n${protectedPaths.length} file${protectedPaths.length === 1 ? " is" : "s are"} read-only here while someone else holds the lock.`);
}
