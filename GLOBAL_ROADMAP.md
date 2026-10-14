# Craton: the global-product roadmap

How Google, Linear, Dropbox, GitHub, Figma, Stripe and Cloudflare make products feel instant and
stay up, and what Craton should do to match them. `ROADMAP.md` is the product backlog (P0 is
done); this list goes deeper on speed, scale, reliability and craft. Researched 2026-10-01; sources
at the end.

Each item: **what** · who does it and why it works → **what Craton does**. Tags: `Now` (next 4–6
weeks), `Next` (this quarter), `Later`; size `S` (days), `M` (1–3 weeks), `L` (a month or more).

---

## 1. Perceived speed: the Linear feel

Linear loads most views in under 50 ms because the UI never waits for the network. These are the
techniques, cheapest first.

- [ ] **Optimistic writes everywhere** `Now` `M` · Linear applies every mutation to a local store
  first and syncs in the background; rollback is rare. → Comments, reviews, labels, stars,
  branch create/delete, member changes update instantly, with an undo toast and rollback on
  error. (Star and notification state already do; extend to all server actions.)
- [x] **Prerender the next page** `Now` `S` · The Speculation Rules API prefetches or fully
  prerenders likely next pages; Monrif cut LCP 17.9% with it plus bfcache. → Add
  `<script type="speculationrules">` with `eagerness: "moderate"` (on hover) for repo tabs, PRs
  and issues from lists, and file views from the tree.
  **Done:** Speculation Rules (moderate eagerness) in `components/speculation-rules.tsx`.
- [ ] **Make pages back/forward-cache eligible** `Now` `S` · bfcache restores a page instantly
  from memory and removes layout shift; `Cache-Control: no-store` and `unload` handlers block it.
  → Audit what our dynamic pages send, and use `pagehide`, never `unload`.
- [ ] **Static shell, streamed data (Partial Prerendering)** `Next` `M` · Next.js 16 Cache
  Components serve a CDN-cached shell immediately and stream personalised parts; reported TTFB
  drops from about 700 ms to 60–80 ms. → Turn on `cacheComponents`, wrap per-user parts (header,
  stars, checklist) in `<Suspense>`, and `"use cache"` public repo pages keyed by commit SHA
  (immutable, so cache forever).
- [ ] **Local-first read model** `Later` `L` · Linear keeps its data in IndexedDB and reads only
  locally, so boot cost tracks workspace *structure*, not size. Zero (Rocicorp) reached 1.0 in
  June 2026; ElectricSQL streams Postgres shapes over CDN-cacheable HTTP. → Start with a persisted
  TanStack Query/DB cache plus websocket invalidation for issues, PRs and comments; evaluate Zero
  once the API is on Postgres.
- [ ] **Keyboard-first, local command palette** `Next` `M` · Linear's ⌘K searches the in-memory
  object pool (no server round-trip), is scoped to the current view, and teaches shortcuts. →
  Index repos, branches, files, PRs and issues client-side; add `j`/`k`, `g r` (go to repo), `c`
  (create), `x` (select), and show shortcuts in menus and tooltips.
- [ ] **A motion budget** `Now` `S` · Linear animates only `transform` and `opacity`, 0 s fade-in /
  150 ms fade-out, nothing on list items, motion that starts from its origin; Vercel: never
  `transition: all`, respect `prefers-reduced-motion`. → Write these as rules in `DESIGN.md` and
  lint for `transition: all` and layout-property animation; audit the vendored motion components
  against them.
- [ ] **Loading states that don't flash** `Now` `S` · Vercel: show a spinner only after
  150–300 ms, keep it at least 300–500 ms, keep the button label, and mirror the final layout in
  skeletons. → One `useDelayedPending()` hook for all actions; skeletons per route that match
  their pages exactly (CLS 0).
- [ ] **Service-worker precache after sign-in** `Next` `M` · Linear caches about 1,200 hashed
  assets in the background after login, so later navigations skip the network; an inline app
  shell paints the remembered sidebar state before JS. → Precache route chunks, fonts and icons;
  inline critical CSS; remember layout state in a cookie so the server renders it.
- [ ] **Fonts: one variable file each, preloaded, subset** `Now` `S` · Linear ships one woff2 per
  family with `crossorigin` preload. → Check `next/font` subsets (Latin plus the scripts we
  localise), drop unused weights, and decide whether Playfair is worth its bytes.
- [ ] **Virtualise everything long** `Next` `S` · → File trees with 100k entries, commit lists and
  the data grids (tablecn and ReUI virtual rows are vendored); `content-visibility: auto` on long
  docs pages.
- [ ] **Heavy work off the main thread** `Next` `M` · Vercel: move expensive computation to Web
  Workers. INP over 200 ms is "needs improvement". → Browser-side hashing for uploads and
  client-side GeoTIFF/COG decoding in a worker.
- [ ] **React Compiler and render discipline** `Next` `S` · → Enable
  `babel-plugin-react-compiler`; profile with React Scan in development; fail CI on regressions in
  re-render counts for key interactions.
- [ ] **Per-route JS budgets** `Now` `S` · Linear: modern-browser targets, one chunk per package
  over ~3 KB for cache granularity, `modulepreload` to avoid waterfalls. → Budget each route in
  CI; `next/dynamic` for heavy vendored pieces (map viewer, data grid, code highlighting).

## 2. Backend speed and scale: what Dropbox, GitHub and Figma learned

- [ ] **Postgres, then partitions, then shards** `Next` `L` · Figma went from one Postgres to
  vertical partitions to horizontal sharding over 4 years (100× growth), with "colos": groups of
  tables sharing a shard key so joins and transactions still work inside one shard. Linear
  partitions its issues table 300 ways. → Move from SQLite to Postgres; shard key `repo_id` for
  history, chunks refs, issues, PRs and checks (one colo), `owner_id` for accounts.
- [ ] **Direct-to-storage transfers** `Now` `M` · Presigned URLs let clients PUT straight to
  S3/R2, so the API never carries file bytes; multipart plus resume for anything over ~100 MB. →
  The API answers "which chunks are missing" and hands out presigned R2 URLs; the CLI uploads in
  parallel and resumes. The API stops being the bandwidth bottleneck.
- [ ] **Chunks from the edge** `Now` `S` · Chunks are content-addressed and immutable, the ideal
  CDN object (`immutable`, one-year max-age, which our chunk GET already sends). → Put R2 behind
  Cloudflare's CDN with signed URLs for private repos; clones of popular public data are served
  from the nearest PoP.
- [ ] **Set reconciliation instead of hash lists** `Later` `M` · Rateless IBLTs (SIGCOMM 2024)
  find the difference between two sets with near-optimal bandwidth; on Ethereum state sync they
  cut communication 4.4× and completion time 5.6×. → Replace "send all 100k chunk hashes" in
  `chunks/missing` with an RIBLT exchange, for big pushes and pulls over field connections.
- [ ] **Faster chunking** `Next` `M` · FastCDC is already ~10× Rabin. SeqCDC (2024) is hashless
  and 1.5–3× faster; VectorCDC (2025) uses SIMD for 8–26× more throughput; RapidCDC skips
  re-chunking duplicate runs (up to 33×). → Chunk files in parallel in the CLI; add RapidCDC's
  duplicate-locality fast path for re-pushes; port the chunker to Rust/WASM so the browser upload
  uses the same code.
- [ ] **Smarter compression** `Next` `M` · Dropbox pre-compresses blocks with Brotli and serves the
  stored bytes directly (Broccoli); zstd supports trained dictionaries; the seekable zstd format
  allows partial decompression. → Train zstd dictionaries per data type (GeoTIFF headers,
  shapefile `.dbf`, HEC-RAS text); store seekable frames so a range read decompresses one frame;
  serve already-compressed bytes without recompressing.
- [ ] **Byte-range reads of any version** `Now` `M` · COGs are designed for HTTP range requests.
  → Support `Range` on `/raw/:ref/:path` by mapping byte ranges to chunks, so GDAL's `/vsicurl/`,
  QGIS and rasterio can open a 50 GB DEM at any commit *without downloading it*. This is a major
  feature for GIS users.
- [x] **Previews computed at push, not on first view** `Next` `M` · → A background job renders
  thumbnails and diffs when a commit lands, stores them in object storage by blob id, and
  generates PMTiles pyramids for big rasters and vectors. Today's renderer is in-memory, on demand.
  **Done:** previews are warmed in the background after a push (`warmCommit`) and every preview has a content-derived ETag, a 304 path and a one-year `immutable` cache when pinned to a commit id. Still open: durable storage by blob id (the cache is in-memory) and PMTiles pyramids. A smaller image needs a lossy format: lossless PNG tuning was measured at 0–3% on real previews and reverted.
- [ ] **Jobs and events without new infrastructure** `Now` `M` · A Postgres queue with
  `FOR UPDATE SKIP LOCKED` plus a transactional outbox gives at-least-once delivery without
  dual-write bugs, good to ~10k jobs/minute. → Checks, renders, emails and webhooks become jobs
  written in the same transaction as the commit or PR; consumers are idempotent.
- [ ] **Distributed rate limits** `Next` `S` · Stripe runs a centralised token bucket in Redis
  with per-endpoint limits; Cloudflare's sliding window showed 0.003% error over 400M requests. →
  Move our in-memory limiter to Redis (token bucket or GCRA) once there's more than one API
  instance.
- [x] **Idempotency keys** `Now` `S` · Stripe stores the first response per `Idempotency-Key` for
  24 h and replays it, including errors. → Accept `Idempotency-Key` on every POST; the CLI sends
  one per commit/push so retries after dropped connections can't double-apply.
  **Done:** `Idempotency-Key` on POST/PUT/PATCH/DELETE, replayed for 24 h; the CLI sends one per request.
- [x] **HTTP caching for JSON** `Now` `S` · → `ETag`/`If-None-Match` on read endpoints (most repo
  reads are keyed by an immutable commit SHA); `stale-while-revalidate` for listings.
  **Done:** gzip/brotli plus weak ETags on API reads (`If-None-Match` gives a body-less 304; 3,010 B became 1,276 B on a commit list). Chunk and raw bytes are excluded on purpose. `stale-while-revalidate` for listings is still open.
- [ ] **Stateless API, horizontal scale** `Next` `M` · → No in-process state (rate limits, render
  cache, sessions) once on Postgres + Redis; run N instances behind a load balancer; route renders
  by blob id (consistent hashing) so each blob's cache lives on one node.
- [ ] **Durability at scale** `Later` `L` · Dropbox's Magic Pocket uses Reed-Solomon erasure coding
  instead of full replicas. → Rely on R2's durability, add cross-region replication for metadata,
  point-in-time recovery for Postgres, and scheduled restore drills (the drill script exists).

## 3. Reliability: Google SRE practice

- [ ] **SLOs per user journey, with error budgets** `Now` `S` · Google: define SLIs for what users
  feel, set an SLO, and spend the error budget on velocity. → SLOs for: page load (p75 LCP
  < 2.5 s), push success (99.9%), clone throughput, PR merge latency, API availability (99.9% ≈ 43
  min/month).
- [ ] **Multi-window, multi-burn-rate alerts** `Next` `S` · Google's SRE workbook: page when
  burning budget 14.4× over 1 h (2% of the month gone), ticket at 6× over 6 h, review at 1× over
  3 days; never alert on raw error rate. → Implement on the health samples we already collect;
  every alert links a runbook.
- [ ] **Tracing end to end** `Next` `M` · → OpenTelemetry from browser → Next server → API →
  storage, carrying the `X-Request-Id` we already set; show it in error pages so support can find
  the trace.
- [ ] **Real-user monitoring with attribution** `Now` `S` · INP is measured over the whole
  session; the Long Animation Frames API names the script that blocked. → `web-vitals`
  attribution build plus LoAF, sampled, reported per route and country at p75.
- [ ] **Canaries and feature flags** `Next` `M` · Google separates launches from binary releases
  with flag frameworks (Gertrude, PlanOut) and canaries a slice of traffic against a control. →
  Flags for every new feature (per user, org, percentage); deploy to a canary slice first with
  automatic rollback on SLO regression.
- [ ] **Test the sync engine like Dropbox** `Next` `M` · Dropbox rewrote its sync engine (Nucleus,
  Rust) around three trees (local, remote, synced) and tests it with randomised, deterministic
  simulation. → Property-based and fuzz tests for the CLI: random edit/push/pull/conflict
  sequences across simulated clients, asserting convergence and Merkle-root equality.
- [ ] **Load tests and capacity plan** `Next` `S` · → k6 scenarios: push storm after a field
  campaign, 100 concurrent clones of a public DEM, render bursts on a popular PR.
- [ ] **Status page off the main stack, incident process** `Next` `S` · → Host `/status` separately
  (it reads `/v1/status` today); incident log; blameless postmortems; first update within 15 min.

## 4. Trust, security and provenance

- [ ] **Passkeys, with conditional UI** `Now` `M` · Passkeys became the default for new Microsoft
  accounts in May 2025; adoption fails when they hide behind a separate button. Identifier-first
  sign-in plus `autocomplete="webauthn"` autofill is what works. → Offer enrollment after sign-in;
  keep passwords until enrollment is high; TOTP 2FA as the fallback.
- [ ] **SSO and SCIM** `Next` `L` · → OIDC and SAML for agencies and engineering firms; SCIM to
  provision and remove people automatically.
- [ ] **Signed, transparent commits** `Next` `M` · Sigstore's gitsign signs commits keylessly
  (OIDC → short-lived Fulcio certificate → Rekor transparency log), replacing unrotated GPG keys;
  SLSA provenance is an in-toto attestation. → Sign Craton commits and releases the same way, and
  attach signed in-toto attestations to check runs ("this DEM passed CRS and datum checks at
  commit X"). Craton's audit-ready provenance becomes verifiable by a regulator.
- [ ] **Audit log** `Next` `M` · → Every account, org and repo security event, searchable and
  exportable (CSV and SIEM streaming).
- [ ] **Envelope encryption for private data** `Later` `L` · → Per-tenant data keys for private
  chunks, then customer-managed keys for enterprises.
- [ ] **Signed CLI releases** `Now` `S` · → Ship the CLI as signed binaries (cosign), with an SBOM
  and checksums, alongside the packaged installers already on the roadmap.

## 5. Geospatial depth: what makes it a GIS product, not just git

- [ ] **A real map viewer** `Next` `L` · MapLibre GL renders vector maps and 3D terrain (DEM as
  terrain-RGB), deck.gl overlays large GPU layers, and plugins read COGs directly in the browser
  over range requests with no tile server. → Replace static preview images on file and PR pages
  with a pannable map: basemap, the layer at this commit, the diff layer, and a swipe/compare
  control (Dice UI's compare-slider is vendored).
- [ ] **Cloud-native outputs** `Next` `M` · The current stack: COG for rasters, GeoParquet (Hilbert-
  ordered, zstd, bbox covering) for big vectors, PMTiles for single-file tile pyramids, Zarr for
  gridded time series, STAC for metadata. → Offer COG and GeoParquet exports of any version;
  generate PMTiles per commit; publish a STAC catalog per repository and release, so QGIS and
  pystac users can discover them.
- [ ] **Spatial search** `Next` `M` · S2 covers arbitrary polygons and makes containment and
  intersection tests cheap (hierarchy nests exactly); H3's equal-area hexagons suit analytics and
  neighbour flows. → Store an S2 cell covering of every dataset's footprint: "datasets
  intersecting my catchment" becomes an index lookup. Use H3 for coverage heatmaps on Explore.
- [ ] **Format-aware chunking** `Later` `M` · → Align chunk boundaries to Zarr/NetCDF chunks and
  COG tiles, so a re-survey changes exactly the affected chunks; point-density previews for
  LAS/COPC; HEC-RAS HDF5 result summaries.
- [ ] **Work where GIS people already are** `Next` `M` · → GDAL `/vsicurl/` via range reads (see
  section 2), a QGIS plugin and an ArcGIS Pro add-in (on the main roadmap).

## 6. Search: the Google part

- [ ] **Code-search-grade file search** `Later` `L` · GitHub's Blackbird (Rust) keeps separate
  ngram indexes for content, symbols and paths, sharded by blob id. That deduplicates the index
  for free and spreads load evenly: 120k docs/s indexing, an index about ⅔ of corpus size. →
  Index paths, CSV/README/model text and metadata (CRS, bounds, tags) by blob id, the same
  dedup key the chunk store uses.
- [ ] **Typo-tolerant instant search for entities** `Next` `S` · Meilisearch and Typesense answer
  in under 50 ms with typo tolerance; Postgres FTS doesn't handle misspellings. → Meilisearch for
  repos, people, orgs, issues and PRs; keep Postgres FTS for admin queries.
- [ ] **Search as you type in ⌘K** `Next` `S` · → Local results first (section 1), server
  results streamed in after; recent and frequent items ranked first.

## 7. Collaboration and craft

- [ ] **Live updates and presence** `Next` `M` · → Websocket channel per repo: new comments,
  reviews, check results and who's viewing the PR appear without refresh (Linear, Figma).
- [ ] **Comments anchored on the map** `Later` `M` · Figma pins comments to the canvas. → Pin a
  review comment to a location or feature on a raster or vector diff ("bank is 0.35 m low here").
- [ ] **Server-side inbox and digests** `Next` `M` · → Notifications stored per user with read
  state across devices (today they're per browser); "review requested" and "checks failed"
  emails; an opt-in weekly digest.
- [ ] **Every state designed** `Now` `M` · Vercel: design empty, sparse, dense and error states;
  give every screen a recovery path; deep-link filters, tabs and pagination. → Audit each page
  for the four states; put view state in the URL.
- [ ] **Measure UX like Google: HEART** `Next` `S` · Happiness, Engagement, Adoption, Retention and
  Task success, each through Goals → Signals → Metrics. → Task success for "first push" and
  "first merged PR", adoption of the CLI, retention by org; a quarterly in-app satisfaction
  question (happiness is the one you must ask).
- [ ] **Accessibility as a gate** `Now` `S` · → axe in CI on every route (we're at 0 violations;
  keep it), APCA contrast for text on tinted surfaces, keyboard parity for every mouse action,
  24 px minimum targets (44 px on touch).

## 8. Global from day one

- [ ] **Internationalisation** `Next` `M` · → ICU MessageFormat strings; locale from
  `Accept-Language`; `Intl` for dates, numbers and *units* (metres and feet for elevations);
  `translate="no"` on code, paths and product names; RTL-safe layout (logical CSS properties).
- [ ] **Regions and data residency** `Later` `L` · → A CDN-served shell everywhere; API and storage
  regions in India, the EU and the US; an org picks where its private data lives (DPDP Act,
  GDPR).
- [ ] **Built for field connections** `Now` `S` · → Resumable everything, an offline commit queue
  in the CLI, small JSON payloads, and a low-bandwidth mode that skips previews.
- [ ] **Local payments and tax** `Later` `M` · → Stripe Billing in local currency with GST/VAT
  handled, once paid plans exist.
- [ ] **Modern transport** `Next` `S` · HTTP/3 is on about 41% of sites and over 50% of the top
  1,000; 103 Early Hints lets the browser fetch CSS and fonts during server think-time (Cloudflare
  reports up to 30% faster loads); shared-dictionary compression (`zstd-d`) shrinks repeat
  JS/JSON. → Serve the app and API over HTTP/3 at the edge, send Early Hints for critical assets,
  and try dictionary compression for API responses.

## 9. Developer platform: the Stripe standard

- [ ] **Date-based API versions** `Next` `M` · Stripe pins each integration to a dated version
  (`Stripe-Version: 2020-01-01`) and keeps one current implementation, with a chain of version
  transformers for old shapes. → `Craton-Version` header, pinned per token on creation; a
  changelog generated from the transformer modules.
- [ ] **OpenAPI, generated SDKs and a Python SDK with fsspec** `Next` `M` · → (Also in `ROADMAP.md`
  P1.)
- [ ] **Webhooks you can trust** `Next` `M` · → Signed payloads, retries from the outbox (section
  2), a delivery log with redeliver, event ids for consumer idempotency.
- [ ] **An MCP server** `Later` `S` · → Let assistants answer "what changed in the DEM since the
  last release?" from a repository's history and checks.

---

## Where the vendored components fit

The components downloaded on 2026-10-01 (`frontend/components/VENDOR.md`) are building blocks for
the items above:

| Item | Component |
| --- | --- |
| Raster review in PRs (5) | Dice UI `compare-slider`, Motion Primitives `image-comparison` |
| Time travel through commits on the map (5, 7) | SmoothUI `scrubber`, Dice UI `timeline` |
| Linear-style filters on issues, PRs, Explore (1, 7) | ReUI `filters`, Watermelon `filter-disclosure` |
| File browser for 100k-file repos (1) | tablecn `data-table` (virtual rows), ReUI `data-grid` virtual, Magic UI / Animate UI file trees |
| Instant ⌘K (1, 6) | Kokonut `action-search-bar`, Watermelon `quick-switcher` and `command-search`, coss `autocomplete` |
| CLI pages and onboarding (8) | Magic UI `terminal`, Animate UI `code-tabs` and `copy`, Kibo `snippet` and `code-block`, Dice UI `stepper`, Watermelon `onboarding-checklist` |
| Push and upload progress (2, 8) | Watermelon `labeled-progress-indicator`, Dice UI `file-upload`, Kibo `dropzone`, Dice UI `circular-progress` |
| Loading without flashes (1) | Motion Primitives `text-shimmer`, SmoothUI `skeleton-loader`, Kokonut `loader` |
| Storage and plan usage (2) | coss `meter`, Dice UI `stat`, Watermelon `credit-usage-card`, SmoothUI `number-flow` |
| Status and live state (3, 7) | Kibo `status` and `relative-time`, SmoothUI `notification-badge` |
| Bulk actions on issues and files (7) | Dice UI `action-bar` and `selection-toolbar` |
| Tokens shown once (4) | Watermelon `licence-key`, Animate UI `copy` |
| Marketing with real screenshots (7) | Cult UI `mock-browser-window` |

## Suggested order for the next six weeks

1. **Instant feel:** optimistic writes, speculation rules, bfcache audit, motion budget, delayed
   spinners (section 1; mostly `S`).
2. **Transfers:** presigned direct-to-R2 uploads, CDN for chunks, idempotency keys, byte-range
   reads (section 2), so pushes and clones scale without the API in the data path.
3. **Measurement before more speed:** RUM with attribution, SLOs and burn-rate alerts (section 3).
4. **Trust:** passkeys with conditional UI, signed CLI releases (section 4).
5. **One GIS win:** the MapLibre viewer with the compare slider on PR diffs (section 5).

## Sources

- Linear: [How's Linear so fast? A technical breakdown](https://performance.dev/how-is-linear-so-fast-a-technical-breakdown), [Why is Linear so fast?](https://note.com/h3adeu/n/n7273aefd3778?hl=en), [Reverse engineering Linear's sync engine (HN)](https://news.ycombinator.com/item?id=44123131)
- Vercel: [Web Interface Guidelines](https://vercel.com/design/guidelines)
- Web performance: [web.dev: the most effective ways to improve Core Web Vitals](https://web.dev/articles/top-cwv), [Monrif case study: Speculation Rules and bfcache](https://web.dev/case-studies/monrif-cwv?hl=en), [Cloudflare: Early Hints](https://blog.cloudflare.com/early-hints/), [Chrome: shared dictionary compression](https://developer.chrome.com/blog/shared-dictionary-compression), [W3Techs: HTTP/3 usage](https://w3techs.com/technologies/details/ce-http3), [DebugBear: Long Animation Frames](https://www.debugbear.com/blog/long-animation-frames), [OpenTelemetry browser LoAF instrumentation](https://github.com/open-telemetry/opentelemetry-browser/pull/429)
- Next.js: [Cache Components and PPR in Next.js 16](https://dev.to/abeertech01/cache-components-and-partial-pre-rendering-ppr-in-nextjs-16-3dfp), [Next.js 16 PPR](https://u11d.com/blog/nextjs-16-ppr-static-dynamic-components/)
- Sync engines: [Smashing: the architecture of local-first web development](https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/), [TanStack DB vs ElectricSQL vs Zero](https://kanopylabs.com/blog/tanstack-db-vs-electricsql-vs-zero-sync)
- Google SRE: [Alerting on SLOs](https://sre.google/workbook/alerting-on-slos/), [Canarying releases](https://sre.google/workbook/canarying-releases/), [HEART framework](https://kerryrodden.com/heart/), [Measuring the user experience on a large scale (paper)](https://research.google.com/pubs/archive/36299.pdf)
- Dropbox: [Rewriting the heart of our sync engine](https://dropbox.tech/infrastructure/rewriting-the-heart-of-our-sync-engine), [Testing sync at Dropbox](https://dropbox.tech/infrastructure/-testing-our-new-sync-engine), [Broccoli: syncing faster by syncing less](https://dropbox.tech/infrastructure/-broccoli--syncing-faster-by-syncing-less)
- GitHub: [A brief history of code search at GitHub](https://github.blog/engineering/architecture-optimization/a-brief-history-of-code-search-at-github/), [The technology behind GitHub's new code search](https://simonwillison.net/2023/Feb/6/github-code-search/)
- Figma: [How Figma's databases team lived to tell the scale](https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/), [How Figma built DBProxy](https://pganalyze.com/blog/5mins-postgres-figma-dbproxy-sharding-postgres)
- Stripe: [APIs as infrastructure: versioning](https://stripe.com/blog/api-versioning), [Idempotent requests](https://docs.stripe.com/api/idempotent_requests)
- Rate limiting: [Token bucket vs GCRA](https://blog.gaborkoos.com/posts/2026-09-22-Rate-Limiting-Without-the-Refill-Loop-Token-Bucket-vs-GCRA/), [Rate-limiting algorithms compared](https://arcjet.com/learn/rate-limiting-guide)
- Jobs: [Transactional outbox in PostgreSQL](https://www.matthewswong.com/en/blog/transactional-outbox-pattern-postgres/), [Postgres SKIP LOCKED queues and outbox](https://mvpfactory.io/blog/replacing-your-message-queue-with-postgresql-skip-locked-queues-listen-notify)
- Transfers: [Resumable S3 multipart uploads](https://dev.to/nainikmehta/resumable-s3-multipart-uploads-in-nextjs-app-router-2di1), [High-scale upload designs with S3, R2 and signed URLs](https://medium.com/@ThinkingLoop/9-high-scale-file-upload-designs-with-s3-r2-and-signed-urls-ad1425ee85e8)
- Set reconciliation: [Practical Rateless Set Reconciliation (SIGCOMM 2024)](https://arxiv.org/abs/2402.02668)
- Chunking and compression: [FastCDC (USENIX ATC 2016)](https://www.usenix.org/conference/atc16/technical-sessions/presentation/xia), [SeqCDC (Middleware 2024)](https://cs.uwaterloo.ca/~alkiswan/papers/SeqCDC_Middleware24.pdf), [VectorCDC](https://arxiv.org/pdf/2508.05797), [RapidCDC](https://ranger.uta.edu/~sjiang/pubs/papers/ni19-rapidcdc.pdf), [Seekable zstd (Zeekstd)](https://news.ycombinator.com/item?id=44284871)
- Security: [WebAuthn conditional UI](https://www.corbado.com/blog/webauthn-conditional-ui-passkeys-autofill), [WebAuthn and passkeys: 2026 production explainer](https://www.flowverify.co/blog/webauthn-passkeys-production-explainer-2026), [Sigstore keyless signing](https://evertrust.io/guide/sigstore/), [SLSA, Sigstore and provenance](https://dev.to/kamal_namdeo/slsa-sigstore-and-provenance-complete-practical-guide-1bl5)
- Geospatial: [BigQuery: grid systems for spatial analysis (S2, H3)](https://docs.cloud.google.com/bigquery/docs/grid-systems-spatial-analysis), [H3 vs S2](https://danmccarey.net/blog/h3-vs-s2-grid-systems), [Cloud-native geospatial formats](https://www.axisspatial.com/blog/cloud-native-formats), [Introducing geoparquet-io](https://cloudnativegeo.org/blog/2026/03/introducing-geoparquet-io/), [Introducing Portolan](https://cloudnativegeo.org/blog/2026/09/introducing-portolan/), [MapLibre 3D terrain](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/), [maplibre-gl-raster (COG in the browser)](https://github.com/opengeos/maplibre-gl-raster), [deck.gl for large geospatial layers](https://www.bathyl.com/en/blog/deck-gl-for-large-geospatial-layers)
- Search: [Postgres FTS vs the rest](https://supabase.com/blog/postgres-full-text-search-vs-the-rest), [Typesense vs Meilisearch 2026](https://contracollective.com/blog/typesense-vs-meilisearch-open-source-search-2026)
- Component registries: [registry.directory](https://registry.directory/), [shadcn registry directory](https://ui.shadcn.com/docs/directory), [coss ui](https://coss.com/ui/docs/get-started), [Watermelon UI registry](https://github.com/WatermelonCorp/watermellon-registry), [Kibo UI](https://www.kibo-ui.com/), [tablecn](https://github.com/sadmann7/tablecn)
