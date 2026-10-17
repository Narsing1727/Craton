# Craton: product feature backlog

`ROADMAP.md` is about trust and launch-readiness; `GLOBAL_ROADMAP.md` is about speed and
infrastructure. This list is about **what people can do**: the features that make a hydro or GIS
team choose Craton over a shared drive, Git LFS, DVC or Kart. Each item says why, from what the
research found, and what "done" looks like.

`[x]` shipped · `[~]` partly shipped (what's left is noted) · `[ ]` not started.
Tags: `S` under a day · `M` a few days · `L` a week or more.

## A. Working on files that can't be merged

GIS and model files (file geodatabases, HEC-RAS HDF5/binary, `.mxd`/`.aprx`) can't be merged, and
Esri itself advises against editing a file geodatabase from a shared drive because two people editing
corrupts it. Git LFS and GitLab solved this with locks: one holder per path, only the holder (or a
maintainer) can release, and a lock icon next to the file.

- [x] **File locks.** `S` · Lock a path with an optional reason, see who holds it on the file page and in
      the file tree, release it (the holder, or an admin with force). A push or merge that changes a path
      locked by someone else is refused with the path and the holder named, including deleting it or
      editing it on a new branch. API: `GET/POST/DELETE /locks`. Left: lock badges in sub-folder listings,
      and the "Release lock" button only shows for the repository's owner (the web app doesn't know a
      viewer's per-repository role yet; the API enforces it either way).
- [x] **Display units.** `S` · Settings → Units: metric (m, m³) or imperial (ft, acre-ft). A cookie read in the root layout, so server-rendered
      pages already show the right unit; applies to the raster statistics card, change legends and preview captions. Display only: stored
      data, downloads and the API stay in the file's own units. Assumes raster elevations are metres, as the rest of the site does.
- [x] **Docs and policy text match behaviour.** `S` · The docs page no longer claims per-format chunking (every file is content-chunked; previews and
      diffs exist for GeoTIFF and shapefile), a 5,000-per-hour limit (it is 1,200 per minute), map-region comments, or webhook events that do not
      exist. Privacy and terms no longer promise an Enterprise region, overage billing, an export window or encryption the code does not
      provide. New task pages: HEC-RAS project, sharing a DEM, what changed in a DEM, team review, partial clones. Still wants a lawyer.
- [x] **Blame by chunk.** `M` · `GET /repos/:o/:r/blame/:ref/*`, `craton blame <path>` and a card on the file page: the commit that last
      rewrote each byte range, exact because files are content-chunked (first-parent walk, up to 500 commits). A re-surveyed strip of a
      DEM appears as its own range; a commit that did not touch the file owns none of it. Granularity is the chunk, about 128 KB.
- [x] **Code owners.** `M` · A `CODEOWNERS` file at the root of the target branch (`terrain/** @priyam @arjun`, last matching line wins, same
      patterns as lock rules). Opening a pull request asks the owners of the changed files to review (people without access, and the
      author, are skipped); `GET /pulls/:n/owners` lists each owner with their files and review state; shown on the pull request page.
      Also fixed: a trailing `**` (`dir/**`) matched nothing in lock patterns. Setting `requireOwnerReview` (Settings → Protection, migration 20):
      merging waits until each owner of a changed file has approved the *current* head (409 `owner_review_required`). Settings → Code owners edits the file in
      the browser with a server-side preview (files owned per person, names that aren't people here or can't see the repository, files nobody
      owns, lines that are not rules) and saves it as a commit on the default branch.
- [x] **Line diff for text files.** `M` · `GET /repos/:o/:r/text-diff/:ref/*?base=` and a diff on the commit, compare and pull request pages for
      changed model and config files (`.p01 .g01 .u01 .inp .md .json .yml .prj` and similar): Myers' shortest edit script on lines, three
      lines of context, old and new line numbers. Refuses binaries (415), files over 1 MB or 20,000 lines. Tested by rebuilding the new text
      from the hunks and by checking the script is a shortest one on 300 random inputs; on the demo history it shows a Manning's n change
      as one removed and one added line. The file page has a "Change since" view for text files, and `craton diff --text <path>`
      prints the same hunks in the terminal.
- [x] **Request ceilings.** `S` · JSON bodies are read through a 16 MB limit and chunk uploads through the chunk maximum, whether or not the
      client declared a length (before, a chunked body had no ceiling). Over-limit answers 413 `too_large`. `test/hardening.test.ts` also
      probes path traversal in raw, file, render, archive and tree routes and the shape of every error.
- [x] **Reduced motion and zoom.** `S` · A global `prefers-reduced-motion` rule (no transitions, one-shot animations, no smooth scroll);
      no running animations were found on the dashboard, repository or pull request pages in either mode. 200% zoom is a 640 px window:
      `CRATON_WIDTH=640 npm run sweep` is clean on all 54 routes, as is 390 px.
- [x] **Many small files.** `S` · Measured on a folder of 5,000 small files: `status` 1.8 s, a no-change `add` 0.3 s. First `add` was 26 s; CPU
      work in it dropped about 11x by reading small files in one call instead of a stream and walking directories with typed entries.
      The remaining time on this Windows machine is file creation (two files per small file, slowing after the first few hundred, which
      looks like real-time antivirus scanning of new files, not Craton). Staged chunks are now written to one pack file per `add`
      (with an index; loose files still read) instead of one file each: the first `add` of 5,000 small files went from about 26 s to 9 to 13 s and
      leaves 2 files in `.craton/pending` instead of 5,000. The checkout cache stays loose so an interrupted clone keeps what arrived.
      `craton fsck` also checks the staging cache (missing or short packs, a deep re-hash with `--verify`) and names unused packs.
- [x] **Contrast scan.** `S` · `npm run contrast` measures every visible text run against its real background (composited through
      translucent ancestors; image and gradient backgrounds skipped) on 17 pages in both themes, against WCAG AA 4.5:1 and 3:1 for large
      text. Clean at the time of writing; the scanner was checked against known-bad colours.
- [x] **Keyboard and structure walk.** `S` · `npm run focus` Tabs through 16 pages as the demo user and reports focused elements with no visible
      indicator (ring, underline, fill, or a row ring on ::after), focus that stops moving, controls without a name, fields without a label,
      images without alt, duplicate ids and pages without exactly one h1. Clean at the time of writing.
- [x] **Phone-width sweep.** `S` · `CRATON_WIDTH=390 npm run sweep` visits every route in a phone-sized window and reports any page wider
      than it, naming the widest element outside a scroller. First run found the repository and file toolbars not wrapping; fixed.
- [x] **Python client.** `S` · `sdk/python/craton.py`, one file, stdlib only: `Craton(server, token).repo(o, n)` with `releases`, `commits`,
      `compare`, `paths`, `file_info`, `read`, `text`, `table` (CSV to dicts), `raster_stats`; `CratonError` carries the API's code. Writes: `create_issue`, `create_release`,
      `lock`, `unlock` (and a general `client.send`); files themselves still go through the CLI.
      Tested through the CLI suite against the real server. `commits()` takes `since`, `until`, `author`, `offset`; `all_commits()` pages
      through a whole history; `rows()` streams a CSV one row at a time. The API's `/commits` gained the same filters. `pip install ./sdk/python` (`craton-client`,
      `pyproject.toml`, README, no dependencies; metadata and import tested). Left: fsspec filesystem, publishing to PyPI.
- [x] **Resumable clone.** `S` · A checkout caches each verified chunk in `.craton/fetched` as it arrives and removes its temp files on
      failure; `craton clone` into the unfinished folder resumes (same remote, no branch tip yet) and clears the cache when done.
      Tested with `CRATON_FAIL_AFTER_CHUNKS`, a hook that drops the connection after N chunks.
- [x] **Titles and wording.** `S` · The route sweep now fails when two pages share a tab title or one falls back to the site's default; it
      found six (new organization, a repository's issues, pull requests and tags, help, terms), now titled. The CLI says what could be
      behind a "not found" for a repository you cannot see: sign in first if you sent no token, or check access and run `craton doctor`.
- [x] **`craton help <command>`.** `S` · One table (`src/cli/commands.ts`) holds each command's usage, options, example and notes; `craton help`,
      `craton help <command>` and `craton <command> --help` print from it, and tests fail if the dispatch table, the table, or the website's
      CLI page disagree about which commands exist. `craton completion bash|zsh|powershell` prints a completion script built from the same
      table (command names, then that command's long options); the bash one is driven in a test.
- [ ] **Consistent field names.** `S` · The token list answers with `created_at`, `expires_at`, `last_used_at` and a comma-separated `scopes`
      string, and the refs list uses `commit_id` and `updated_at`, while everything else is camelCase with arrays. The response schemas
      describe them as they are (a test checks); changing them is a breaking change for scripts, so it wants an API version first.
- [x] **First-load speed measured.** `S` · On a production build (second build beside the dev one: `CRATON_DIST_DIR=.next-prod`, added to
      `next.config.mjs`), signed in as the demo user and warm, 14 routes answered in 11 to 21 ms to first byte and 11 to 66 ms in total (the
      API reference is the largest at 347 KB). Nothing was near 1 s. The only slow first load seen is the development server compiling a page
      the first time (about 10 s for the API reference); `verify.mjs` now warms those pages before the browser steps.
- [x] **Dead receivers pause.** `S` · After ten finished deliveries in a row fail (each already retried six times with backoff) Craton pauses the
      webhook, records why (`pausedReason`, shown on the page), and emails the repository's admins once (migration 22). Resuming from Settings
      clears the reason. Tested with a failing receiver, including that nothing more is delivered while paused.
- [x] **Delivery strip.** `S` · Each webhook on Settings → Webhooks shows its last ten deliveries as small marks (delivered, retrying, failed; title
      with the event, response code and age) and the same in words ("8 of the last 10 delivered, 2 failed"), so a broken receiver is
      visible without opening the log. Not rendered in the demo data, which has no webhooks; type-checked and the page passes the sweep.
- [x] **Receiving webhooks.** `S` · `WEBHOOKS.md`: the three headers, how the signature is computed, and receiver snippets in Node.js and
      Python that the tests run against a real signed delivery (accept a genuine one, refuse a tampered one); `craton webhook verify` does
      the same check from the terminal (wrong body, wrong secret, stale timestamp, rotated signatures, tested).
- [x] **Webhook payloads documented from the code.** `S` · `GET /v1/webhook-events` returns each event's fields from one table (`EVENT_DOCS`), shown
      on the API reference. A test subscribes to every event, triggers each action (push by upload, a pull request opened, merged and closed, a
      release, an issue opened, closed and reopened, a lock taken, released and force-released) and checks the delivered fields are exactly the
      documented ones.
- [x] **More webhook events.** `S` · `issue` (opened, closed, reopened; editing the text is not an event) and `lock` (locked, unlocked, with who and
      whether forced), beside push, pull_request and release. Selectable in Settings → Webhooks, listed in the API reference, delivered once
      and signed (tested).
- [x] **One command to check everything.** `S` · `node scripts/verify.mjs` (from `Craton`): backend and frontend tests and typechecks, then, if
      the API and web app answer, the route sweep at 1280, 640 and 390 px, the keyboard walk and the contrast scan; a summary table and one
      exit code. `--fast` runs tests and typechecks only; `--only <text>` picks steps. All nine steps pass at the time of writing (about
      six minutes).
- [x] **Parameters and bodies on the API reference.** `S` · Each endpoint that has query parameters or a request body shows them (name, type,
      required, meaning, an example body) folded under it, read from `/v1/openapi.json` so there is one source; the sentences remain if
      the API is down.
- [x] **Documentation pages in the accessibility scans.** `S` · `npm run focus` and `npm run contrast` now also cover docs, CLI, API reference,
      pricing, help, changelog, about, security, terms, privacy and contact. First run found three: the API reference's code block had a copy
      button with no name and a file-name strip at 1.36:1 (muted text on the blue secondary colour), and Help's search box had no label.
- [x] **A complete API reference.** `S` · Every endpoint the page lists is a route the server has, and every route the server has is on the page
      (apart from health, readiness, the OpenAPI document and the dev outbox): a test compares them in both directions. It found 26 routes
      missing (sign-out and password reset, profile and sessions, account and organization export, stars, trending, render, restore) and
      one note that named the wrong field; all added or corrected.
- [x] **Documented commands are real.** `S` · A test reads every `craton ...` line shown on the docs, CLI, home, about and help pages and in
      OPERATING.md and checks the command exists and each `--option` is one it takes (shown to fail on a bad line).
- [x] **Badge family.** `S` · Beside the checks badge: latest release, stored size and licence (`/badge/{release|size|license}.svg`), same
      style, public repositories only, anonymous and cacheable, also served from the web origin. The Checks page lists all four with copyable
      Markdown. Tested for words, escaping and privacy.
- [x] **Link previews.** `S` · A public repository's page carries Open Graph and Twitter tags and a generated 1200x630 image (name, description,
      data types, size, licence; neutral dark, no brand colours invented). A private or missing repository gets a plain Craton card that
      does not name it.
- [x] **Sitemap.** `S` · `/sitemap.xml`: the public pages and the public repositories the API lists for an anonymous visitor (never a private
      one, never a signed-in screen), named in `robots.txt` when `CRATON_SITE_URL` is set. Unit-tested; checked against the demo data, where
      the private internal repository is absent.
- [x] **Search and previews.** `S` · The sweep also checks that public pages carry a description and that signed-in screens are kept out of
      the index. `robots.txt` now also disallows new repository and organization forms, your issues and pull requests, stars, invitations,
      sign-in recovery pages and search results. Help and Terms gained descriptions.
- [x] **Web health.** `S` · `GET /api/health` on the web app: 200 when it reaches the API and `/v1/ready` says yes, 503 with the API's status
      and latency otherwise (checked with the API stopped). In OPERATING.md.
- [x] **Reserved names.** `S` · Nobody could be called `dashboard`, `settings` or `api` (their profile would sit behind the page of that name), and
      anyone could register `ghost`, which deleted accounts' conversations are kept under. `RESERVED_HANDLES` covers every top-level page
      of the web app plus names that read as the service or its staff, for people and organizations; a test fails when a new top-level page
      is added without reserving it.
- [x] **Access log.** `S` · `CRATON_ACCESS_LOG=1`: one JSON line per API request on standard output (time, method, route pattern, status, ms,
      request id, handle). Route patterns, not names; never bodies, query strings or tokens. Tested, and in OPERATING.md.
- [x] **Readiness probe.** `S` · `GET /v1/ready`: database answers and a probe chunk is written, read back and removed from the store (503 with
      the failing part named; cached five seconds). `/v1/health` stays the cheap liveness check. Documented in OPERATING.md.
- [x] **craton doctor.** `S` · One line per check with its fix: Node version, remote, server reachable and clock skew, token accepted and whose,
      access level on the repository, free disk against its size. `--json`; exit 1 only when something is broken. Tested against a real
      server with a good token, a bad one and outside a repository. `/v1/health` now reports `version`, `apiVersion` and
      `minCliVersion`; doctor shows them and warns when the CLI is older than the server expects.
- [x] **Dictionary editor.** `S` · On a table or shapefile page, writers open "Edit descriptions", fill a unit and a meaning per column and save a
      commit of `.craton-dictionary.json` on the branch they are viewing (`withEdits` keeps other files and columns, drops emptied entries; the
      default branch's head is sent so a change made meanwhile is refused).
- [x] **Release notes draft.** `S` · The New release page's Generate button now lists the commits since the previous release and the files they
      touched, with how much of each changed file was rewritten (`lib/releasenotes.ts`, unit-tested). A draft to edit; never published as is.
- [x] **JSON from the CLI.** `S` · `--json` on `status`, `log` (branch or file), `branch`, `locks`, `diff`, `stats` and `blame`, so scripts and
      CI jobs need not parse text. `push --json` and `pull --json` print one event per line (`plan`, `upload` progress, `done`). Tested.
- [x] **File history in the CLI.** `S` · `craton log <path>` lists the commits that changed one file (from the server's file history); `-n`
      now works as the short option it was documented to be.
- [x] **OpenAPI document.** `S` · `GET /v1/openapi.json`: every path and method from the live route table, path parameters, bearer scheme
      and the shared error shape, plus hand-written response schemas for twenty endpoints (repos, commits, releases, refs, compare, raster
      statistics, pulls, user, health, issues, locks, tokens, usage, checks, file info, tree, paths, inbox count, sessions), checked against real responses by a test. Request bodies and working examples for six write endpoints (create repository, release, issue, pull request, review, lock), each
      example actually sent to the real endpoint by a test, and what comes back (the created repository, release, issue, pull request, lock;
      the review's pull request) is validated against its documented result.
- [x] **Sparse checkout.** `M` · `craton clone --only terrain/,gauges.csv` writes only those paths; the rest are index entries marked
      `absent`, so commits keep every file, `status` and `fsck` do not report them missing, and pull/switch record changes to them without
      downloading. `craton sparse add <paths>` / `all` widen it. Also fixed: push walked every older commit's tree, which a clone never has.
- [x] **Diff in the CLI.** `S` · `craton diff [from [to]]` (branch, `HEAD~N` or commit id): changed files with data type and
      chunks rewritten, from local history with no server round trip; `--json`.
- [x] **MCP server.** `M` · `npm run mcp` in `backend` (stdio, read only; `CRATON_SERVER`, `CRATON_TOKEN`). Tools: `craton_what_changed`
      (latest release to the default branch by default: commits, changed files with how much was rewritten, and for GeoTIFFs the change in
      cell values), `craton_list_releases`, `craton_list_files`, `craton_table_fit`, `craton_blame`, `craton_text_diff`, `craton_pull_owners`, `craton_raster_stats`. A failed call comes back as a readable result, not a protocol error.
- [x] **Statistics in the CLI.** `S` · `craton stats <raster.tif> [--base REF]` prints the same summary and change numbers as the website
      (the server computes them); `craton stats <table.csv> --obs C --sim C [--by C]` computes NSE, KGE, PBIAS and RMSE from the working
      file, per station when `--by` is given. `--json` for scripts. The fit code is one file shared with the website, guarded by a test.
- [x] **Locks in the CLI.** `S` · `craton lock`, `unlock`, `locks`; files locked by someone else turn
      read-only in the working copy (so a save from QGIS or HEC-RAS can't start a refused change) and
      writable again when released. `pull` and `switch` lift and re-apply it around their writes.
- [x] **Lock expiry and stale-lock nudges.** `S` · Locks report `ageDays` and `stale` (default 7 days, `CRATON_LOCK_STALE_DAYS`); the file page shows "Held for N days"; the holder gets an inbox reminder per stale lock (gone when released); repository settings list the locks held, oldest first, with Release for admins.
- [x] **Lockable patterns.** `S` · Settings → "Files that must be locked" (gitignore-style patterns). A direct push or upload that changes a matching file without holding its lock is refused with `lock_required`; merges and imports are not. The file page says "Lock required" (migration 15, 5 tests).
- [x] **Review requests.** `S` · Ask a specific person on the pull request page (writers; the person must be able to see the repository). They are emailed and get an inbox item until they review; asking again after a review starts a new request; Withdraw. (migration 19, 4 tests). Assignment of issues was already there.
- [ ] **Comments on a file, region or feature.** `L` · Pin a comment to a map location (Figma-style).
- [x] **@mentions and reactions.** `S` · Mentions reach the inbox. Comments on issues and pull requests can be reacted to (eight emoji, counted, with who reacted), edited by their author (marked "edited") and deleted by their author or a repository administrator.
- [ ] **Branch protection rulesets in the UI.** `M` · Required reviewers per path, not only per repo.

## B. Getting data out, and sharing it

- [x] **Download as ZIP.** `S` · The whole repository at any ref, or one folder, without installing the CLI.
      Streams from stored chunks; refuses over 4 GB with a pointer to the CLI instead of writing a
      broken archive.
- [x] **Expiring share links** for private data (a partner agency, a reviewer). `M` · Settings → Sharing makes a link
      that opens a read-only page with no account: the files, a map preview, a ZIP of everything, and a
      download (with its SHA-256) for each file. Drive-style, but safer by default: it is a **snapshot** of one
      commit (never silently shows newer work), it **expires** (1, 7, 30 or 90 days, never "forever"), only
      the token's hash is stored (shown once), and an expired, switched-off or invented link all answer
      identically. Up to 20 active per repository; each shows how often it was opened. The page is
      `noindex`, uncached, `Referrer-Policy: no-referrer`, and guessing tokens is throttled. Left: sharing one
      folder or file, "follow this branch" links, a password, and an email-it button.
- [ ] **Sparse clone** `craton clone --only terrain/`; Kart's spatial-filter clone is the model (only the
      features inside an area are fetched).
- [ ] **Export a folder as GeoPackage / GeoParquet.** `M`
- [x] **Public read-only tokens** scoped to one repository. · Access tokens can be limited to named repositories (checklist 6).
- [x] **Browser upload.** `M` · "Upload files" on the repository page: choose or drop files **or a whole folder** (relative
      paths kept), pick the destination folder, see which files will **replace** existing ones before committing,
      and commit straight to the branch or to a **new branch for review**. One commit comes out, with a real progress
      bar. It follows every rule a push does: plan limits, other people's file locks and the branch-moved check are
      all verified **before any byte is stored**, so a refused upload leaves nothing behind; unchanged files are
      skipped, and uploading only unchanged files says so instead of making an empty commit. Up to 100 MB and 200
      files (the dialog tells you to use `craton push` beyond that). API: `POST /upload`.
- [x] **Embed a preview.** Markdown, HTML and image address of a preview pinned to the commit that last changed the file ("Embed" on the file page; public repositories).

## C. Documenting and finding datasets

Hugging Face makes a dataset findable with a license, tags and a card at the top of the README;
ISO 19115 lists what a reuser needs before trusting a dataset: identification, extent, CRS, lineage,
licence. Craton already stores CRS, nodata and vertical datum.

- [x] **Licence.** `S` · A real choice from open-data licences (CC0, CC BY, CC BY-SA, ODbL, ODC-By, PDDL,
      OGL, MIT, Apache) or "All rights reserved"; shown on the repository and in the API.
- [x] **Topics.** `S` · Up to ten tags per repository, in settings, on the repository page, and as an
      Explore filter (`?topic=`).
- [x] **Cite this repository.** `S` · APA, BibTeX and `CITATION.cff` generated from real metadata (owner,
      name, licence, latest release, URL); uses the repository's own `CITATION.cff` when it has one.
      No DOI is invented.
- [ ] **Mint a DOI** for a release through Zenodo/DataCite. `M`
- [x] **Data dictionary.** `M` · Column descriptions and units live in `.craton-dictionary.json` at the repository root (versioned and reviewed with the data). A table's file page lists every column with its unit and meaning, flags the undescribed ones, and offers a starter file with the file's columns filled in as blanks. Shapefile attribute fields (from the dBase header, now also in file info) get the same table.
      preview, and diffed when the schema changes.
- [x] **Metadata completeness.** `S` · "Describe this data" checklist on the repository page for people who can write: description, licence, topics, README, vertical datum, nodata value, located data, a release; each missing item links to where to fix it (`lib/completeness.ts`, 4 tests).
- [~] **Where the data is.** `M` · Each GeoTIFF and shapefile gets a longitude/latitude box from its header (never its pixels),
      cached per file version; a repository's **footprint** is the box around its located files on the default branch, kept
      up to date on every push, merge and upload and backfilled at startup. Shown on the repository page ("10.21°N–10.40°N,
      75.91°E–76.41°E" with an Open in a map link) and per file. Handles geographic coordinates, Web Mercator and UTM for
      WGS 84, NAD83, ETRS89 and GDA94/2020 zones (the inverse is checked against an independent forward projection to
      under a millimetre); any other system is left unplaced rather than guessed, and a file with no CRS of its own uses the
      repository's. Left: an embedded map instead of an external link, other national grids, and CSV files with lat/lon columns.
- [x] **Spatial search.** `M` · Explore has a "Covers a place" box: type `10.3, 76.3` (or `10.3N 76.3E`) and it lists only
      public repositories whose data includes that point. API: `GET /repos?covers=lat,lon` and `?bbox=west,south,east,north`;
      private repositories only appear to people who can see them. Left: drawing a box on a map, and searching by place name
      (needs a geocoder).
- [x] **STAC catalog export** per release. `M` · `GET /repos/:o/:r/releases/:tag/stac/collection.json` and `.../items.json` (STAC 1.0.0, file extension): Collection with the repository's licence and the data's real extent, one Item per file with its box, media type, size and sha-256 as multihash `file:checksum` (4 tests).
- [x] **README / dataset card templates.** `S` · New-repository form: HEC-RAS model, DEM or terrain survey, rainfall or climate grids, GIS layers. Becomes the repository's first commit; fills in only what the repository declares (CRS, datum, nodata, licence) and leaves the rest as prompts. The old "Template" select, which created nothing, is gone.

## D. Reviewing changes properly

lakeFS sells "inspect, diff and restore any change"; Kart diffs at feature level. Craton diffs rasters
and shapefiles; tables and schemas are the gap.

- [x] **Table diff** for CSV and TSV. `M` · "Change since" on the file page: rows added, removed and corrected cell
      by cell with numeric deltas. Rows are matched by a key it finds itself (the first single, pair or triple of
      identifier columns that are unique in both versions and mostly shared), never a decimal measurement, so
      inserting a row at the top isn't a mass change; with no usable key it compares by position and says so.
      Quoted fields, other delimiters and a BOM are handled. API: `GET /table-diff/{ref}/{path}?base=`.
- [~] **Schema diff** for shapefile fields and CSV columns. `M` · CSV columns added and removed are shown in the
      table diff. Left: retyped columns, and shapefile (.dbf) fields.
- [x] **Raster statistics diff.** `S` · `GET /repos/:o/:r/raster-stats/:ref/*?base=`: summary of each version (min, 5th/50th/95th percentile, mean, max, nodata), a shared-range histogram, and the cell-by-cell change (mean, RMSE, share raised/lowered, volume for projected grids). Shown under every raster heatmap on commit, compare and pull request pages. Computed on the sampled grid the heatmap uses, and says so.
- [x] **CRS and nodata mismatch warning** when a changed file disagrees with the repository settings. `S` · Already part of every check run: the Coordinate reference system, Vertical datum and Nodata value steps compare each file with the repository's settings and name the files that disagree.
- [x] **Checks as code.** `L` · Built as `.craton-checks.json` at the repository root (the CLI owns `.craton/`).
- [x] **Restore a file to an earlier version.** `S` · From the file's history, "Restore" adds a commit that puts it
      back (the replaced version stays in history and can be restored again). Respects locks and write
      access; runs checks and webhooks like a push. API: `POST /restore`.
- [~] **File history.** `S` · The file page lists the commits that touched it, with View (that version) and
      Restore. Left: "compare with…" between any two versions, not only against the previous one.

## E. Automation and integrations

- [x] **Webhooks.** `M` · Per repository, for push, pull request and release events. Signed per the Standard
      Webhooks scheme (`webhook-id`, `webhook-timestamp`, HMAC-SHA256 over `id.timestamp.body`; checked
      against the published example). Six attempts with backoff (now, 30 s, 5 min, 30 min, 2 h, 6 h), the
      same message id on every retry, a delivery log with replay, pause, a test button, admin-only. The
      server refuses private, loopback and link-local destinations (checked again at delivery, and the
      connection goes only to the address it checked). Left: more events (issues, locks), auto-pause after
      repeated failure, per-organization hooks, rotating a secret without recreating.
- [x] **Slack / Teams notifications** on push, PR, failed checks. `S` · Built as chat webhooks (Slack, Teams, Discord); a webhook whose address is a chat service's incoming-webhook posts a short message instead of the signed JSON (checklist 156-160).
- [x] **Python SDK** with fsspec so notebooks read a file at a commit. `M` · `craton://owner/repo@version/path`, reads by HTTP byte range (checklist 166-170).
- [ ] **QGIS plugin.** `L`
- [x] **MCP server** so assistants can answer "what changed in the DEM since the last release". `S`
- [~] **Release notes from history.** `S` · "Generate from commits" on the new-release form lists the commits
      since the latest release. Left: group by changed files, and between any two tags.
- [x] **CI status badge** for README files. `S` · `GET /repos/:o/:r/badge/checks.svg` (public repositories only; passing / failing / none yet), with a copyable Markdown snippet on the Checks page.

## F. Accounts and security

- [x] **Two-step sign-in (TOTP) with recovery codes.** `M` · Optional per user, in Settings → Security. Works with any
      authenticator app (RFC 6238, checked against its published test vectors). Ten single-use recovery codes
      stored only as hashes; the secret is encrypted at rest (AES-256-GCM, key from `CRATON_SECRET_KEY` or a
      key file next to the database). Sign-in is two steps: the password earns a 5-minute, 5-try ticket; a used
      code can't be replayed; 10 wrong codes lock an account's guessing for 15 minutes. Turning it on or off,
      or making new codes, needs the password again and emails the owner. A password reset doesn't bypass it.
      Left: enforcing it per organization, passkeys, and remembering a trusted device.
- [x] **Passkeys.** `M` · Built 2026-10-16 (checklist 126-137).
- [x] **Security activity log.** `S` · `GET /user/security-log`; sign-ins, failed attempts, password change/reset, tokens created or revoked, browsers signed out, two-step on/off, recovery codes. Newest first, last 200 per person, no secrets stored; card on Settings → Security (migration 14, 4 tests).
- [x] **Tokens limited to specific repositories.** `S` · A token can name up to 20 repositories ("owner/name"); outside them it acts as no token (public data readable, private repositories hidden, writes and account routes closed). Set when creating a token; the list shows the limit (migration 16, 4 tests).
- [x] **Per-repository collaborators.** `S` · Share one private repository with one person without making them part
      of an organization: Read / Write / Admin, set by a repository admin (confirmed email required), told by email,
      removable, and anyone can leave a repository shared with them. They get a "Shared with you" list on the
      dashboard. (The access model already supported collaborators; nothing could add one.)
- [x] **Invite by email** for people without an account. `S` · Collaborators page: type an email address instead of a username. An address that already has an account is added at once; otherwise a one-time link (14 days, only its hash stored) is emailed and listed as "Waiting for a reply", with Withdraw. Accepting needs a signed-in account whose confirmed address is the invited one (migration 18, 4 tests).
      account; this would send a signup link that grants access on first sign-in.
- [~] **SSO (OIDC/SAML) and SCIM.** `L` · OIDC per organization with domain verification and enforcement is built (checklist 171-176); SAML and SCIM are not.

## G. Day-to-day polish

- [x] **Go to file** `t`. `S` · Fuzzy file finder on any repository page (letters in order, file-name
      matches first), also from a button; lists paths and sizes only, fetched on first open.
- [x] **Saved filters** for issues and pull requests. `S` · "Saved" menu in both lists: apply, save the current state, label and search under a name, delete (20 per list, kept on the account, migration 17, 3 tests).
- [x] **Issue and PR templates** per repository. `S` · Markdown files in the repository, so they are versioned and
      reviewed: `.craton-templates/issue/*.md` (optional header with name, about, label) and
      `.craton-templates/pull_request.md`, read from the default branch. The new-issue form offers each as "Use
      template: …" (and sets the label); a new pull request starts with the PR template. Not `.craton/`, which is the
      CLI's own never-pushed folder. Left: a settings page to write them in the browser, and form-style templates.
- [~] **Label and milestone management.** `S` · Milestones are real (title, description, due date, open/closed,
      progress from their issues); a Milestones page, a picker on the issue page and the new-issue form for people
      who can write; renaming follows onto issues and deleting only un-assigns. The new-issue form used to offer two
      invented milestones in every repository; that is gone. Left: custom labels (the four are still fixed).
- [x] **Server-side notifications inbox.** `M` · Read, unread and done are the account's own and follow it between
      devices; the bell shows the unread count. Reasons: work by others in repositories you can write to (yours,
      your organizations', or ones you were invited to with Write), `@handle` mentions anywhere you can see, and
      replies on issues or pull requests you opened. Done has a list and "Move back"; "Mark all as read" is one
      write. A first look only goes back a week. Left: watching/unwatching a repository, email digests, and
      notifications for releases and failed checks (the inbox is derived from the activity feed, which has no
      check events).
- [x] **Undo instead of "are you sure".** `S` · Deleting a branch is one click with a 10-second Undo that points it
      back at its commits; closing or reopening an issue has Undo too. Irreversible things (deleting a webhook
      or repository) keep their confirmation. Left: Undo for pull request close, unstar, and label changes.
- [x] **Search operators** on the issue and pull request lists. `S` · `is:closed label:bug author:priya file:basin
      no:assignee -draft`, quoted values, and a leading `-` to exclude; PRs add `branch:`, `reviewer:`, `check:`.
      Only known keys are operators (so `EPSG:32643` is still just text), the active ones show as chips you can
      remove, and the open/closed toggle and the box stay in step.
- [x] **Keyboard list navigation.** `S` · `j` and `k` move through issues, pull requests, commits, repositories,
      notifications and Explore results; Enter opens. The selected row gets a ring and is real focus, so screen
      readers announce it.
- [x] **Lighter repository pages.** `S` · Removed the animation library from every repository tab (the count badges
      and the sliding underline are plain markup and CSS, and the counts are now in the server-rendered HTML
      instead of popping in after hydration); Go to file loads on first use. Issues page JavaScript went from
      385 KB to 313 KB gzipped.
- [x] **Light theme.** `M` (the dark theme is the product's look; this is an accessibility option)
- [x] **Personal activity digest** by email. `S` · Off by default; Settings → Notifications.

## H. Hydrology and GIS specifics (the part no general tool will build)

- [ ] **Recognise a HEC-RAS project** (`.prj`, `.g01`, `.p01`, `.u01`, `.hdf`) and show plan, geometry and
      flow files as one unit with their relationships. `M`
- [ ] **Model run metadata** stored with a release: plan, software version, runtime, inputs by commit. `M`
- [x] **Hydrograph / time-series viewer** for gauge CSVs, with a compare-two-versions overlay. `M` · "Plot over time" on any table with a time column: pick the time and value columns, optionally one line per station, and show the previous version dashed behind. Drawn as SVG on the server; up to six lines of 800 points; shareable as a link.
- [~] **Calibration table**: observed vs modelled at gauges, per release. `L` · Done for a single table: on any CSV page, "Compare two columns" gives NSE, KGE, PBIAS, RMSE, MAE and r over the whole file (Nash and Sutcliffe 1970; Gupta et al. 2009; ratings from Moriasi et al. 2007), shareable as a link. Not yet: per gauge, and stored with a release.
- [x] **Units setting** (metric / imperial) applied to metadata and diffs. `S` · Settings → Preferences.
- [ ] **LiDAR point-density preview.** `M`
- [ ] **MapLibre viewer** with the compare slider on PR diffs. `L`

## I. Field and offline

- [ ] **Resumable uploads** that survive a dropped connection. `M`
- [ ] **Offline commit queue** in the CLI. `L`

## Known limitations

- **Missing pages answer HTTP 200** (with a `noindex` tag and the not-found page). Next.js streams a page behind the
  app-wide loading screen before it knows the data is missing, so `notFound()` can't change the status. Search
  engines honour the `noindex`; uptime and link checkers see a 200. A true 404 would need an existence check before
  rendering (in `proxy.ts`) or giving up the instant loading shell on those routes.
- **Fixed flake:** the intermittent backend failures (`checks gate merges…` once, `compare reports commits…`
  several times under load) were Hono's `etag()` cloning the response; the original's body was sometimes left
  locked and the next step answered 500. ETags are now computed by our own middleware that reads the body once
  (16 loaded runs and the full suite pass).
- **Fixed leak:** `ref_log` had no foreign key, so deleting a repository left its history, and the next repository to
  reuse the id showed it in its activity (a private repository's commit messages could appear in a new one).
  Migration 11 removes the orphans and deletes history with the repository.

## Sources

- [Kart: distributed version control for geospatial and tabular data](https://kartproject.org/) and its [spatial filtering](https://docs.kartproject.org/en/latest/pages/spatial_filtering.html)
- [Koordinates: distributed version control](https://koordinates.com/features/distributed-version-control)
- [Git LFS file locking](https://github.com/git-lfs/git-lfs/wiki/File-Locking) · [GitLab file locking](https://docs.gitlab.com/user/project/file_lock)
- [Esri Community: working with GIS data on a network share](https://community.esri.com/t5/ohio-gis-questions/working-with-gis-data-on-network-share/td-p/816660) · [GEO Jobe: file geodatabases in shared cloud storage](https://geo-jobe.com/mapthis/cautions-with-shared-cloud-storage/)
- [Hugging Face dataset cards](https://huggingface.co/docs/hub/datasets-cards)
- [ISO 19115 geographic metadata](https://blog.ansi.org/ansi/iso-19115-1-2014-geographic-information-metadata/)
- [GitHub: about CITATION files](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-citation-files) · [Citation File Format](https://github.com/citation-file-format/citation-file-format)
- [lakeFS: data version control](https://lakefs.io/data-version-control/)
- [Standard Webhooks specification](https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md)
- [RFC 6238 TOTP notes and recovery-code practice](https://github.com/fumbledlol/totp-go)
- [HEC-RAS features and data files](https://www.hec.usace.army.mil/software/hec-ras/features.aspx)
