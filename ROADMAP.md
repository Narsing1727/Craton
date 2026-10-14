# Craton roadmap: from working prototype to global product

What separates a global tech product (Linear, Stripe, Vercel, GitHub) from a vibe-coded startup
is rarely one big feature. It's that **nothing is fake**, **every state is designed**, **it never
loses your data or your trust**, and **it fits into how professionals already work**.

This list is ordered by priority. Each item says what "done" means, and where relevant what
Craton does today. Checked items are already done.

- **P0: Launch blockers.** Things that make it feel like a demo, or that would hurt a real customer.
- **P1: First 90 days.** What a serious global SaaS has on day one.
- **P2: Enterprise and scale.** What large teams, agencies and utilities ask for before buying.
- **P3: Moat.** What makes Craton impossible to replace with Git LFS, DVC or a shared drive.

---

`[~]` = partly done; what's left is listed.

> Deeper engineering list (how Google, Linear, Dropbox, GitHub, Figma and Stripe stay fast and reliable, mapped to Craton): [GLOBAL_ROADMAP.md](GLOBAL_ROADMAP.md).
>
> Product features people ask for (file locks, ZIP download, citations, webhooks, restore, and what's next), researched against Kart, Git LFS, Hugging Face, GitHub and lakeFS: [PRODUCT_TODO.md](PRODUCT_TODO.md).

## P0 · Remove every "vibe-coded" tell

A visitor decides in seconds whether a product is real. These give Craton away today.

- [x] **Real map previews.** Done: `backend/src/render/` decodes GeoTIFFs (strips and tiles; none, Deflate, LZW;
      horizontal and floating-point predictors; COG overviews) and draws a hillshade PNG, and draws shapefile
      geometry as SVG; cached per blob id; served at `GET /v1/repos/:o/:r/render/:ref/:path`. Used on the repo
      sidebar, file, commit, compare, pull request and landing pages. Left: a point-density image for LiDAR.
- [x] **Real raster and vector diffs.** Done: `?base=<ref>` draws an elevation-change heatmap (raised blue,
      lowered red, hillshade underneath) with the changed share and range in metres, and a shapefile diff that
      counts added, changed (geometry or attributes) and removed features.
- [x] **Delete or finish every demo page.** Done: stars built on the API (repo header, `/stars`, profile stars,
      trending); followers/following, wiki, fork, collaborators, teams, org billing and SSH keys moved to
      `frontend/_parked/` (not routable, listed with what each needs); notification and appearance tabs removed;
      org settings, plan and usage, developer settings rebuilt on real data.
- [x] **Fix the pricing mismatch.** Done: `/pricing` reads `GET /v1/plans` (the same `config.plans` the API
      enforces); paid plans are marked "not available yet"; the fake plan picker on org creation is gone.
- [x] **No invented company facts.** Done: honest footer, about ("works today / not yet"), security (what the
      code does, what's missing, no certifications), contact and help (no fake forms or reply-time promises).
      Contacts come from `CRATON_CONTACT_EMAIL` / `CRATON_SECURITY_EMAIL`.
- [~] **Real status page.** Done: `/status` reads live probes and sampled daily uptime from `GET /v1/status`;
      days without samples show as no data. Left: host it separately from the app; an incident log.
- [~] **Real changelog.** Done: one true, unreleased 0.1 entry, linked as "What's new" from the account menu.
      Left: dated entries with screenshots once releases happen.
- [x] **Stop the demo fallback leaking.** Done: demo data only with `CRATON_DEMO=1`; otherwise a failed request
      is a 404 (API up) or an error page (API down). Also fixed: try/catch around `cookies()` and `fetch` was
      swallowing Next's dynamic-rendering signal, so production prerendered pages with demo data.
- [x] **Seeded star/fork counts.** Done: stars are real rows (seed stars come from the demo users); fork counts
      and buttons removed; trending ranks by stars actually received in the period.
- [x] **Placeholder domain and install commands.** Done: `/cli` and developer settings show only the install that
      works (from source, Node 23.6+) and the configured API address (`CRATON_PUBLIC_API_URL`).
- [x] **Sample-project author.** Done: sample commits are by the person who imported it, and activity says
      "imported the sample project into".
- [x] Real sign-up, sign-in, sessions, password reset, onboarding and getting-started checklist.
- [x] No hard-coded "priyam" identity anywhere a real user appears.

## P0 · Things that would hurt a real customer

- [~] **Email.** Done: Resend or Postmark via `EMAIL_API_KEY` (a dev outbox otherwise), plain text plus HTML;
      verify address, password reset, new sign-in from a new device, organization invite. Review-requested and
      checks-failed emails now go out too. Left: SPF/DKIM/DMARC on the sending domain (deployment), opt-in digest.
- [x] **Verify email addresses** before public repositories or invites. Done, with a banner, resend, and a
      confirm page that needs a click (mail scanners open links too).
- [x] **Rate limiting.** Done: global and per-route limits with `RateLimit-*` and `Retry-After`, lockout after 10
      failed sign-ins in 15 minutes. The web app forwards the visitor's address, honoured only from
      `CRATON_TRUSTED_PROXIES`, so clients can't pick their own.
- [x] **Security headers.** Done on the API (secure-headers, CSP `default-src 'none'`) and the web app
      (`next.config.mjs`: CSP, HSTS in production, nosniff, frame DENY, Referrer-Policy, Permissions-Policy).
- [x] **Session management UI.** Done: Settings → Security lists signed-in browsers (device, address, last
      active) with sign-out; tokens page lists tokens with last use. Password change signs out other sessions.
      Left: location from IP.
- [~] **Enforce token scopes.** Done: `repo`, `read:repo`, `read:org`, `admin:org` enforced; tokens can't manage
      account security. Left: tokens limited to specific repositories.
- [~] **Plan limits enforced end to end.** Done: storage and private-repo limits enforced with clear errors
      (and a way forward in the UI); nothing is deleted; shared public data is free in both the check and the
      usage page; plan and usage page. Warnings at 80% and 100% (a banner on the
      dashboard and one email per threshold, cleared when use falls back).
- [~] **Backups and restore.** Done: `npm run backup` (consistent `VACUUM INTO` snapshot, verified, plus
      incremental chunk copy) and `npm run restore`; restore drill run on dev data (a repository created after
      the backup was gone after restoring, previews still rendered). Left: encryption, a nightly schedule,
      object-storage versioning in production.
- [x] **Garbage collection.** Done: `npm run gc` (dry run by default, `--apply`, 30-day grace). Left: also sweep
      chunk files on disk that have no database row.
- [~] **Account deletion and data export.** Done: JSON export from Settings → Security; deletion confirmed by
      handle and password, authored issues and comments kept as @ghost, blocked while you're an org's only
      owner. Repositories you own download as one ZIP
      (default branch, a folder each; Settings → Security). Deleting an account sends a last
      confirmation email that says backups may keep copies until they expire; organization owners download
      their organization's repositories the same way (organization settings).
- [ ] **Legal pages reviewed by a lawyer.** Terms, privacy policy, acceptable use, DPA, cookie statement (Craton
      uses only an essential session cookie, so no banner is needed; say so).

Also fixed while doing P0: uploads no longer reveal whether someone else's private repository holds the same
bytes (the `deduplicated` flag and the storage-limit check only consider chunks the uploader can already see);
organizations can be renamed and deleted (only when empty); release "drafts" (which published) are gone.

---

## P1 · Product craft (the Linear standard)

Linear's rules: make it feel fast, polish the whole experience, design for power users, use real content,
iterate obsessively. Vercel's guideline: design every reachable state, not just the populated one.

- [ ] **Every state designed.** For each page: loading (skeletons that match the final layout exactly), empty,
      sparse, full, error, permission-denied, offline, and destructive-confirmation states. Keep a checklist per
      route in `PAGES.md`.
- [ ] **Optimistic UI everywhere writes happen.** Comments, reviews, branch create/delete, star, member changes
      update instantly and reconcile with the server, with undo on failure.
- [ ] **Speed budget.** Core Web Vitals at the 75th percentile: LCP under 2.5 s, INP under 200 ms, CLS under 0.1.
      Measure real users, not only lab runs; fail CI on regressions (Lighthouse CI or similar).
- [ ] **Prefetch and cache.** Prefetch likely next pages (repo tabs, PRs from lists); cache public repository pages
      at the edge; stream slow sections (check runs, storage stats) instead of blocking the page.
- [ ] **Keyboard-first.** Shortcuts exist; extend them: `j`/`k` to move through lists, `e` to edit, `r` to review,
      `m` to merge, `?` everywhere. Every action in the command palette, including "Create branch", "Open PR from
      this branch", "Copy clone command".
- [~] **Command palette with real search.** Search files, commits, issues, PRs and settings from ⌘K, not just
      pages and repositories. Done: on a repository page the palette lists that repository's pages and actions (code, commits,
      branches, compare, pull requests, checks, releases, settings, new pull request/issue/release, copy clone command). Open issues
      and pull requests of the current repository are found by title. Left: commits and file names from the palette (the
      Go-to-file dialog covers files).
- [ ] **Undo, not "are you sure".** Prefer reversible actions with an undo toast; keep confirmations for the truly
      irreversible (delete repository).
- [ ] **Copywriting pass.** One voice across the product (DESIGN.md already sets it): short, specific, no filler,
      numbers with units, error messages that say what happened and what to do.
- [ ] **Visual regression tests.** Screenshot every route at desktop and phone width in CI and diff against the
      last approved set, so polish doesn't silently regress.
- [ ] **"Quality Wednesday".** A standing weekly slot to fix small imperfections found in real use, tracked as
      their own label.
- [ ] **Real content in every screenshot and demo.** Marketing images come from the real product with the sample
      basin, never mockups.

## P1 · First-run and activation (continue what's built)

- [x] Minimal sign-up, four-step onboarding, sample project with a pull request, five-step checklist.
- [ ] **Sign in with Google and GitHub** (OAuth/OIDC), the fastest path for most engineers; email + password stays.
- [ ] **Invite by email** for people without an account yet (today only existing usernames can be added).
- [ ] **Templates beyond the sample:** HEC-RAS 2D project, SWMM network, LiDAR survey, rainfall grids, each with a
      `.craton/checks.yml` pre-configured.
- [ ] **Import:** from a Git LFS repository, a DVC remote, an S3/GCS/Azure folder, or a zip upload in the browser
      (the "Import from URL" option says it isn't available yet).
- [ ] **Browser upload for small files** (under ~100 MB) so the first push doesn't require installing the CLI.
- [ ] **Activation funnel analytics** (privacy-friendly, self-hostable, e.g. PostHog): sign-up → sample → merge →
      CLI connected → first own push. Review weekly; fix the biggest drop.
- [ ] **Welcome email** with the three next steps and a link back to the checklist, plus one follow-up after 3
      days if they haven't pushed.

## P1 · The CLI and integrations (fit how engineers already work)

Hydraulic modellers live in Windows, HEC-RAS, QGIS and ArcGIS. Meet them there.

- [ ] **Single-binary CLI** for Windows, macOS and Linux (compile the TypeScript CLI with Node SEA or Bun, or
      rewrite the hot path in Go/Rust), signed installers (winget, Homebrew, .deb/.rpm), `craton upgrade`.
- [ ] **Resumable, parallel transfers.** Upload/download chunks concurrently with a progress bar, resume after a
      dropped connection from the last verified chunk, and throttle on slow field links.
- [ ] **Sparse checkout.** `craton clone --only terrain/` and on-demand fetch, so a 500 GB repository can be used on
      a laptop (the CLI page promised partial pull; build it).
- [ ] **File locking** for binary files that can't be merged (`craton lock model/plan.p01`), shown in the UI.
- [ ] **QGIS plugin:** browse repositories, load a layer at any commit, commit and push edits, see diffs on the map.
- [ ] **ArcGIS Pro add-in** with the same core actions, distributed through ArcGIS Marketplace.
- [ ] **HEC-RAS helper:** detect a HEC-RAS project folder, snapshot it only when HEC-RAS isn't writing (the CLI
      already waits for stable files), and parse plan/geometry changes into a readable diff.
- [ ] **Python SDK** (`pip install craton`) with fsspec support, so notebooks, xarray and rasterio can read files at a
      commit without downloading whole repositories.
- [ ] **Webhooks** (push, PR, checks, release) with signed payloads, retries, and a delivery log in settings.
- [ ] **GitHub/GitLab link:** keep model code in Git and data in Craton, cross-linked by commit.

## P1 · Docs and API (the Stripe standard)

Stripe treats docs as product: pick a goal, copy a working example, verify it, expand. Every endpoint uses
the same patterns; versions are pinned so old integrations never break.

- [ ] **Quickstarts by goal:** "Version a HEC-RAS project", "Share a DEM with a partner agency", "Review a
      re-survey", "Use Craton from Python". Each runnable end to end in under 10 minutes.
- [ ] **OpenAPI spec** generated from the API, published and used to generate the reference pages, SDKs and a
      Postman collection. Today `/api-reference` is hand-written.
- [ ] **Consistent API conventions:** cursor pagination everywhere, a request id on every response, the same error
      shape (done), idempotency keys on every write so retries never double-create.
- [ ] **Dated API versions** pinned per token (`Craton-Version: 2026-10-01`), with a changelog and upgrade guide.
- [ ] **Migration guides** from Git LFS, DVC and "folders on a shared drive", with a comparison table that's honest
      about what each tool does better.
- [ ] **Docs search, "copy for AI" and an MCP server** so assistants can answer questions about a repository.
- [ ] **Every docs page shows its last-updated date** and has a feedback control.

## P1 · Trust, reliability and operations

- [ ] **Production deployment:** API on a managed platform in at least one region, Postgres instead of SQLite once
      there's more than one instance, chunks on Cloudflare R2 (already supported), the web app on an edge
      platform, infrastructure as code.
- [ ] **CI/CD:** on every PR run typecheck, backend tests, browser end-to-end tests, accessibility and phone-width
      audits, and a production build; deploy previews per PR; one-click rollback.
- [ ] **Observability:** OpenTelemetry traces and metrics on the API, structured logs with request ids, error
      reporting on both sides, dashboards for latency, error rate, storage growth and checks duration.
- [ ] **SLOs with error budgets:** e.g. 99.9% API availability (about 43 minutes a month), p95 page load, push
      success rate; alert on burn rate, not raw thresholds.
- [ ] **Incident process:** on-call rota, runbooks, status page updates within 15 minutes, blameless postmortems
      within 48 hours, public postmortems for customer-visible incidents.
- [ ] **Trust center page:** security practices, encryption at rest and in transit, data locations,
      subprocessor list with a last-updated date, DPA download, vulnerability disclosure policy and
      `security.txt`, incident history. Reports (SOC 2, pen test) behind a request form once you have them.
- [ ] **Security programme:** dependency and secret scanning in CI, an annual third-party penetration test, a
      bug-bounty or disclosure programme, least-privilege access to production with audit.

## P1 · Pricing and billing

- [ ] **Stripe billing** with usage-based storage (after deduplication, which is Craton's pitch) plus seats for
      Team; invoices, receipts, tax (GST for India, VAT for the EU and UK), cards and bank transfer.
- [ ] **Pricing page that answers the real question:** a storage calculator ("my project is 200 GB with 30
      versions") that estimates stored size after dedup and the monthly price; monthly/annual toggle with savings
      shown; share the calculator state in the URL.
- [ ] **Generous free tier for public data and education**, clearly stated; academic and non-profit discounts.
- [ ] **Upgrade prompts at the moment of need** (hitting a limit, inviting the 4th private collaborator), never
      nag banners.

## P1 · Global from day one

- [ ] **Locale-aware formatting** everywhere with `Intl`: dates, relative times, numbers and sizes (1.000,5 vs
      1,000.5), stored in UTC and shown in the viewer's time zone with a time-zone setting.
- [ ] **Units setting:** metric or imperial for elevations, lengths and discharge, applied to metadata and diffs.
- [ ] **All strings in message catalogs** (next-intl or similar) before adding languages; logical CSS properties so
      right-to-left works later.
- [ ] **First translations** where the users are: Spanish, Portuguese, Hindi, Indonesian, French, then others,
      reviewed by domain experts (hydrology terms matter).
- [ ] **Data residency:** EU and India regions for storage and metadata, chosen per organization, shown in the
      trust center.
- [ ] **Accessibility as a feature:** WCAG 2.2 AA audited continuously (axe runs are clean today), plus a manual
      screen-reader pass of the core flows, and an accessibility statement page.

---

## P2 · Enterprise readiness

The list every procurement team checks (EnterpriseReady, WorkOS): SSO, SCIM, audit logs, RBAC, security review.

- [ ] **SAML and OIDC single sign-on** (Okta, Microsoft Entra ID, Google Workspace), enforceable per organization.
- [ ] **SCIM provisioning** so leavers lose access automatically.
- [ ] **Two-factor authentication** (TOTP and passkeys), enforceable by org owners.
- [ ] **Audit log** for every security-relevant event (sign-ins, permission changes, exports, deletes, token
      creation), searchable, exportable, streamable to a SIEM. `ref_log` already covers pushes.
- [ ] **Fine-grained roles:** org-level (owner, admin, billing, member, guest) and repository-level (admin,
      write, triage, read) with custom roles later; the collaborators table exists but has no API.
- [ ] **Branch protection rulesets** managed in the UI and as code: required checks, required reviewers, data
      owners per path (like CODEOWNERS), signed commits.
- [ ] **IP allow-lists, session length policies, token expiry policies.**
- [ ] **SOC 2 Type II and ISO 27001** once the controls above exist; show scope and dates publicly.
- [ ] **Self-hosted / private cloud edition** for agencies that can't use public cloud (the backend already runs on
      one machine with local disk or R2).
- [ ] **Uptime SLA and support tiers** in contracts; a named support contact for Enterprise.

## P2 · Collaboration at scale

- [ ] **Watching and notification settings** per repository; read state stored server-side (today it's per browser).
- [ ] **Review requests and assignment**, with reviewers suggested from data owners.
- [ ] **Comments anchored to a file, a map region or a feature**, not only the conversation.
- [ ] **Stars, forks and a real public profile** (repositories, activity, organizations).
- [ ] **Wiki backed by the repository** (markdown files in `docs/`), versioned with the data.
- [ ] **Discussions** for questions that aren't issues.
- [ ] **Saved views and filters** for issues and pull requests across repositories.

## P2 · Search and discovery

- [ ] **Full-text and metadata search** over repositories, files, commits, issues and PRs, backed by a real index.
- [ ] **Spatial search:** "show me every repository with data covering this area", using each file's bounding box
      and CRS (already read by the checks runner) on a map.
- [ ] **STAC catalog** generated per repository and release, so Craton data plugs into the cloud-native geospatial
      ecosystem (COG, COPC, GeoParquet, Zarr readers).
- [ ] **Explore as a real data portal:** curated collections of public base layers (SRTM, rainfall grids), licences,
      and "used by" counts.

---

## P3 · The moat (what only Craton does)

- [ ] **Checks as code:** `.craton/checks.yml` in the repository (the checks page already shows the idea), custom
      checks as plugins (Python or WASM), results posted on PRs.
- [ ] **Run the model on every pull request:** a hosted runner that executes the HEC-RAS/SWMM plan on the PR's data
      and shows the change in results (inundation extent, peak stage at gauges) next to the data diff. This ties
      Craton to Nerolith's simulation engine and is the reason a team would never go back to shared drives.
- [ ] **Derived formats without touching history:** optional COG/COPC/GeoParquet copies generated per commit
      (DECISIONS.md §2 keeps originals byte-identical; derivatives live alongside).
- [ ] **Citable releases:** mint a DOI for a release (DataCite or a Zenodo bridge), generate `CITATION.cff`, show a
      "Cite this dataset" box with BibTeX and APA, include the Merkle root so a paper can prove exactly which bytes
      it used.
- [ ] **Provenance and audit packages** for regulators (the audit export already includes Merkle proofs): signed PDF
      reports, chain of custody from survey to model result, integration with Nerolith's LOCUS layer.
- [ ] **Lineage graph:** which model runs and releases used which version of each input file.
- [ ] **Offline and field mode:** work on a laptop with no connection for weeks, sync efficiently when back.

---

## How to use this list

1. Do all of **P0** before telling anyone outside the team about Craton. It's what separates "prototype" from
   "product" in a first impression.
2. Pick **P1** items by the activation funnel: whatever step loses the most new users goes first.
3. Start **P2** when the first organization over ~50 people asks for it, not before.
4. Keep one **P3** bet alive at all times; "run the model on every PR" is the strongest.

## Sources

- [Karri Saarinen: 10 rules for crafting products that stand out (Figma)](https://www.figma.com/blog/karri-saarinens-10-rules-for-crafting-products-that-stand-out/)
- [Inside design at Linear (Designer Fund)](https://designerfund.substack.com/p/ai-design-linear)
- [Linear app case study (Eleken)](https://www.eleken.co/blog-posts/linear-app-case-study)
- [Vercel Web Interface Guidelines](https://vercel.com/design/guidelines)
- [Why Stripe's API docs are the benchmark (Apidog)](https://apidog.com/blog/stripe-docs/)
- [Stripe: APIs as infrastructure, versioning](https://stripe.com/blog/api-versioning)
- [EnterpriseReady: single sign-on](https://www.enterpriseready.io/features/single-sign-on/)
- [EnterpriseReady: role-based access control](https://www.enterpriseready.io/features/role-based-access-control/)
- [WorkOS: enterprise readiness checklist](https://workos.com/blog/enterprise-readiness-checklist-2026)
- [Trust center examples for B2B SaaS (Veza Digital)](https://www.vezadigital.com/post/trust-center-examples)
- [SaaS DPA guide: subprocessors (Secure Privacy)](https://secureprivacy.ai/blog/data-processing-agreements-dpas-for-saas)
- [web.dev: Core Web Vitals](https://web.dev/articles/vitals)
- [Atlassian: incident postmortems](https://www.atlassian.com/incident-management/postmortem)
- [incident.io: incident communication best practices](https://incident.io/blog/incident-communication-best-practices)
- [Postmark: transactional email best practices](https://postmarkapp.com/guides/transactional-email-best-practices)
- [OWASP REST security cheat sheet](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [How to implement error budget tracking with OpenTelemetry (OneUptime)](https://oneuptime.com/blog/post/2026-02-06-error-budget-tracking-opentelemetry/view)
- [Figma: pricing page best practices](https://www.figma.com/resource-library/pricing-page-best-practices/)
- [SimpleLocalize: internationalization guide](https://simplelocalize.io/blog/posts/internationalization-guide-software-localization/)
- [Drata: GDPR for SaaS](https://drata.com/learn/gdpr/for-saas-compliance)
- [lakeFS: DVC vs Git LFS vs Dolt vs lakeFS](https://lakefs.io/blog/dvc-vs-git-vs-dolt-vs-lakefs/)
- [Cloud-Optimized Geospatial Formats Guide](https://guide.cloudnativegeo.org/)
- [Citation File Format](https://citation-file-format.github.io/)
- [Esri: ArcGIS Pro add-ins on the ArcGIS Marketplace](https://www.esri.com/arcgis-blog/products/arcgis-pro-net/announcements/arcgis-pro-add-ins-on-the-arcgis-marketplace)
