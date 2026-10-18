# Craton backend

The API, storage engine, checks runner and CLI behind Craton. TypeScript on Node.js 23.6+
(run directly with type stripping, no build step), Hono for HTTP, SQLite (`node:sqlite`) for
metadata, and a content-addressed chunk store on local disk or Cloudflare R2.

## Run it

```sh
npm install
npm run seed          # demo users, orgs and 6 repositories; writes ../frontend/.env.local
npm start             # API on http://localhost:4000/v1
npm test              # 43 tests: engine, parsers, API, onboarding, and the real CLI against a real server
```

Then start the frontend (`cd ../frontend && npm run dev`) and sign in, or sign up to see the
first-run flow. It reads `CRATON_API_URL` from `.env.local` and falls back to demo data when the
API isn't running. Password reset links are printed in this server's log (no email service yet).

- `npm run seed -- --reset` wipes `data/` and seeds again.
- `npm run dev` restarts on file changes.
- `npm run typecheck` type-checks without emitting.

Demo accounts: `priyam`, `arunn`, `sarat`, `vikramr`, password `craton-demo-2026`.

## Configuration

Everything is in [`src/config.ts`](src/config.ts) and can be overridden with environment variables.

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4000` | HTTP port |
| `CRATON_DATA_DIR` | `data/` | SQLite database and local chunk store |
| `CRATON_CORS_ORIGINS` | `http://localhost:3100` | Comma-separated browser origins |
| `CRATON_WEB_URL` | `http://localhost:3100` | Where the web app lives, for password reset links |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | unset | When all four are set, chunks go to Cloudflare R2 instead of disk |

The three product decisions (plan limits, byte-identical storage, dedup scope) are single
settings in the same file; see [`../DECISIONS.md`](../DECISIONS.md).

## How it works

**Chunking and storage.** Files are split with FastCDC (32 KB min, 128 KB average, 512 KB max),
so an edit in the middle of a 2 GB DEM changes only the chunks around it. Each chunk is
addressed by its SHA-256 and compressed with zstd, kept only if it decompresses back to the
same bytes (otherwise stored raw). Storage is lossless and byte-identical: a clone's SHA-256
matches the original.

**Objects.** Git-like blob, tree and commit objects, identified by the SHA-256 of their
canonical JSON. A commit carries the Merkle root of its tree (domain-separated leaves), and the
audit endpoint returns an inclusion proof for every file.

**Trust nothing from the client.** On push the server recomputes object IDs, sizes and Merkle
roots, and refuses any blob that names a chunk it doesn't have.

**Privacy-safe dedup.** "Which chunks do you already have?" is answered only for chunks the
caller may see: public ones and their own owner's. Uploading a chunk that exists privately
elsewhere requires sending the bytes; it's then stored once physically but never revealed.

**Append-only history.** A branch moves only by fast-forward, and only if its tip is still the
one the client last saw (compare-and-swap). Every move is recorded in `ref_log`. Reverts are new
commits. Merges are fast-forward or three-way at file level; binary GIS files that changed on
both sides are reported as conflicts rather than merged.

**Checks.** Every push to a branch tip runs six checks, reading only the bytes each needs from
stored chunks: coordinate reference system (GeoTIFF GeoKeys, shapefile `.prj` WKT), vertical
datum, nodata value, complete shapefile sets, HEC-RAS plan references, and chunk integrity
(full-file SHA-256 plus Merkle recompute). With branch protection on, failing checks or a
missing approval block the merge.

## Layout

```
src/
  api/app.ts          REST API (Hono), mounted at /v1: 61 routes
  core/               FastCDC, zstd, Merkle trees, objects and diffs, data-type detection
  db/db.ts            SQLite schema and migrations
  storage/            Chunk stores: memory, local disk (atomic rename), R2 (hand-written SigV4)
  services/           Accounts, repos, chunks, history, collaboration, releases, stats,
                      activity, per-file detail
  checks/             GeoTIFF/BigTIFF reader, shapefile and WKT helpers, the checks runner
  cli/                The `craton` CLI
  dev/                Fixture generators (real GeoTIFF, shapefile, HEC-RAS files) and seed helpers
scripts/seed.ts       Demo data
test/                 node:test suites
```

## CLI

```sh
npm link              # exposes `craton`; or run `npm run craton -- <command>`
craton auth login --token <token> --server http://localhost:4000
craton clone hydrolab/chalakudy-basin            # or --tag v1.2.0 for a release
craton add . && craton commit -m "Re-survey the right bank"
craton push                                      # uploads only chunks the server lacks
craton help
```

Commands: `init`, `remote`, `auth`, `clone`, `add`, `status`, `commit`, `log`, `push`, `pull`,
`branch`, `switch`, `revert`, `fsck`, `lock`, `unlock`, `locks`, `diff`, `stats`, `sparse`
(`clone --only terrain/` for a partial working folder). `npm run mcp` starts a read-only MCP server
for assistants (`CRATON_SERVER`, `CRATON_TOKEN`). The CLI skips lock files and waits until a file's size and
modification time are stable before reading it, so it never snapshots a file HEC-RAS is still
writing. Network failures and 5xx responses are retried with backoff.

## Checking everything

`node scripts/verify.mjs` from the `Craton` folder runs the backend and frontend tests and typechecks and, when the API and web app
are up, the route sweep at three widths, the keyboard walk and the contrast scan, then prints one table. `--fast` skips the ones that
need the servers.

## API

The full endpoint list is in the web app at `/api-reference`. Errors always look like
`{ "error": { "code": "stale_ref", "message": "…" } }`. Private repositories you can't read
answer 404, never 403.
