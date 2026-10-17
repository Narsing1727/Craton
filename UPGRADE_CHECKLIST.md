# Craton upgrade checklist (everything shipped, with how to check it)

Sources: the autonomous queue (`D:\Desktop\leetcode\AUTONOMOUS_QUEUE.md`), `PRODUCT_TODO.md`, and the run notes.
Status words: **verified** = covered by a test or a scripted sweep when it was built; **this session** = built today.
Nothing here is committed or released.

## 0. Setup for checking

| What | How |
|---|---|
| Start the API | `cd Craton\backend` then `node --disable-warning=ExperimentalWarning src/server.ts` (http://localhost:4000) |
| Start the web app | `cd Craton\frontend` then `npm run dev` (http://localhost:3100) |
| Sign in | http://localhost:3100/login with a demo user: `priyam`, `arunn`, `sarat` or `vikramr`, password `craton-demo-2026` (if your dev data was reseeded) |
| Demo repository | http://localhost:3100/hydrolab/chalakudy-basin |
| CLI token | Settings → Personal access tokens (`/settings/tokens`), then `craton auth login --token <T> --server http://localhost:4000` |
| CLI without installing | from `Craton\backend`: `npm run craton -- <command>` |
| Whole-system checks | backend `npm test` (409 tests), frontend `npm test`, frontend `npm run sweep`, `npm run focus`, `npm run contrast`, and `node scripts/verify.mjs` |

---

## 1. Accounts, sign-in and security

| # | Upgrade | How to check |
|---|---|---|
| 1 | Real sign-up, 4-step onboarding with a sample-project option, getting-started checklist on the dashboard | `/signup`, then `/onboarding`, then `/dashboard` |
| 2 | Password reset (link is logged by the API in dev) | `/forgot-password`; the link is at `GET http://localhost:4000/v1/dev/outbox` |
| 3 | Email verification needed before creating public repositories | Sign up, try to create a public repo, then verify via the outbox link |
| 4 | Two-step sign-in (TOTP) with recovery codes | `/settings/security` |
| 5 | Security activity log | `/settings/security` (sign-ins, token and 2FA changes) |
| 6 | Access tokens limited to named repositories | `/settings/tokens`, create a token and pick repositories |
| 7 | Reserved handles (web pages, staff-like names, `ghost`) refused | Try signing up as `admin`, `ghost` or `settings` |
| 8 | Storage warnings at 80% and 100% (dashboard banner and one email each) | `backend/test/storagewarn.test.ts` (`node --test test/storagewarn.test.ts`) |
| 9 | Account export includes a repositories ZIP; organisation owners get an organisation repositories bundle | Settings → export; `/orgs/<org>/settings` |
| 10 | Account deletion confirmation email and backup-retention note | Settings → delete account (read the dialog), or `test/` mail outbox |
| 11 | Checks-failed email to the pusher, and a webhook-paused email to admins | Push a broken file; read `/v1/dev/outbox` |
| 12 | Invite by email for people without an account | Repository settings → Collaborators → invite an address, then open `/invite` link from outbox |

## 2. Repository pages and daily workflow

| # | Upgrade | How to check |
|---|---|---|
| 13 | Browser upload (files or a dropped folder, new branch, checks before storing) | Any repo → Add files |
| 14 | Upload dialog: bytes, rate, time left, Cancel, and exact CLI commands when over 200 files or 100 MB | Drop more than 200 files into the dialog |
| 15 | ZIP download of a repository, folder or release | Repo → Code → Download ZIP |
| 16 | Restore an older version of a file | File page → History → Restore |
| 17 | File locks (UI, API, CLI), read-only copies for others, stale-lock age, admin "old locks" list, inbox nudge for stale locks | File page → Lock; `craton lock/unlock/locks`; Settings → Locks |
| 18 | Lock patterns that require the lock on direct pushes (merges and imports exempt) | Repo settings → Locks; `core/globs.ts` equals `frontend/lib/globs.ts` (test) |
| 19 | Licence and topics, Explore topic filter, licence shown in the repository header | Repo settings, then `/explore` |
| 20 | Cite this repository, Embed dialog (commit-pinned Markdown, HTML, image URL) | Repo page → Cite / Embed |
| 21 | README starters in the new-repository form (the fake "Template" select is gone) | `/new` |
| 22 | "Describe this data" completeness checklist (writers only) | Repo overview |
| 23 | Go to file (`t`), j/k list navigation, search operators on issue and PR lists | Press `t` in a repo; `/o/r/issues` |
| 24 | Undo for branch delete and issue close | Delete a branch, then use the Undo note |
| 25 | Command menu: repository group (copy clone command, new PR/issue/release) and open issues/PRs by title | Press the command-menu shortcut in a repo |
| 26 | Milestones | `/<owner>/<repo>/milestones` |
| 27 | Issue and PR templates from `.craton-templates/` | Add `.craton-templates/issue/bug.md`, then New issue |
| 28 | Per-repository collaborators (Read/Write/Admin) and "Shared with you" on the dashboard | Repo settings → Collaborators |
| 29 | Saved filters for issues and pull requests | Issues list → save filter |
| 30 | Review requests, "Review requested" on `/pulls` uses real requests | Open a PR, request a review, then check `/pulls` as the reviewer |
| 31 | Notifications inbox (bell, `g n`), server-side | Header bell |
| 32 | Expiring share links `/s/<token>` (pinned snapshot, hash-only storage) | Repo settings → Sharing |
| 33 | Release notes draft listing commits and changed files, release cards show what changed since the previous release | Releases → New release |
| 34 | STAC catalog export for a release | Release page → STAC |
| 35 | Badges: checks, release, size, licence, with snippets on the Checks page | `/o/r/badge/checks.svg`; Checks tab |

## 3. Review, ownership and webhooks

| # | Upgrade | How to check |
|---|---|---|
| 36 | CODEOWNERS: owners auto-requested on PRs, PR card, `dir/**` pattern fixed | Add `CODEOWNERS`, open a PR touching that path |
| 37 | Setting "require owner approval" blocks merge until each owner approves the current head | Repo settings |
| 38 | CODEOWNERS editor with server-side preview | Repo settings → Code owners |
| 39 | Blame by chunk (API, CLI, file-page card) | File page → Blame card; `craton blame <path>` |
| 40 | Signed webhooks incl. issue and lock events | `/<owner>/<repo>/settings/webhooks` |
| 41 | Last-ten delivery strip per webhook | Same page |
| 42 | Dead webhooks pause themselves after ten failures, with a reason and one admin email | Point a webhook at a closed port and push 10 times (or `test/webhooks.test.ts`) |
| 43 | Payloads documented from one table; `WEBHOOKS.md` with executed Node and Python receivers; `craton webhook verify` | `Craton\WEBHOOKS.md`; `craton help webhook` |

## 4. Understanding the data

| # | Upgrade | How to check |
|---|---|---|
| 44 | Real map previews and "where the data is" footprints (UTM/Mercator to lon/lat, `?covers=lat,lon`) | Open a GeoTIFF or shapefile in the demo repo |
| 45 | Raster statistics diff under every heatmap | A commit or compare page containing a GeoTIFF |
| 46 | Units setting (metric/imperial) for metadata, diffs and legends | Settings → units |
| 47 | Hydrograph viewer for time-series CSVs with a previous-version overlay | Open a time-series CSV |
| 48 | Compare two columns (NSE, KGE, PBIAS, RMSE, MAE, r) on any CSV; per-gauge fit by a station column | CSV page → compare columns |
| 49 | CSV table diff (key-matched rows) | A commit changing a CSV |
| 50 | Data dictionary for CSV columns and shapefile fields, with a browser editor | CSV or `.shp` page → dictionary |
| 51 | Line diff for text files (HEC-RAS plan and geometry, `.inp`, configs) on commit, compare and PR pages | Commit page of a `.p01` or `.inp` change |
| 52 | Header descriptions for LAS point clouds and NetCDF with a readable diff ("points: 50 to 80", "variable added") | A commit that changes a `.las` or `.nc` |
| 53 | Dataset Search JSON-LD for public repositories | `GET /v1/repos/hydrolab/chalakudy-basin/dataset.jsonld` |
| 54 | Open Graph tags and generated preview image for public repositories | View source of a public repo page |

## 5. The validation gate (checks on every push)

| # | Upgrade | How to check |
|---|---|---|
| 55 | Six-step checks runner (GeoTIFF, shapefile, HEC-RAS), checks status and badge | Repo → Checks |
| 56 | Cloud-Optimized GeoTIFF layout step: advisory, blocking when "Require Cloud Optimized GeoTIFFs" is on | Repo settings; push a striped TIFF |
| 57 | SWMM model structure step (undefined nodes, zero length, duplicate names, bad outlets) | `test/swmmcheck.test.ts` |
| 58 | LAS header step (cut-off file, inverted bounds, wrong CRS) | `test/las.test.ts` |
| 59 | NetCDF classic header step (cut-off file, Conventions) | `test/netcdf.test.ts` |
| 60 | GeoPackage and GeoParquet CRS check (GeoPackage opened in a killable child process) | `test/gpkg.test.ts`, `test/geoparquet.test.ts` |
| 61 | WKT unit code no longer reported as the CRS (EPSG:9002 bug) | `test/las.test.ts` |
| 62 | Integrity step carries over unchanged files (5.1 s to 0.1 s per push) | `test/integrity.test.ts` |

## 6. Terminal (`craton` CLI)

Run `craton help` for the table; `craton completion powershell` for tab completion.

| # | Upgrade | How to check |
|---|---|---|
| 63 | `craton stats` (raster statistics and change; table fit with `--obs --sim --by`) | `craton stats terrain/basin_dem.tif --base v1.0.0` |
| 64 | `craton diff [from [to]]`, `--text <path>` | `craton diff v1.0.0` |
| 65 | `craton blame <path>` | see #39 |
| 66 | `craton sparse` and `clone --only a/,b.csv` | `craton clone hydrolab/chalakudy-basin --only terrain/` |
| 67 | Resumable clone (same command continues) | Interrupt a clone, run it again |
| 68 | A fresh clone can now push (bug fixed) | Clone, change a file, `craton push` |
| 69 | `--json` on status, log, branch, locks, diff, stats, blame, clone, sparse, pull; event lines on push; exit codes 0/1/2 | `craton status --json` |
| 70 | `craton log <path>` and `-n` | `craton log terrain/basin_dem.tif -n 5` |
| 71 | `craton doctor [--json]` (Node, server, token, access, disk) | `craton doctor` |
| 72 | `craton help <command>` and `craton completion bash/zsh/powershell` | `craton help push` |
| 73 | Clear message when the server is not running, naming address and reason | Stop the API, run `craton pull` |
| 74 | Waits out API rate limits (Retry-After) so a 5,000-file push completes | `test/clientratelimit.test.ts` |
| 75 | Upload summary: chunks, bytes sent, rate, "N% smaller" | Any `craton push` |
| 76 | CLI page lists locks, diff and stats | `/cli` |
| 77 | Faster first `add` of thousands of small files (staged chunks packed per add; 5,000 files 26 s to ~10 s) and `fsck` checks the staging cache | `craton fsck --verify` |

## 7. Assistants, SDKs and the API

| # | Upgrade | How to check |
|---|---|---|
| 78 | MCP server, 9 tools (list files, table fit, blame, pull owners, text diff, raster stats ...) | `npm run mcp` in `backend`; config snippet on `/api-reference` |
| 79 | OpenAPI document generated from the route table, with schemas, query parameters and write results | `GET http://localhost:4000/v1/openapi.json` |
| 80 | API reference page matches the routes both ways (26 missing routes added) | `/api-reference` |
| 81 | Python client (single file, stdlib only, pip-installable; reads, writes, streaming `rows()`, `all_commits()`) | `Craton\sdk\python` (`python -m pip install .` there; `check_sdk.py` exercises it against a live server) |
| 82 | Commits API `since/until/author/offset` | `GET /v1/repos/hydrolab/chalakudy-basin/commits?author=priyam` |
| 83 | Documentation audited against the code, task-based quickstarts | `/docs` |

## 8. Storage engine and scale

| # | Upgrade | How to check |
|---|---|---|
| 84 | Format-aware chunk encoding (rasters byte-shuffled with delta, tables zstd 9, compressed formats left alone, point records shuffled) | `test/upload.test.ts`; push a raster and read "N% smaller" |
| 85 | Batched chunk upload and download routes (5,000-file clone 248 s to 31 s) | `test/chunkbatch.test.ts` |
| 86 | Big lists capped: folder 200 entries with "Show more", commit page 50 files, compare 50, PR 100, releases manifest as a download | Open a repo with thousands of files |
| 87 | Audit package Merkle proofs linear (34.5 s to 0.1 s) and served as a download | Storage tab → audit package |
| 88 | Long lists skipped by the browser until needed; "Show all" in batches | Same big folder |
| 89 | Concurrent chunk stores (a flaky ordering bug in review requests also fixed) | `test/reviewrequests.test.ts` |
| 90 | **This session:** store concurrency is one setting, `CRATON_STORE_CONCURRENCY` (auto: 8 on disk, 24 on R2) | `node --test test/storeconcurrency.test.ts`; row in `OPERATING.md` |
| 91 | **This session (measured, not built):** chunk packs for R2. 5,000 files = 9,999 PUTs (~$0.045); packs left out on purpose | `AUTONOMOUS_QUEUE.md`, the packs entry |

## 9. Operating it

| # | Upgrade | How to check |
|---|---|---|
| 92 | `OPERATING.md` (settings, backup, restore, gc, upgrade) tested against the code | `node --test test/operating.test.ts` |
| 93 | `/v1/health` (version, apiVersion, minCliVersion) and `/v1/ready` (database and chunk store) | `curl http://localhost:4000/v1/ready` |
| 94 | Web `/api/health` | `http://localhost:3100/api/health` |
| 95 | Optional JSON access log without bodies or tokens | start the API with `CRATON_ACCESS_LOG=1` |
| 96 | Request body ceilings, traversal probes, error shape | `test/hardening.test.ts` |
| 97 | `sitemap.xml` and `robots.txt` (public pages and repos only) | `http://localhost:3100/sitemap.xml` |

## 10. Look, feel and resilience (web)

| # | Upgrade | How to check |
|---|---|---|
| 98 | Phone width (390 px) and 200% zoom (640 px) sweeps, toolbars wrap | `CRATON_WIDTH=390 npm run sweep` in `frontend` |
| 99 | Keyboard walk and structure scan, 16+ pages and docs | `npm run focus` |
| 100 | Colour contrast (WCAG AA, both themes) | `npm run contrast` |
| 101 | Reduced-motion rule; target size 24 px (invisible hit-areas) | OS reduced-motion setting, then browse |
| 102 | Forms: errors only after interaction, tied to fields (aria-describedby) | `/signup` with a bad email |
| 103 | Tab titles, meta descriptions and index exclusion checked by the sweep (six untitled pages fixed) | `npm run sweep` |
| 104 | API stopped: error page says "The Craton API isn't reachable"; sign-in/sign-up/reset forms say the same | Stop the API and open `/login` |
| 105 | Slow API: signed-out visitors don't wait on an API call, loading state at ~140 ms | Browse with a slow API |
| 106 | Missing things show Not-found with `noindex`, an API outage never shows a 404; a rate limit never shows Not-found and forms say how many seconds to wait | `/o/missing`, then stop the API |
| 107 | Empty states: empty repository shows full wrapped commands with "Copy all five commands"; Commits "No commits yet"; Checks "No runs yet" | Create an empty repo |
| 108 | No toasts: Button `loading` dots inside the button, result note at the bottom right | Press any save button |
| 109 | xAI-style settings and repo-settings layout, sidebar left aligned, no boxes | `/settings`, `/<o>/<r>/settings` |
| 110 | Scroll fades on tab rows that scroll sideways on a phone; browser bar colour follows the theme | Phone width |
| 111 | Full verification runner (9 steps) | `node scripts/verify.mjs` in `frontend` |

## 11. Added later on 2026-10-14

| # | Upgrade | How to check |
|---|---|---|
| 112 | **Continue with Google** on sign-in and sign-up (OpenID Connect, authorization code with PKCE; ID token signature, issuer, audience, expiry, nonce and "email verified" all checked; one-time state bound to the browser by a cookie). The button shows only when the server has Google credentials | Needs credentials, see "Turning Google on" below. Without them: `/login` shows no button and `GET /v1/auth/providers` says `{"google":false}` |
| 113 | First Google sign-in asks you to **choose a username** (permanent, it is in every URL), then creates the account already email-verified, with no password | `/signup/google` after the first Google sign-in |
| 114 | An existing account with a **confirmed** address is joined by email; one whose address was **never confirmed is refused** (it would otherwise let whoever registered it first keep a way in) | Login page shows "…never confirmed…" |
| 115 | **Two-step verification still applies** after Google: the sign-in page goes straight to the code step | Google sign-in on an account with 2FA on |
| 116 | **Settings → Security → Sign-in methods**: connect or disconnect Google; disconnect is refused while it is the only way in; accounts with no password see "Add a password" (emailed link) and can delete the account by typing the username | `/settings/security` |
| 117 | Security log entries "Google connected" / "Google disconnected"; the sign-in detail says "Google" | `/settings/security` → Recent security activity |
| 118 | **Redirect bug fixed** for `/auth/expired` and the Google routes: behind `next start -H 0.0.0.0` redirects pointed at `http://0.0.0.0:3100`, which browsers refuse | `lib/origin.ts`; stop the API and open a signed-in page |
| 119 | **HDF5 / HEC-RAS results files** (`.hdf`, `.h5`, `.hdf5`, `.he5`; NetCDF-4 `.nc` too): file page rows (format, groups and datasets, top level, largest datasets), a line description for diffs ("`dataset /Results/.../Water Surface: float32 [3, 4]` to `[6, 4]`" when a run is extended), and a new **HDF5 gate step** that fails a cut-off or non-HDF5 file | Upload a `.p01.hdf` and open its page, its commit page and the Checks tab; `node --test test/hdf5.test.ts` |
| 120 | HDF5 reader validated against h5py: 102 real files from many libhdf5 versions and tools, and 5 generated layouts (old symbol tables, link messages, dense fractal-heap groups, user block) | `test/hdf5.test.ts` uses embedded libhdf5-written fixtures |

| 121 | **HEC-RAS attributes**: the file's own properties (File Type, File Version, Units System, Projection, Extent) and the plan's (Plan Title, Time Window, time step) are read from the groups' attributes and shown on the file page (up to eight rows) and as lines in the diff, so a changed plan title or run length shows as `-attribute …: 3` / `+attribute …: 6`. Fixed and variable-length strings, integers, floats, arrays, enums, bitfields; compact and dense attribute storage | File page → Metadata; commit page → Changed data |
| 122 | Attribute reader validated against h5py: **904 attributes over 152 real files agree**; the only differences are two files that hit deliberate caps (groups deeper than 4 levels, text over 400 characters) | `test/hdf5.test.ts` (fixtures carry h5py's own attribute listing) |
| 123 | The commit, compare and pull-request pages now show the line diff for `.hdf`, `.h5`, `.hdf5`, `.he5` files, not only the file page's description | Commit page of a changed `.p01.hdf` |

| 124 | **HEC-RAS run status** on the file page (solution status, max WSEL error, computation time, run window, cores, when it went unstable, volume-accounting figures), read from the plan file's own Results summary. The HDF5 gate step now **fails a plan that says "went unstable"** | File page of a `.p01.hdf`; Checks tab |
| 125 | **Model review** (new tab "Model review" on every repository): a 27-item QA checklist from the TUFLOW and FEMA practice, a modelling log, independent sign-off, all **pinned to one commit and its Merkle root**; the validation gate's findings and each plan's run status are captured as evidence and offered as suggestions next to the items they bear on | `/<owner>/<repo>/reviews` |
| 126 | Review rules: approval needs every item decided and every failure explained; the author may approve their own review but it is recorded as "not independent"; approved reviews lock (the log stays open); reopening needs a reason; approved reviews cannot be deleted | Try approving with items "To do" |
| 127 | **Export** of a review as a Markdown document naming the commit, Merkle root, gate findings, checklist, log and sign-offs, to attach to a submission | Review page → Export |

| 128 | **Your own checks** (`.craton-checks.json` at the repository root): a new "Repository checks" step. Expectations by file kind: rasters (crs, nodata, cellSize, width, height, dataType, cog, within), vectors (crs, geometry, fields, features), CSV (columns, rows, notEmpty, numeric ranges, unique, sorted), HEC-RAS/HDF5 (run stable, max WSEL error, groups), NetCDF variables, LAS points, file size, `require` / `forbid` patterns, per-check `severity: "warn"` | Docs → "Your own checks"; push a `.craton-checks.json`, open the Checks tab |
| 129 | The reader is strict: an unknown key, wrong type or a check that does nothing is a failure with its path; an expectation no matched file could answer is reported instead of passing silently | Misspell a key and push |

| 130 | **Audit log** for repositories (admins), organizations (owners) and your own personal repositories: who changed what, in which repository, whether from a browser or an access token, and **refused attempts** (403/401) too. Filter by person and outcome, page back, **download CSV** (spreadsheet-safe). Request bodies, queries and secrets are never stored; kept 400 days | Repo → Settings → Audit log; Organization settings; `GET /v1/user/audit-log` |
| 131 | **Recent requests per access token** (last 100: method, route, status, time, where from), including requests to routes that don't exist, which is how a typo in a script shows up | Settings → Personal access tokens → "Recent requests" |
| 132 | Webhook **resend** was already there (settings → webhooks → a delivery → Resend); the research list had it wrong | Repo → Settings → Webhooks |

| 133 | **Passkeys** (WebAuthn): sign in with fingerprint, face, screen lock or a security key, with no username typed. ES256, RS256 (Windows Hello) and EdDSA keys; no attestation used. Checked on every ceremony: one-time challenge (5 minutes, for that purpose and person), the page's origin, the relying-party hash, user presence, the signature, the signature counter (a counter going backwards is refused and logged as a possible copy; synced passkeys with counter 0 are fine) | Settings → Security → Passkeys → Add a passkey; then sign out and use "Sign in with a passkey" on `/login` |
| 134 | A passkey that the device unlocked with a PIN/fingerprint/face counts as two factors; one that was only touched on an account with two-step verification still asks for the code | Backend test "two-step verification still applies unless the device verified the person" |
| 135 | Manage passkeys: add (up to 20, rate limited), rename, remove; the **last way into an account cannot be removed**; Google can't be disconnected while a passkey is the alternative | Settings → Passkeys |
| 136 | Passkeys offered in the username field's **autofill list** where the browser supports it | Click the email field on `/login` in Chrome, Edge or Safari |
| 137 | Fixed: a refused sign-in on the web app showed "Sign in to do this." instead of its real message (found by the passkey browser test; Google sign-in was affected too) | Use a removed passkey |

### 13. Secret scanning on push

| # | What it does | How to check |
|---|---|---|
| 138 | A **push or browser upload that contains a credential is refused before the branch moves** (422 `secret_detected`): Craton tokens that still work, GitHub tokens (checksum verified), AWS access key ids, Google API keys and client secrets, Slack tokens and webhooks, Stripe live keys, Anthropic/OpenAI keys, PEM private keys, database addresses with a real password | Upload a file containing `AKIA` + 16 capitals (not the AWS documentation example) in the web app |
| 139 | The message names **file, line and kind** (and the commit, for a push of several) and shows only the first few characters; the secret is never in a response, a log or the audit trail | Read the red panel in the upload dialog |
| 140 | Only what is **new** is read: files added or changed by the commits being pushed, including a commit a later commit undid; text only, up to 2 MB per file | Push a commit that adds a key and a second that deletes it: still refused |
| 141 | A line holding `craton:allow-secret` is skipped; documentation keys (`…EXAMPLE`), placeholders, localhost addresses and `${VARIABLES}` are not findings | Backend test "lookalikes are not findings" |
| 142 | **Administrators can go ahead with a reason** (`craton push --allow-secrets "why"`, the `allowSecrets` field, or "Add anyway" in the upload dialog); writers cannot; the refusal and the decision are both on the **audit log**; a live Craton token let into a *public* repository this way is **revoked** | Upload as an admin and as a writer; read Settings → Audit log |
| 143 | **New token format**: `crt_pat_…` / `crt_ses_…` = 30 random characters + a 6-character CRC-32 checksum, so scanners can recognise a leaked token without guessing; tokens issued before (`bcn_…`) still work and are still recognised | Create a token in Settings → Personal access tokens |
| 144 | `CRATON_SECRET_SCAN=off` turns it off for a whole server; the docs, API reference, OPERATING.md and `craton push --help` describe it | Docs → Working with data → Secret scanning |

### 14. For agents and AI tools

| # | What it does | How to check |
|---|---|---|
| 145 | **`/llms.txt`** in the llmstxt.org layout (title, summary, link lists with a note each) and **`/llms-full.txt`** with every reading page in one file | Open `http://localhost:3100/llms.txt` |
| 146 | **Markdown versions** of docs, API reference, CLI, pricing, security, about, changelog and help at `<page>.md`, made from the page people read (so they cannot drift); marked noindex, canonical to the page | Open `http://localhost:3100/docs.md` |
| 147 | A request with **`Accept: text/markdown`** gets the Markdown at the page's own address; a browser never does | `curl -H "Accept: text/markdown" http://localhost:3100/cli` |
| 148 | **`/skill.md`**: an agent skill (front matter + sign-in, everyday commands, pull-before-push, locks, checks, secrets, API, MCP). A test checks every command it names exists and the flags it mentions are in the CLI's help | Open `http://localhost:3100/skill.md` |
| 149 | Docs → Reference → "For agents and AI tools", OPERATING.md section, `CRATON_SITE_URL` also sets the links in these files | Docs page |

### 15. Sign-in providers

| # | What it does | How to check |
|---|---|---|
| 150 | **Continue with GitHub**, next to Google: OAuth 2.0 with PKCE, one-time state, the account read from GitHub's API and **only a verified email accepted** (never a no-reply address); same rules as Google for matching, unconfirmed accounts, two-step verification | Needs a GitHub OAuth app; without one, `npm run e2e:github` against the stand-in |
| 151 | One provider-aware flow for both (routes `/auth/{provider}/…`, one web handler pair, one username step); a sign-in started for one provider cannot be finished as the other | Backend test "state from one provider cannot finish the other's" |
| 152 | Settings → Security → **Sign-in methods** lists Google and GitHub, connect/disconnect each; the last way in (no password, no passkey, no other provider) cannot be removed | Settings → Security |
| 153 | **`backend/.env` settings file** read at start (real environment variables win; `CRATON_ENV_FILE` to point elsewhere; tests never read the default); `.env.example` shows every provider setting | Copy `backend/.env.example` to `.env` |
| 154 | **`npm run setup:oauth -- --google-id … --google-secret … [--github-id … --github-secret …] [--web-url …]`** writes the settings and prints the exact redirect addresses to register with Google and GitHub; refuses half a pair | Run it with the values from the provider consoles, restart the API |
| 155 | Security-log wording is provider-neutral ("Sign-in provider connected"); the detail names which | Settings → Security → activity |

### 16. Chat notifications

| # | What it does | How to check |
|---|---|---|
| 156 | A webhook can post into **Slack, Microsoft Teams or Discord**: paste that service's incoming-webhook address and it is recognised (`hooks.slack.com`, `*.webhook.office.com` / `*.logic.azure.com`, `discord.com/api/webhooks`); or pick the format by hand (Mattermost and similar read Slack's) | Settings → Webhooks → Add, "Send as" |
| 157 | Each event is one plain sentence with a link ("priyam pushed 2 commits to main in hydrolab/chalakudy-basin", pull request, release, issue, lock) in that service's shape: Slack blocks, a Teams Adaptive Card with an Open button, a Discord embed | Press Send test on a chat webhook |
| 158 | **Nothing a person types can ping a room**: Slack `<!channel>` is made literal, Teams and Discord markdown and `@` are escaped, Discord is sent `allowed_mentions: none` | Backend tests in `chatwebhooks.test.ts` |
| 159 | Chat webhooks have **no signature and no secret** (a chat room can't check one); plain JSON webhooks are unchanged: signed, with a secret shown once | Create one of each |
| 160 | Same retries, pausing, delivery log and redelivery for chat webhooks; the format is detected again when the address is edited | Backend test "the format is detected from the address…" |

### 17. Organization domains

| # | What it does | How to check |
|---|---|---|
| 161 | An organization owner **claims a domain and proves it with a DNS TXT record** (`_craton-challenge.<domain>` = `craton-verify=<token>`); the check says exactly what it found or did not find, and tells a DNS outage from a missing record | Organization → Settings → Domains → Add domain, then Check now |
| 162 | **Verified domains show on the organization's public page** (header mark, and in the public profile API) | Open the org signed out |
| 163 | **One organization per verified domain**; two may hold the same unverified claim and the first to prove it wins; free-mail domains (gmail.com…) and public suffixes (co.uk, ac.in) are refused | Backend tests |
| 164 | Optional **"let people with a confirmed @domain address join as Members"**: existing people are added when it is switched on, new people when they confirm their address or sign in with Google/GitHub; an unconfirmed address never counts; sub-domains and look-alikes do not match; removing the domain or switching it off removes nobody | Organization → Settings → Domains → the switch |
| 165 | Owners only (a maintainer is refused, a non-member sees nothing); the verify route is rate limited; every change is on the audit log | Backend tests, audit log |

### 18. Reading big files by range, and from Python

| # | What it does | How to check |
|---|---|---|
| 166 | The raw-file route answers **HTTP byte ranges** (`Range: bytes=a-b`, `a-`, `-n`): 206 with `Content-Range`, 416 with the size when past the end, up to 64 MB per request; HEAD gives the size | `curl -r 0-99 …/v1/repos/<owner>/<repo>/raw/main/<path>` |
| 167 | A whole file is **streamed chunk by chunk, any size** (the old 16 MB cap and "use the CLI" message are gone); the checksum header is unchanged | Download a big raster from the file page |
| 168 | **`craton://owner/repo@version/path` in Python** (fsspec): `pandas.read_csv`, `fsspec.open`, `fs.ls`, `fs.glob`, `fs.info`, seek and partial reads, only the requested bytes transferred; read-only, with a clear message on write | `pip install "./sdk/python[fsspec]"` (see sdk/python/README.md) |
| 169 | Versions are part of the address: a branch, tag or commit, so a notebook result names the exact data it used | `craton://hydrolab/chalakudy-basin@v1.0.0/…` |
| 170 | Tested against the real server over real HTTP (`cli.test.ts`), including negative offsets, head/tail seeks and 404s | Backend tests |

### 19. Single sign-on for organizations

| # | What it does | How to check |
|---|---|---|
| 171 | **Per-organization OpenID Connect SSO** (Entra ID, Okta, Keycloak, Google Workspace…): the owner pastes issuer, client id and secret; Craton reads the provider's discovery document (public https only, no redirects, size-limited), stores the secret **encrypted**, and shows the one redirect address to register | Organization → Settings → Single sign-on |
| 172 | **"Continue with single sign-on"** on the sign-in page: a work email picks the organization that verified that domain; state, PKCE and nonce as for Google; RS256 signature, issuer, audience, authorized party, expiry and nonce all checked | `/login/sso` |
| 173 | The provider **can only vouch for addresses at the organization's verified domains** (not gmail.com, not another organization's domain, not a look-alike); `preferred_username`/`upn` are used when there is no `email` claim; an address the provider marks unverified is refused | Backend tests |
| 174 | First sign-in picks a username, creates a verified account and **adds the person to the organization**; an existing confirmed account is linked; an unconfirmed one is refused, never merged | Sign in through it |
| 175 | **Require SSO** (after one successful test): members with an address at the verified domains are refused passwords, Google, GitHub and passkeys; **owners are exempt** (the way back in), personal access tokens keep working; a different provider or client resets "tested" and "required" | The switch under the SSO card |
| 176 | Setup, change and removal are on the audit log; removing it deletes the links, not the accounts; providers wanting client_secret_basic are supported | Backend tests |

### 20. Weekly summary and the sign-in page

| # | What it does | How to check |
|---|---|---|
| 177 | **Optional weekly summary email** of what is unread in your inbox since the last one; off by default, confirmed addresses only, nothing sent when there is nothing, first one a week after switching it on, no tracking pixel | Settings → Profile → Weekly summary |
| 178 | **One-click unsubscribe** in every message that works without signing in (a keyed signature of the account; forged or altered links change nothing); the page shows a button, so a mail scanner opening the link does not unsubscribe anyone | Follow the link at the bottom of a summary |
| 179 | **Google and GitHub buttons are visible on a development server even before credentials exist**, with a note saying so; clicking says the provider is not set up. In production only configured providers are shown | `http://localhost:3100/login` |

### 21. Sign-in pages redesign

| # | What it does | How to check |
|---|---|---|
| 180 | **One quiet, pure-black frame for every sign-in page** (sign in, sign up, forgot and reset password, confirm email, single sign-on, choose a username, unsubscribe, loading): no pattern, no card, wordmark top left, the other way in top right, one centered column, legal links at the foot | `/login`, `/signup`, `/forgot-password` |
| 181 | Google and GitHub side by side; passkey and single sign-on as quiet text actions; the form below a hairline; one white primary button; errors as a thin red rule, not a boxed alert; autofill colours neutralised; a short rise-in that respects reduced motion | `/login` |
| 182 | Scoped re-pointing of tokens (`.auth-surface`) so nothing else in the app changed; sizes and radii stay on the app's scale | Open any other page |
| 183 | All browser flows (Google, GitHub, single sign-on, passkeys) still pass on the new pages; the page sweep is clean | `npm run e2e:*`, `npm run sweep` |

### 22. Light theme

| # | What it does | How to check |
|---|---|---|
| 184 | **A Light look** beside Darker, chosen in Settings → Profile → Appearance (kept in this browser, applied before first paint so nothing flashes): a very light page with crisp white surfaces, hairline borders, near-black text and primary, the faintest depth on cards, white fields, a machined edge on the primary button. The blue accent, square structure and fonts are unchanged | Settings → Appearance → Light |
| 185 | **The Standard look is removed from Settings**; a browser that had saved it gets Darker | Settings → Appearance |
| 186 | The sign-in pages follow the chosen look: pure black in Darker, soft white in Light | `/login` in each |

### 23. A shorter Security page

| # | What it does | How to check |
|---|---|---|
| 187 | **"Where you're signed in" is one row** (this browser, and how many others) with a **Manage devices** button; the full list opens in a dialog, grouped by day (Today, Yesterday, weekday and date), with a device icon, address, when it signed in and was last active, a Sign out for each, and **Sign out everywhere else** | Settings → Security → Manage devices |
| 188 | **"Recent security activity" is one row** (nothing unusual, or how many things to check, and the latest event) with a **View all activity** button; the dialog lists the latest 100 events by day with the time of each, and a filter for the ones that need a look (failed sign-ins, two-step turned off, password reset requested) | Settings → Security → View all activity |
| 189 | The settings page no longer grows with every browser and sign-in | Scroll Settings → Security |

### 24. More settings, and the activity dialogs fixed

Compared with GitHub, GitLab, Google and Linear, Craton had no control over what it emails and nowhere for preferences. Not copied: SSH/GPG keys and authorized OAuth apps (Craton has neither), time zone and 12/24-hour time (would need every date on the site to follow it), changing a username.

| # | What it does | How to check |
|---|---|---|
| 190 | **Settings → Notifications**: one switch for each email Craton sends (review requests, failed checks on your pushes, repositories shared with you, webhooks paused, storage nearly full), all on until switched off, saved the moment you flip one; the weekly summary moved here; the emails that protect the account (new sign-in, two-step changes, password reset, deletion) are listed as always sent | Settings → Notifications; turn one off and the email is not sent (test: a switched-off email is not sent, and the same email still reaches someone who kept it on) |
| 191 | **Settings → Preferences**: theme and units (moved from Profile), **Reduce motion** (this browser; applied before the first paint), **Single-key shortcuts** on or off (this browser; Ctrl or ⌘ K always works), and **New repositories**: the visibility a repository starts with, saved on the account and also used by the API and CLI when a create request does not say | Settings → Preferences; `npm run e2e:settings` in `frontend` (13 browser checks on a throwaway account) |
| 192 | `PATCH /user` takes `notify` (individual emails, unknown names and non-booleans refused) and `defaultVisibility`; `GET /user` returns both; migration 32 | API reference → PATCH /user; `backend/test/notifications.test.ts` (4 tests) |
| 193 | The **activity dialogs no longer outgrow the window**: the height is set on the dialog itself, so the title and buttons stay in view and only the list scrolls (checked at 1918×920, 1280×640 and phone width) | Settings → Security → Manage devices / View all activity |

Run the browser check against a throwaway API (start it with its own `CRATON_DATA_DIR`), not your demo account: every sign-in is written to that account's security log.

### Turning Google on (what you need from Google)
1. Google Cloud Console → APIs & Services → **OAuth consent screen**, then **Credentials → Create credentials → OAuth client ID → Web application**.
2. **Authorized redirect URI**: `http://localhost:3100/auth/google/callback` for local use; for production `https://craton.nerolith.in/auth/google/callback`.
3. Start the API with `CRATON_GOOGLE_CLIENT_ID=<id>` and `CRATON_GOOGLE_CLIENT_SECRET=<secret>` (and `CRATON_WEB_URL` set to the site's address in production).
4. Reload `/login`: the button appears. In a consent screen still in "Testing" mode only the test users you list can sign in.
5. Without Google credentials you can still exercise the whole flow: `node frontend/scripts/mock-google.mjs`, start a throwaway API with the `CRATON_GOOGLE_*_URL` settings (see the header of that script), then `CRATON_E2E_DB=<its craton.db> npm run e2e:google` in `frontend`.

---

## Not done or still demo (so you do not look for it)

- **Google sign-in has never talked to the real Google.** It is tested against a stand-in that signs tokens the way Google does (22 browser checks and 11 API tests), but I have no credentials, so the first real attempt may need a consent-screen tweak. GitHub sign-in has the same limit (tested against a stand-in for GitHub). Microsoft is not built.
- Stars, followers, wiki, forks, teams and billing are demo.
- Not built: SAML and SCIM, writing through fsspec (reads only), a Slack app with slash commands (only incoming webhooks), QGIS plugin, MapLibre compare viewer, DOI minting, checks-as-code, Slack/Teams, offline commit queue, comments pinned to a map location.
- Chunk packs for R2 and the R2 store itself have never run against live R2 (simulated with a 40 ms put).
- Flood3D scenario import and the Studio menu bar belong to Nerolith, not Craton.
