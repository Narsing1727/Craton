// Download a repository (or one folder) at a commit as a ZIP, without installing the CLI.
//
// Streamed straight from the chunk store, one chunk at a time, so memory use is a chunk, not a
// file. Files are stored, not deflated: geodata (GeoTIFF, LAZ, GeoPackage, HDF5) is mostly
// compressed already, and storing keeps every size known up front, so the exact Content-Length can
// be sent and a browser shows real progress. Sizes use plain ZIP; past its limits the caller is
// told to use the CLI instead of being handed a corrupt archive.

import zlib from "node:zlib";
import type { Ctx } from "./context.ts";
import { ApiError, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { readChunk } from "./chunks.ts";
import { getObject, resolveRef } from "./history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";

const ZIP_LIMIT = 0xffffffff; // 4 GiB − 1: the most a 32-bit ZIP field can hold
const MAX_ENTRIES = 0xffff;

type Entry = { name: Buffer; blob: BlobObject; size: number };

/** DOS date and time, which is all ZIP can store (even seconds, 1980 onwards). */
function dosTime(iso: string) {
  const d = new Date(iso);
  const t = Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1980 ? new Date(Date.UTC(1980, 0, 1)) : d;
  return {
    time: (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | (t.getUTCSeconds() >> 1),
    date: ((t.getUTCFullYear() - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate(),
  };
}

function localHeader(name: Buffer, time: number, date: number) {
  const h = Buffer.alloc(30 + name.length);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4); // version needed
  h.writeUInt16LE(0x0808, 6); // sizes follow the data; names are UTF-8
  h.writeUInt16LE(0, 8); // stored
  h.writeUInt16LE(time, 10);
  h.writeUInt16LE(date, 12);
  // crc and both sizes: 0, given in the descriptor after the data
  h.writeUInt16LE(name.length, 26);
  name.copy(h, 30);
  return h;
}

function descriptor(crc: number, size: number) {
  const d = Buffer.alloc(16);
  d.writeUInt32LE(0x08074b50, 0);
  d.writeUInt32LE(crc >>> 0, 4);
  d.writeUInt32LE(size, 8);
  d.writeUInt32LE(size, 12);
  return d;
}

function centralEntry(name: Buffer, time: number, date: number, crc: number, size: number, offset: number) {
  const c = Buffer.alloc(46 + name.length);
  c.writeUInt32LE(0x02014b50, 0);
  c.writeUInt16LE((3 << 8) | 20, 4); // made by: Unix, spec 2.0 (so the permission bits below are read)
  c.writeUInt16LE(20, 6);
  c.writeUInt16LE(0x0808, 8);
  c.writeUInt16LE(0, 10);
  c.writeUInt16LE(time, 12);
  c.writeUInt16LE(date, 14);
  c.writeUInt32LE(crc >>> 0, 16);
  c.writeUInt32LE(size, 20);
  c.writeUInt32LE(size, 24);
  c.writeUInt16LE(name.length, 28);
  c.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // a regular file, rw-r--r--
  c.writeUInt32LE(offset, 42);
  name.copy(c, 46);
  return c;
}

export function planArchive(ctx: Ctx, repo: RepoRow, ref: string, folder = "") {
  const commitId = resolveRef(ctx, repo, ref);
  const commit = getObject<CommitObject>(ctx, repo, commitId, "commit");
  const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");

  const dir = folder.replace(/^\/+|\/+$/g, "");
  if (dir.split("/").some((part) => part === ".." || part === ".")) throw new ApiError(400, "bad_request", "That folder path isn’t valid.");
  const inside = dir ? tree.entries.filter((e) => e.path.startsWith(`${dir}/`)) : tree.entries;
  if (!inside.length) throw notFound(dir ? `Folder ${dir}` : "Files in this commit");

  const root = dir ? dir.split("/").pop()! : `${repo.name}-${commitId.slice(0, 7)}`;
  const entries: Entry[] = inside.map((e) => ({
    name: Buffer.from(`${root}/${dir ? e.path.slice(dir.length + 1) : e.path}`, "utf8"),
    blob: getObject<BlobObject>(ctx, repo, e.blob, "blob"),
    size: e.size,
  }));

  const total = entries.reduce((n, e) => n + e.size, 0);
  if (entries.length > MAX_ENTRIES || total > ZIP_LIMIT || entries.some((e) => e.size > ZIP_LIMIT)) {
    throw new ApiError(413, "too_large", "This is too large for a ZIP (over 4 GB or 65,535 files). Download it with the CLI instead: craton clone.");
  }

  // Every size is known, so the archive's exact length is too.
  const length = entries.reduce((n, e) => n + 30 + e.name.length + e.size + 16 + 46 + e.name.length, 0) + 22;
  return { commitId, filename: `${root}.zip`, timestamp: commit.timestamp, entries, length };
}

/**
 * One ZIP of the default branch of each repository a person owns (a folder per repository), for the account data
 * export. Empty repositories are skipped. Over the ZIP limits it refuses and points to the CLI, like any archive.
 */
export function planAccountBundle(ctx: Ctx, repos: RepoRow[], handle: string) {
  const parts: ReturnType<typeof planArchive>[] = [];
  for (const repo of repos) {
    try {
      parts.push(planArchive(ctx, repo, repo.default_branch));
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) continue; // nothing committed yet
      throw err;
    }
  }
  if (!parts.length) throw new ApiError(404, "not_found", "You don’t personally own a repository with files in it. Organization repositories stay with the organization; download them from their own pages.");
  const prefix = Buffer.from(`${handle}/`, "utf8");
  const entries = parts.flatMap((p) => p.entries.map((e) => ({ ...e, name: Buffer.concat([prefix, e.name]) })));
  const total = entries.reduce((n, e) => n + e.size, 0);
  if (entries.length > MAX_ENTRIES || total > ZIP_LIMIT) {
    throw new ApiError(413, "too_large", "Your repositories are too large for one ZIP (over 4 GB or 65,535 files). Download them one at a time, or with the CLI: craton clone.");
  }
  const length = entries.reduce((n, e) => n + 30 + e.name.length + e.size + 16 + 46 + e.name.length, 0) + 22;
  const timestamp = parts.map((p) => p.timestamp).sort().at(-1)!;
  return { commitId: "", filename: `craton-${handle}-repositories.zip`, timestamp, entries, length };
}

/** The archive as a byte stream. Stops reading chunks as soon as the consumer goes away. */
export function archiveStream(ctx: Ctx, plan: ReturnType<typeof planArchive>): ReadableStream<Uint8Array> {
  const { time, date } = dosTime(plan.timestamp);
  const central: Buffer[] = [];
  let offset = 0;
  let index = 0;
  let file: { entry: Entry; next: number; crc: number; start: number } | null = null;
  let finished = false;

  const emit = (controller: ReadableStreamDefaultController<Uint8Array>, buf: Buffer) => {
    offset += buf.length;
    controller.enqueue(new Uint8Array(buf.buffer, buf.byteOffset, buf.length));
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (file) {
          const { entry } = file;
          if (file.next < entry.blob.chunks.length) {
            const data = await readChunk(ctx, entry.blob.chunks[file.next].hash);
            file.crc = zlib.crc32(data, file.crc);
            file.next++;
            emit(controller, data);
            return;
          }
          emit(controller, descriptor(file.crc, entry.size));
          central.push(centralEntry(entry.name, time, date, file.crc, entry.size, file.start));
          file = null;
          return;
        }
        if (index < plan.entries.length) {
          const entry = plan.entries[index++];
          file = { entry, next: 0, crc: 0, start: offset };
          emit(controller, localHeader(entry.name, time, date));
          return;
        }
        if (!finished) {
          finished = true;
          const cdStart = offset;
          for (const c of central) emit(controller, c);
          const cdSize = offset - cdStart;
          const end = Buffer.alloc(22);
          end.writeUInt32LE(0x06054b50, 0);
          end.writeUInt16LE(central.length, 8);
          end.writeUInt16LE(central.length, 10);
          end.writeUInt32LE(cdSize, 12);
          end.writeUInt32LE(cdStart, 16);
          emit(controller, end);
          return;
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

/** One file's bytes as a stream, a chunk at a time, so a large file never sits in memory whole. */
export function blobStream(ctx: Ctx, blob: BlobObject): ReadableStream<Uint8Array> {
  let next = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (next >= blob.chunks.length) return controller.close();
      try {
        const data = await readChunk(ctx, blob.chunks[next++].hash);
        controller.enqueue(new Uint8Array(data.buffer, data.byteOffset, data.length));
      } catch (err) {
        controller.error(err);
      }
    },
  });
}
