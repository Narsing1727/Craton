# Research backlog: what YC-style and top startups do (research only, nothing implemented)

Compiled 2026-10-15 from primary sources fetched during one research session (Stripe, GitHub, GitLab, Linear, Vercel, PostHog,
Hugging Face, lakeFS, Kart, DoltHub, DataHub, Great Expectations, OWASP, NIST, Google SRE, Figma, Notion, MCP, PMTiles,
HEC-RAS tooling, FEMA/TUFLOW QA) plus secondary articles where noted.

**How to read it**
- Each line is one idea. **Status** is my best reading of Craton today, from `UPGRADE_CHECKLIST.md`:
  ✅ have it · 🟡 partly · ⬜ gap · ❔ not sure, check before building.
- `(secondary)` marks claims that came from blogs or vendor pages, not from the company's own documentation. Treat as direction, not fact.
- Numbers quoted are as the source stated them; some are unverified and are flagged.

---

## 0. The short list: if only twenty things got built

Ranked by (value to a first-time visitor and to a paying hydro team) ÷ effort, from what the research kept repeating.

1. **Time-to-first-value path**: sign up, sample project, first clone/push in under 10 minutes, measured step by step. ⬜ measured / ✅ sample project exists
2. **Public roadmap + changelog + in-app "what's new"** so users see momentum (Linear, PostHog, Canny pattern). 🟡 changelog page only
3. **HEC-RAS model QA checklist + modelling log** as a first-class release artifact (TUFLOW, FEMA, state reviewers all require one). ⬜
4. **Declarative data checks in the repo** (`.craton-checks.json`, Great Expectations "expectation suites" style) with results page. ✅ built 2026-10-15 (results show on the Checks tab; no editor UI yet)
5. **Audit log for organisations** (who did what, exportable) and per-token request log. ✅ built 2026-10-15
6. **SSO (OIDC/SAML) + SCIM + domain verification** for the first institutional buyer. 🟡 domain verification + join-by-address built; Google and GitHub sign-in; SSO/SCIM ⬜
7. **Passkeys** (phishing-resistant, simplest strong sign-in). ✅ built 2026-10-16
8. **Secret scanning on push** with token prefixes + checksums so leaked tokens are recognised. ✅ built (checklist 138–144)
9. **Sandbox/test mode and a request-log page** (Stripe's best developer feature). ⬜
10. **Webhook replay + resend + endpoint health page.** ✅ replay and resend already existed; no separate endpoint health page
11. **`llms.txt` + Markdown twin of every docs page + agent skills file** (Stripe, Hugging Face, Mintlify pattern). ✅ built (checklist 145-149); MCP done
12. **PMTiles / COG tile serving** for fast zoomable previews straight from object storage. ⬜
13. **Datapackage / RO-Crate / DOI export** so a release is citable and portable (Zenodo, HydroShare). 🟡 CITATION + STAC + JSON-LD exist
14. **Spatial filter on clone** (Kart): only the tiles that cover my study area. ⬜
15. **Dataset values from HEC-RAS HDF** (WSE at a cell, hydrograph at a cross section) with run-to-run compare. ⬜
16. **Comments pinned to a map location / file region** (Felt). ⬜
17. **Usage meters + soft caps + 80/90/100% alerts** shown before billing exists (generous free tier as a product). 🟡 80/100% storage warnings
18. **Keyboard shortcut cheat-sheet and consistent shortcut hints** in the command menu. 🟡
19. **Status page + incident comms template** (Atlassian). ⬜ (removed earlier by request; revisit when public)
20. **SOC 2 groundwork** that costs nothing now: SSO+MFA enforced for staff, access reviews, logging, written policies, vendor tiers. ⬜

---

## 1. Startup and product strategy (YC, Paul Graham, PostHog, Linear)

### 1.1 What YC says to build and how fast
- Build the smallest thing that gives basic value to a small set of early users; weeks, not months. (Seibel MVP talk, secondary summaries)
- Hold the problem tightly, hold the solution loosely.
- Write a spec; when time slips, cut the feature list aggressively, even important-but-not-critical items.
- Launch before you feel ready; you only learn what users want once the product is in front of them, not from surveys or mailing lists. (YC MVP talk)
- "Make something people want"; the decision rule is "do whatever's best for your users." (PG, *How to Make Wealth/Do Things*)
- Launch quickly so users force you to learn what makes them happy.
- Build something users need to come back to (daily use).
- Charm users rather than bully them; small companies win by satisfying.
- Make users love it enough to tell friends; word of mouth is the most convincing growth to investors.
- Solve the problem "the right way" and let that carry growth.
- Never buy users (counting bought or inactive users distorts the compass).
- Do not obsess over the business model first; making money is easier than building something great.
- Launching is a process, not one event: silent launch, friends and family, online community, repeat. (Startup School write-up, secondary)
- Avoid "the Big Launch" and big partnerships early; they cost more than they return. (PG, *Do Things That Don't Scale*)

### 1.2 Things that don't scale (Paul Graham)
- Recruit users one at a time, by hand; the founder does early sales.
- Set the user up on the spot ("Collison installation": configure it for them when they say yes).
- Deliver an unreasonable level of attention: hand-written thank-you notes, personal onboarding.
- Watch your first users use the product in person.
- Start in a narrow market, the part that will sign up fastest (Facebook/Harvard), then expand.
- For B2B, target other startups first; they adopt quickly and grow with you.
- Do the automated thing by hand first (Stripe set up merchant accounts manually); be the product temporarily, then automate the bottleneck.
- Serve one user like a client until the product fits them.
- Use the software for customers yourself (Viaweb built merchants' stores).
- Pair what you build with the unscalable work that gets it started.

### 1.3 Growth maths (PG, *Startup = Growth*)
- A startup is a company designed to grow fast; the growth rate is the number to know.
- Measure the ratio, not the count: a steady number of new users per week means the rate is falling.
- Weekly growth benchmarks (YC): 5–7% good, 10% exceptional, ~1% means you haven't found it yet.
- Pick a weekly target and treat missing it as an alarm; use it to choose between ideas.
- Compounding yearly multiples: 1% weekly ≈ 1.7×, 5% ≈ 12.6×, 10% ≈ 142×.
- Revenue is the best measure; before revenue use active users.
- ⬜ Craton has no weekly active-repo / weekly pushes dashboard for its own growth rate.

### 1.4 Talking to users (YC Startup School, Migicovsky; Linear)
- Ask about the last time they hit the problem, what was hardest, what they tried, what they dislike about it.
- Do not pitch, do not ask hypotheticals ("would you use…?"), do not talk more than you listen.
- Ten to fifteen minute first interviews; take notes, record if allowed.
- Ask how much the problem costs them today (pricing signal).
- The "very disappointed" survey: how would you feel if you could no longer use it; measure the % who say very disappointed.
- "Hair on fire" problems: users willing to prepay.
- Don't take feature requests at face value; ask the use case, the pain, what would change if fixed. (Linear)
- Be careful with feedback from users outside your target segment; it pulls you off course. (Linear)
- Balance vision and feedback; don't be purely reactive. (Linear)

### 1.5 Product-market-fit signals (YC library, secondary)
- Returning usage: share of signups who come back within 1, 3, 7, 30 days.
- NPS above 50 is "pretty well" (Rusenko, secondary).
- Paying-customer renewal rate.
- Demand outruns supply: "drowning in demand", hiring support as fast as possible.
- Is the growth profitable, or almost killing the company? (Seibel)
- Watch real usage in context (Segment watched students' laptop screens).

### 1.6 How PostHog decides what to build
- Agree on product principles that let you say no, even to good ideas.
- Tie principles to strategy (their examples: provide every tool needed to evaluate success; get in first; be the source of truth for customer and product data).
- Map everything users want before narrowing; plot features against ideal-customer fit; effort vs impact grid; vote.
- One owner per feature who validates, builds, maintains and tracks it; avoid multi-meeting decision chains.
- Ship MVPs in 1–3 person teams; reuse internal primitives; validate with internal use first.
- Pitfalls named: feature factory, building for big customers, over-focusing on competitors, favouring easy features, chasing the most MRR.
- Publish the roadmap and let users comment and vote.
- Open handbook (strategy, pay) as a growth and hiring asset. (secondary)
- Hired a product person later than they should have (their own "mistakes" post, secondary).
- ⬜ Craton has no written product principles document. Cheap to write, high leverage.

### 1.7 The Linear method
- Set direction, set useful goals, prioritise enablers and blockers, scope projects down.
- Write issues, not user stories; short plain titles, optional descriptions, quote user feedback directly and link the conversation.
- Everyone writes their own issues; people file problems, assignees propose solutions.
- Spend time up front (sometimes a couple of weeks) settling the approach before building.
- Build with users; launch and keep launching; build in public.
- Evolve the product rather than rebuild; ship UI changes behind a flag and test internally first.

---

## 2. Onboarding and activation

- Define "first value" as the tool doing something useful for the user, not just a successful call. (secondary)
- Target first value in 5–10 minutes; developers give about ten minutes of attention. (secondary)
- Measure each step with timestamps: signup, token created, first clone, first push, first check passed. ⬜
- Activation rate and time-to-value predict retention better than feature adoption or tour completion. (secondary)
- Route different users to different fastest paths (modeller, GIS analyst, team lead) rather than one generic flow. 🟡 role question exists
- Sample project so people learn by exploring (Carbon "starter content" empty state). ✅
- Getting-started checklist on the dashboard. ✅
- Empty states with one primary action, a secondary docs link, and no dead ends. ✅/🟡
- "Copy all commands" for the first-run terminal flow. ✅
- Avoid email verification gates before the first value; let people in and nag later. 🟡 (verification blocks only public repos)
- Don't ask for an API key before showing anything; generate keys inline in the quickstart. 🟡
- Quickstarts that don't assume one operating system (Windows is the main platform for the target users). ❔
- Instrument time from key creation to first successful call; track first-call success rate. ⬜
- Time-to-hello-world as a team KPI (Fern, Infobip case study, secondary). ⬜
- Send a personal welcome note for the first 100 users (PG thank-you notes). ⬜
- An "import from where you are today" path: zip upload, folder drag-drop, existing HEC-RAS project detection. 🟡

---

## 3. UX principles that recur everywhere

### 3.1 Nielsen's ten heuristics, applied
- Visibility of system status: progress for uploads, clear in-flight states. ✅
- Match the real world: say "crest elevation", not internal terms.
- User control and freedom: Undo (delete branch, close issue) and visible Cancel. ✅/🟡
- Consistency and standards: same icon and word for the same action everywhere.
- Error prevention: confirm destructive actions, scale confirmation to severity (type the name for severe ones). ✅
- Recognition over recall: pickers and examples, not memorised syntax.
- Flexibility and efficiency: shortcuts, command menu, saved filters. ✅
- Minimalist design: hide rarely-used fields behind "Advanced".
- Error recovery: plain-language message plus the fix. ✅
- Help and documentation in context: short help at the field. 🟡

### 3.2 Vercel Web Interface Guidelines (extracted checklist)
**Interaction**
- Everything keyboard-operable; visible, unobscured focus ring; `:focus-visible`.
- Hit targets ≥24px (44px on mobile) even if the visual is smaller. ✅
- Never disable zoom; never block paste.
- Keep the label on loading buttons and add an indicator. ✅
- Show-delay (150–300 ms) and minimum visible time (300–500 ms) on spinners and skeletons to prevent flicker. 🟡
- Persist UI state in the URL so share, refresh, Back/Forward work (filters, tabs, pagination, expanded panels). 🟡
- Optimistic updates with reconcile and Undo.
- Menu items that open a follow-up end with an ellipsis.
- Confirm destructive actions or offer Undo within a safe window. ✅
- Warn before navigating away from unsaved data.
- Tooltip groups: delay the first, show the rest immediately.
- Keep scroll position on Back/Forward.
- No dead zones: if it looks interactive it is.
- Real `<a>` for navigation so Cmd/Ctrl+click works. ✅ (we hit this exact issue with the Google button)
- Announce toasts and validation with a polite live region.
- `overscroll-behavior` handled deliberately in modals and drawers.
**Forms**
- Label every control; click-to-focus; don't pre-disable submit; show errors next to the field and focus the first error. ✅
- Correct `type`, `inputmode`, `autocomplete`, `name`; disable spellcheck on emails/codes.
- Allow pasting one-time codes; keep password managers working.
- Idempotency key on submit; disable only after submission starts.
- Trim trailing whitespace; 16px minimum input font on mobile.
**Motion**
- Honour `prefers-reduced-motion`; animate transform/opacity only; never `transition: all`; interruptible; anchor transform origin.
**Layout and content**
- Skeletons mirror the final content exactly. 🟡
- Design empty, sparse, dense and error states for every screen. ✅
- Handle short, average and very long user content.
- Tabular numerals for numbers; don't rely on colour alone; locale-aware dates and numbers; language from `Accept-Language`, not IP.
- `translate="no"` on brand names and code.
- Set `scroll-margin-top` on headings targeted by in-page links.
**Performance**
- Mutations (POST/PATCH/DELETE) under 500 ms. ❔ measure
- Virtualise large lists or `content-visibility: auto`. ✅
- Explicit image dimensions; preload only above the fold; preconnect to asset origins.
- Looping `<video>` instead of GIFs.
**Visual polish**
- Layered shadows (ambient + direct), borders + shadows, concentric radii (child ≤ parent), tinted borders on tinted backgrounds.
- `theme-color` meta matches the page; `color-scheme: dark` on dark themes. ✅
**Copy**
- Active voice, second person, specific labels ("Save API Key", not "Continue"), consistent nouns, numerals for counts, positive framing even for errors.
- One decimal convention for currency per context; non-breaking space between number and unit.

### 3.3 Linear's UI design decisions
- Generate themes from three inputs (base colour, accent, contrast) in a perceptually uniform space (LCH), not 98 hand-set variables.
- Elevation expressed with black/white opacity first, colour second.
- Reduce chrome noise: sidebar, tabs, headers, panels; raise hierarchy and density of navigation.
- Align labels, icons and buttons precisely; users feel it over time.
- Filters in a header, metadata in a side panel, multiple views of the same data (list, board, timeline, split, fullscreen).
- Use display type for headings (Inter Display), regular for body.
- Inbox organised by notification type with teammates' faces emphasised.
- Pair designer and engineer daily; ship behind a flag; test across all view types.
- ✅ Craton theme is fixed by decision; ⬜ no "high contrast" theme variable yet.

### 3.4 Command palette and keyboard-first (secondary)
- One keystroke for find + act (create issue, toggle theme), not only navigate. ✅
- Palette scales better than a nav menu as features grow.
- Show shortcut hints next to actions to teach them. 🟡
- Don't hide the plain path; palette is an accelerator, not the only route.
- Internationalise shortcuts for non-QWERTY layouts; show platform-specific modifier symbols.
- Recent items, fuzzy ranking, scoped sub-palettes (repo, file). 🟡
- Cheat-sheet overlay on `?`. ❔

---

## 4. Data-heavy UI patterns

### 4.1 Tables (Pencil & Paper enterprise-table analysis)
- Left-align text, right-align quantitative numbers, tabular figures; never centre-align table content.
- Density switch: 40 / 48 / 56 px rows; control placed outside the table.
- Vertical alignment: centre up to ~3 lines, top-align beyond.
- Avoid zebra stripes (clash with hover/selected states); 1px light separators only.
- Freeze the first column; optionally the last (totals).
- Column controls: reorder, hide, resize with a drag handle on hover, reset to default.
- Persist view settings per session or per account; always offer reset.
- Sticky header and action bar; sticky footer for totals; bottom-fixed selection toolbar when rows are selected.
- Default sort that fits (most recent / most urgent).
- Highlight search matches inside rows.
- Row actions revealed on hover; details via expand, side drawer, modal or full page depending on context needed.
- Checkbox appears on hover; bulk actions after selection.
- Inline edit with a cursor hint on hover; heavier friction (drawer/modal) for high-stakes data.
- ⬜ Craton's CSV viewer has none of: column hide/freeze/resize, density, saved views.

### 4.2 Saved views, filters and search
- Saved filters with names, shareable by URL. ✅ (issues, pulls)
- Query-language filters (`reason:review-requested`, `is:done`). ✅ operators on issues/PRs
- Views as a first-class object (list/board/table of the same data). ⬜
- Search across files, columns and values (not only names). 🟡

### 4.3 Diffs for data
- Datafold: diff runs automatically on PR; shows row counts, schema, keys, column differences, links to value-level diffs. (secondary)
- Show downstream impact (column-level lineage) and flag changes that still pass range checks (a unit swap). ⬜
- Sampling for very large diffs, with a clear note. ⬜
- Impact summary comment on the PR. ✅/🟡 (checks + diff cards; no impact summary comment)
- Table diff by key; raster stats diff; text diff for models. ✅
- Structural diff for HDF5 results (shape, attributes). ✅ (new)
- Visual swipe/overlay between two rasters on the PR. ⬜ (MapLibre compare slider in backlog)

### 4.4 Maps (Felt, Kepler.gl)
- Layers panel: reorder, blend, hide, per-layer style; legends. 🟡
- Filters on attributes; time playback for temporal data. ⬜
- Tooltips, brushing, coordinate display, split maps. ⬜
- Layer types: point, line, polygon, grid, hexbin, heatmap, vector tile, raster tile. 🟡
- Export image, data, map, video. ⬜
- Comments that mark a location (no shapes), with @mentions, resolve, emoji reactions; public viewers can comment anonymously. ⬜ (Felt)
- Link to a specific feature (opens its popup) and a saved default view. ⬜ (Felt)
- Embed with display options. ✅
- Sharing levels: view (no seat) / contribute / edit; public link: none / view / view+comment. 🟡

---

## 5. Notifications and communication

- Carbon taxonomy: inline, toast, actionable, callout, banner, notification panel, modal; each with persistence rules.
- Don't time-dismiss critical messages; let people limit noncritical ones; actionable notifications take focus (accessibility cost).
- GitHub model: inbox, mobile push, email with filterable headers; Done / Save / Unsubscribe; bulk triage; reasons shown on each item (mentioned, subscribed, review requested). 🟡
- Default subscription rules: assigned, authored, commented, watched, @mentioned (also team mentions). 🟡
- Per-thread preferences; custom routing per repo and per reason. ⬜
- Email headers that state the reason and recipient. ⬜
- Digest emails (daily/weekly activity). ⬜
- Slack / Teams / webhook sinks for pushes, PRs, failed checks. ⬜
- "Quiet hours" / schedule for push. ⬜
- Public announcements via changelog + banner dismissible across sessions. 🟡

---

## 6. Documentation and developer experience

- Four doc types (Diátaxis): tutorials, how-to guides, reference, explanation; keep them separate. 🟡 task-based quickstarts exist
- Task-based home ("accept payments") not company-based navigation. (Stripe, secondary) ✅/🟡
- Runnable code samples integrated in the page; copy button; language/OS switcher. 🟡
- Docs searchable, linkable, version-matched, offline in the terminal (`stripe docs`, `man`). ⬜ `craton docs`
- API reference collapses nested params, expandable with `?query=`. 🟡
- Docs detect the logged-in account's API version and warn about changes since. ⬜
- Docs authored in a structured Markdown superset (Markdoc). ⬜
- Doc pages that note the plan or role required.
- Changelog: write for people; every version; group by Added/Changed/Deprecated/Removed/Fixed/Security; ISO dates; Unreleased on top; flag yanked releases. 🟡
- Deprecation notices with dates and migration steps; warn until migrated. ⬜
- Status of "what's coming" public (roadmap). ⬜
- Built-in troubleshooting page: `craton doctor` output explained. ✅/🟡
- Community health files (README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, GOVERNANCE, good first issues) for the open parts. ⬜
- Pre-filled bug-report URL with environment details from the CLI. ⬜

---

## 7. CLI (clig.dev guidelines, line by line)

**Basics and help**
- Exit 0 on success, non-zero by failure mode; primary output to stdout, messages and logs to stderr. ✅
- `-h/--help` everywhere; concise help when args are missing (description, 1–2 examples, key flags, pointer to `--help`).
- Lead help with examples; common flags first; link to web docs per subcommand; include a support path. ✅/🟡
- Suggest the likely command on typos; ask before running a corrected command. ⬜
- If input is expected on a pipe but stdin is a terminal, show help instead of hanging.
**Output**
- Detect TTY for human vs machine output; `--json`, `--plain`, `-q/--quiet`, `--no-color`; honour `NO_COLOR`, `TERM=dumb`. ✅ `--json`; ❔ rest
- State changes reported explicitly, including the resulting state; suggest next commands.
- Colour sparingly; no animation when not a TTY; page long output only on a TTY.
- Errors: catch expected ones and rewrite as actionable messages; most important information last; group repeats. ✅
- Unexpected errors: debug info plus how to file a bug, pre-filled URL. ⬜
**Arguments**
- Prefer flags to positionals; long form for every flag; standard names (`-n/--dry-run`, `-f/--force`, `-q`). 🟡
- Never *require* a prompt: everything promptable is also a flag; `--no-input`. ❔
- Confirm dangerous actions proportionally; `--confirm` for scripts.
- Never accept secrets via flags; use files or stdin. 🟡 (`auth login --token` takes the token as a flag; `CRATON_TOKEN` exists)
- `-` for stdin/stdout wherever a file is accepted.
**Robustness**
- Validate input early before side effects; print something within ~100 ms; show progress for long operations.
- Make operations recoverable and idempotent so re-running resumes. ✅ (resumable clone, resumable push)
- Crash-only design; Ctrl-C exits fast with a message; second Ctrl-C skips cleanup.
- Configurable network timeouts; assume misuse (scripts, poor networks, concurrent runs). ✅
**Configuration**
- Precedence: flags > env > project config > user config > system; follow XDG; ask consent before editing configs you don't own. 🟡
- Never read secrets from environment variables (their position; common practice differs). 🟡
**Naming, distribution, analytics, future-proofing**
- Short lowercase name; single binary where possible; easy uninstall documented. ⬜ (needs Node today)
- No usage analytics without consent; be explicit about what, why and how long. ✅ none today
- Treat flags and output as public interfaces; additive changes; warn before breaking; no catch-all default subcommand; no arbitrary prefix abbreviations. ✅/🟡

---

## 8. API design (Stripe)

- Resource-oriented URLs, predictable verbs, JSON responses, standard HTTP codes. ✅
- Version by date, pinned per account on first request; override with a header per request; upgrade from the dashboard. ⬜ (Craton has `apiVersion: 1`)
- Backwards-incompatible changes isolated in "version change modules"; responses built for the current version then transformed backward. (design reasoning worth copying later)
- Changelog generated from the change modules; docs tailored to your version. ⬜
- Written proposal and review for every API change to avoid version debt. ⬜
- Idempotency keys on every POST (up to 255 chars); store status code and body of the first request, including 500s; compare incoming parameters and error on mismatch; prune after ≥24 h. ✅ (idempotency layer exists)
- Error object: `type`, `code`, `message`, `param` (which field), `doc_url`, `request_id`, link to the request log. 🟡 `{code,message}`
- Error type taxonomy: `api_error`, `invalid_request_error`, `idempotency_error`, `card_error` (domain-specific). 🟡
- 409 for conflicts (same idempotency key, different params); 424 for failed dependency; 429 with backoff advice. ✅/🟡
- `expand[]` to inline related objects; `metadata` key-value on objects; list endpoints with cursor pagination (`starting_after`, `limit`). ❔
- No bulk updates; one object per request (keeps semantics simple).
- Test mode keyed by the API key; sandboxes isolated from live data. ⬜
- Request IDs on every response and in logs. ✅ (access log)
- Rate limits: token bucket per user; allow bursts; same behaviour in test and live. ✅ per-IP; ⬜ per-token
- Four limiters: request rate, concurrent requests, fleet load shedding (critical vs non-critical), worker utilisation shedding. ⬜ concurrency/shedding
- Dark-launch each limiter first to see what it would block; kill switches; fail open on limiter bugs. ⬜
- Online migrations: dual-write, switch reads with a comparison tool, switch writes, remove old data; keep services online. (worth adopting for schema moves) ⬜
- Public OpenAPI document, SDKs in major languages generated from it. ✅ OpenAPI, Python SDK; ⬜ JS/Go SDK

---

## 9. Webhooks and integrations

- Sign with HMAC-SHA256 over payload + timestamp; reject stale signatures; constant-time compare. ✅
- HTTPS only; block internal IPs (SSRF). ✅
- Retries with exponential backoff and jitter; dead-letter after exhaustion; documented retry schedule. 🟡
- Receivers: verify the raw body, handle duplicates idempotently, respond fast and process async, rotate secrets. ✅ docs
- Delivery observability: attempts, response codes, latency, payload viewer, **resend/replay**. ✅ last ten and resend exist; ⬜ payload viewer
- Auto-disable dead endpoints with a notice. ✅
- Event catalogue with example payloads from one source. ✅
- Secret rotation with overlap window (two valid secrets). ⬜
- Per-endpoint event filtering and per-repo scope. ✅
- Native integrations: Slack, Teams, Jira, Zendesk, QGIS plugin, ArcGIS. ⬜
- Zapier/Make/n8n triggers. ⬜
- GitHub App / OAuth app model with installation tokens and fine-grained permissions. ⬜

---

## 10. AI and agent surface (MCP, llms.txt, skills)

- MCP server with tools, resources, prompts; discovery via `server/discover`; per-request protocol version and capabilities; stateless requests. ✅ 9 tools; ⬜ resources and prompts
- Streamable HTTP transport with OAuth for remote servers (not only stdio). ⬜
- Progressive tool discovery when many tools; cache hints (`ttlMs`, `cacheScope`). ⬜
- Elicitation (ask the user for confirmation or missing input) for risky tools. ⬜
- Tasks extension for long-running requests (polling handle). ⬜
- `llms.txt` at the root: H1 name, blockquote summary, H2 link lists with notes, "Optional" section; Markdown twin of every page (`page.md`); `rel="alternate" type="text/markdown"` links. ⬜
- Agent skills published at `/.well-known/skills/index.json`; CLI `agent setup` that installs skills and MCP config. ⬜ (Stripe, Hugging Face)
- Agent-friendly CLI: JSON output, explicit non-interactive flags, structured errors with next steps. ✅/🟡
- Agent-friendly tool design: flatter inputs, fewer optional fields, self-describing outputs with a human summary; errors that suggest the next step (secondary).
- Safety classification of tools by private-data access, untrusted content, external communication; block paths that combine all three (secondary). ⬜
- Natural-language search over repos, issues and files; AI summaries of commits and PRs; "explain this change". ⬜ (nothing found in sources on how to do well; treat as experiment)
- GitHub shipped recently (Oct 2026): leaked-secret detection model, stacked pull requests, async merge API, workflow lockfiles, Copilot local sandboxing. (their changelog) Signals where the host-platform bar is moving.

---

## 11. Identity, authentication and sessions

### 11.1 Passwords and sign-in (NIST 800-63B, OWASP)
- Length over complexity: ≥15 characters single-factor (8 with MFA), allow ≥64, allow all Unicode and spaces; no composition rules; no periodic rotation. 🟡 (12 min today)
- Block breached, common and context-specific passwords (whole-string compare); say why. ⬜
- Allow paste and password managers; show-password toggle. ✅
- Hash with a salted, slow scheme; a keyed hash with a separately stored secret is recommended. ✅ scrypt; ⬜ pepper
- Generic errors and identical timing/status for unknown vs wrong; consistent processing time (no quick exit before hashing). 🟡
- Throttle per account not per IP; exponential lockout with a cap; don't let lockout become denial-of-service (reset flow still works). ✅
- Email-based out-of-band codes are discouraged as an authenticator; SMS restricted. ✅ (not used)
- Changing email: require MFA or password, notify the old address, confirm at the new one with a time-limited link. 🟡
- Re-authenticate after recovery or password change; invalidate sessions. ✅
- AAL levels: reauth within 24 h and 1 h idle for AAL2; phishing-resistant option must be offered. ⬜

### 11.2 Sessions (OWASP)
- ≥64 bits of entropy (128 recommended); opaque; generic cookie name; reject IDs not issued. ✅
- `Secure`, `HttpOnly`, `SameSite`, prefer `__Host-` prefix; never in localStorage. 🟡
- Regenerate on privilege change; separate cookie names pre/post auth. ❔
- Idle and absolute timeouts, enforced server-side. 🟡 (30 days absolute only)
- Logout invalidates server-side; `Clear-Site-Data`; `Cache-Control: no-store`. ❔
- Visible active sessions list, remote revoke, alerts on new device. ✅
- Log session lifecycle with a salted hash of the ID, never raw. ❔
- Detect anomalies: IP/UA change mid-session, many invalid IDs. ⬜

### 11.3 Passkeys, SSO, tokens
- Passkeys: per-site key pair, public key on server, phishing-resistant, synced by platform. ⬜
- Conditional UI (autofill passkeys in the username field), registration prompt after a successful password login. ⬜
- Recovery path that does not defeat the passkey (backup codes). ✅ codes exist for 2FA
- Token format: prefix by type, `_` separator, checksum in the last characters (CRC32, base62), ≥160-bit entropy; enables offline validation and secret scanning with very low false positives. ✅ `crt_pat_` + CRC-32 checksum
- Fine-grained tokens limited to named repositories and scopes with expiry and last-used. ✅
- Secret scanning on push and push protection with delegated bypass; partner program notifying vendors. ⬜
- OAuth for third-party apps, device-code flow for the CLI. ⬜ CLI uses pasted tokens
- Sign in with Google done; Microsoft, GitHub, SAML next. 🟡

---

## 12. Enterprise readiness and compliance

### 12.1 What buyers ask for (WorkOS, SSOJet, secondary)
- SSO first (SAML 2.0 and OIDC), self-serve setup, routing by verified email domain. ⬜
- SCIM for automatic offboarding; ~1,000 seats makes it a contract dependency. ⬜
- Per-tenant audit log with user, IP, timestamp, action, outcome; export/stream to a SIEM; each admin sees only their org. 🟡
- RBAC scoped to the organisation, custom roles later; least privilege. 🟡
- Admin portal so customer admins self-serve members, roles, SSO, SCIM, logs, branding. ⬜
- Domain verification; enforce SSO for a domain; "managed users". ⬜
- IP allow-lists, session length policy per org, MFA enforcement per org. ⬜
- Data residency / storage region choice (Hugging Face "Storage Regions"). ⬜
- Resource groups (Hugging Face): scope access to sets of repos. ⬜

### 12.2 SOC 2 groundwork (secondary)
- Start with identity and access: SSO and MFA for staff, least privilege, onboarding/offboarding procedure, quarterly access reviews.
- Centralised logging and monitoring of logins and config changes.
- Written policies: information security, access control, incident response, change management, vendor management, business continuity.
- Vendor inventory tiered by risk with due diligence per tier.
- Type II needs controls running before the observation period (typically 6–12 months).
- Cheap proofs to start: dependency scanning, branch rules, backups tested, restore drill.

### 12.3 Privacy (GDPR, secondary)
- Self-service data export and deletion (one month to respond). ✅
- Signed DPA, published subprocessor list, DPIA where needed, breach plan. ⬜
- Consent before non-essential cookies; the site sets none today. ✅
- Retention schedule documented (backups, logs, deleted accounts). 🟡
- Privacy by design in the data model: separate PII, delete cascades. ✅/🟡

### 12.4 API security (OWASP API Top 10, 2023)
- BOLA (object-level auth on every ID), broken authentication, object-property-level auth (field-level read/write), unrestricted resource consumption, function-level auth, unrestricted sensitive business flows, SSRF, misconfiguration, improper inventory, unsafe consumption of third-party APIs.
- ✅ webhooks block private IPs; ✅ body ceilings; 🟡 per-property authorisation review; ⬜ API inventory/deprecation process.

---

## 13. Multi-tenancy, limits, pricing and billing

- Shared schema + row-level security vs schema-per-tenant (breaks around ~500 tenants) vs database-per-tenant (secondary). 🟡 app-level checks, SQLite
- Index (tenant, time); evaluate RLS helper functions once per query, not per row (secondary).
- Noisy-neighbour controls: per-tenant rate limits, concurrency caps, statement timeouts, dedicated workers for big tenants. 🟡
- Usage meters feeding billing; prepaid credits and burndown; thresholds and alerts; real-time usage visibility (Stripe Billing/Metronome). ⬜
- Pricing page patterns: show all tiers and limits without sign-up; calculator for usage components; free tier as a product (no time limit, no card); soft caps with 80/90/100% warnings; explain overage behaviour; grandfather price changes (secondary). 🟡
- Plans: storage, private repos, seats; per-seat vs usage; a "student/academic" tier (Hugging Face Academia Hub, Felt classrooms). ⬜
- Trials, proration, invoices, tax/GST for India, receipts. ⬜
- Transparent public pricing and a published roadmap as trust signals for small teams (PostHog). 🟡

---

## 14. Reliability, observability and operations

- Four golden signals: latency (split success/failure), traffic, errors (explicit, implicit, by policy), saturation. 🟡
- Page on symptoms, use causes for debugging; page only when urgent, actionable and user-visible; never "something seems weird." ⬜
- Prebuilt dashboards with the four signals; prefer dashboards over email for sub-critical issues; delete unused signals.
- SLOs and error budgets; public status page; incident comms cadence and templates; post-incident review. ⬜
- `/ready` with dependency checks, `/health`, version endpoint. ✅
- Structured JSON access log without secrets. ✅
- OpenTelemetry traces and metrics. ⬜
- Backup, restore drill, retention, point-in-time recovery. ✅ docs / ⬜ drill schedule
- Feature flags and staged rollouts; kill switches for new limiters. ⬜
- Synthetic checks from outside (clone/push canary every N minutes). ⬜
- Zero-downtime migrations playbook (dual write, verify, switch). ⬜
- Chaos-lite: API down, slow API, storage down pages tested. ✅

---

## 15. Storage engine and scale

- Chunk-level dedup (Xet): content-defined chunks, pointer files, faster uploads/downloads than Git LFS. ✅ (Craton's core)
- Storage Buckets alongside versioned repos (mutable object storage, same dedup). ⬜ idea: scratch/working storage not versioned
- Packs for many tiny chunks (measured: not needed yet). ✅ decision recorded
- Range-read friendly formats: COG, COPC, GeoParquet, FlatGeobuf, PMTiles, Zarr; cloud-optimised HDF5 by consolidating metadata; kerchunk/VirtualiZarr reference files to read HDF5/NetCDF without conversion (open in ~0.5 s vs 8–9 s in one benchmark). 🟡 COG advisory only
- Content-defined chunking measured to keep edits local; layout (tiled vs striped) matters more. ✅
- Lineage/provenance: Merkle root in every commit and audit package. ✅
- Garbage collection policy and retention per branch/tag; "keep forever" for releases. 🟡
- Cross-region replication and restore. ⬜
- Client-side caching of chunks across clones (shared local object cache). 🟡 resumable cache

---

## 16. Collaboration and real-time (Figma, Notion)

- Server-authoritative multiplayer; per-document process; property-level last-writer-wins; conflicts only on same property. ⬜ (not needed for files, relevant for comments/metadata)
- Fractional indexing for ordering; parent-link as one property so reparenting is atomic.
- Offline: reload fresh state and replay local edits. n/a
- Multiplayer undo that doesn't clobber others' work.
- Presence and cursors on shared views (map, dictionary editor). ⬜
- Notion model: everything is a block with id/type/properties/content/parent; type changes keep properties; permissions inherit via parent pointers; transactions group operations; local cache + transaction queue; background jobs for history and search indexing. (pattern for a comments/wiki layer)
- Locking as the pragmatic alternative to merging for binary geodata. ✅ (locks)
- Optimistic UI + server validation of both "before" and "after" snapshots. 🟡

---

## 17. Feature parity with code hosts (GitHub, GitLab, Hugging Face)

### 17.1 GitHub (features page, docs, rulesets)
- Rulesets: restrict who can push/delete/rename tags, block force pushes, require signed commits, require PR reviews, control commit message and author email, restrict file paths, path length, extensions and **file size**; target by `fnmatch`; layered (most restrictive wins); bypass lists by role/team/app; up to 75 per repo; active/disabled status. 🟡 lock patterns + owner approval
- Protected branches, draft PRs, required status checks, auto-merge, merge queue, suggested changes, stacked PRs. 🟡/⬜
- Code review: review requests, CODEOWNERS, reviewer suggestions, review conversations resolved. ✅/🟡
- Projects (table/board/roadmap views), milestones, labels, issue templates, Discussions. 🟡 (no discussions/projects)
- Releases with generated notes, assets, immutable releases; tags. ✅
- Packages/registries; Pages; Codespaces. n/a (Pages-like "publish a dataset page" ⬜)
- Insights: contributors, traffic, dependency graph. 🟡
- Security: security policy, advisories with private forks, dependency graph, SBOM export, secret scanning (+AI-detected), push protection with delegated bypass, custom patterns, code scanning, Autofix, artifact attestations. ⬜
- Governance: organisations, teams, team sync, custom roles, domain verification, audit log streaming, enterprise managed users, SAML/LDAP. ⬜
- Community profile checklist (README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT). ⬜
- Topics, trending, collections, Stars, Sponsors. 🟡 topics, trending, stars
- Mobile app, CLI, Desktop app. 🟡 CLI

### 17.2 GitLab (features page)
- Push rules, merge request guardrails, protected environments, multiple approvers, code quality reports. 🟡
- Issue weights, iterations, scoped labels, epics, time tracking, status page, SLA timers, on-call and escalation. ⬜
- Compliance frameworks, security dashboards, audit events, value stream and DORA metrics. ⬜
- Geo (distributed cloning), disaster recovery, dependency proxy. ⬜

### 17.3 Hugging Face Hub (closest analogue to "git for data")
- Repos with versioning, commit history, diffs, branches; Xet backend. ✅
- Model/Dataset **cards** with structured metadata (tasks, languages, eval results, licence). 🟡 README + dictionary + checklist
- **Data Studio**: in-browser dataset viewer, also for private datasets. 🟡 previews
- Gated access (users must request/accept terms or share contact info to download). ⬜
- Collections (curated lists of repos). ⬜
- Pull requests and Discussions on every repo; can be disabled; notifications. 🟡
- Webhooks, access tokens management, rate limits page, resource groups, audit logs, SSO, advanced security, network security, storage regions. 🟡
- DOI minting for repos; Paper pages; Academia Hub. ⬜
- Renames/transfers redirect the old URL and keep counters; precise rules per role. ✅/🟡
- Download stats per repo. ⬜
- Malware scanning on uploads; signed commits (GPG). ⬜
- Spaces (hosted demo apps): analogous to "hosted flood-map viewers". ⬜
- Jobs/scheduled runs; CLI for AI agents; MCP server; agent skills. 🟡

---

## 18. Data-versioning competitors: ideas to borrow

### 18.1 lakeFS
- Zero-copy branching; atomic commits; rollback; reproducibility.
- **Hooks** on commit/merge (pre-commit, pre-merge) to run data-quality tests; protected branches so hooks can't be bypassed. 🟡 (gate runs on push; no user-defined hooks)
- Garbage collection retires old commits per policy (cost and compliance). ✅
- Open source (Apache 2.0) with a managed cloud and an enterprise tier; the search summaries did not say which features sit in the enterprise tier. ⬜

### 18.2 DVC / DagsHub / Oxen
- Git + remote storage; pipelines (`dvc repro`) and experiments tracking; model registry; dataset browsing; annotation workspace (DagsHub). ⬜ pipelines
- Complaint patterns: CLI-first, manual remote configuration, weak on very large datasets (secondary) → Craton's hosted-by-default and chunking are the answer.
- Oxen: fast large-file remotes; positioned for big repos (secondary).

### 18.3 Kart (Git for geospatial)
- Dataset types: vector/table, point cloud, raster; formats GeoPackage, PostGIS, MySQL, SQL Server working copies. 🟡
- **Spatial filter**: clone/checkout only features intersecting a polygon; index and limitations documented. ⬜
- Working-copy model (edit in QGIS/GIS database, commit back); conflict resolution on features; patch format; linked datasets. ⬜
- QGIS plugin. ⬜
- Dataset format versions (Table V1/V2/V3, Point Cloud V1, Raster V1) are documented as separate formats; my inference is that per-feature storage is what makes diffs per feature, not confirmed from the page. ⬜ (Craton diffs by key for CSV only)

### 18.4 DoltHub
- (From memory: the DoltHub docs page returned 404, so this was not verified in this session.) SQL diffs, pull requests on data, branches, SQL console in the browser, data bounties, forks, jobs. ⬜
- Versioning tables rather than files; not for petabytes. (differentiation: files and rasters)

### 18.5 Weights & Biases Artifacts
- Versioned artifacts with aliases (`:latest`, `:production`), lineage graph, references to external object storage, registry. 🟡 tags/releases; ⬜ aliases and lineage graph
- References to files in external buckets without copying (bring-your-own-bucket). ⬜

---

## 19. Data catalog, quality and lineage

### 19.1 DataHub
- Search across datasets, dashboards, models, files; lineage; profiling; ownership; PII tracking; data contracts; assertions; anomaly detection; UI and CLI ingestion; APIs/SDKs.
- Craton fit: ownership ✅ CODEOWNERS; contracts ⬜ (a "data contract" = expected CRS, units, nodata, columns, extent).

### 19.2 Great Expectations
- **Expectation**: declarative assertion; **suite**: reusable collection; **validation definition**; **checkpoint** runs validations and triggers **actions** (email, Slack); **Data Docs**: human-readable results site.
- Craton fit: gate steps are hard-coded; a user-defined expectation suite per repo with results page and alerts. ⬜
- Candidate hydro expectations: CRS equals X; nodata defined; cell size within range; extent within basin polygon; no NaN in DEM; monotonic time index; units column present; Manning's n within range; mass balance error < threshold.

### 19.3 Datafold
- Diff on PR with summary, impact preview, sampling. See §4.3.

---

## 20. Geospatial and hydrology domain

### 20.1 Formats and serving
- Cloud-Optimised GeoTIFF (tiled, overviews, directory first); COPC for LiDAR; GeoParquet and FlatGeobuf for vectors; Zarr and cloud-optimised HDF/NetCDF for cubes; PMTiles for tiled pyramids. 🟡 COG/LAS/NetCDF/GeoParquet checks
- **PMTiles**: single-file Z/X/Y archive read with HTTP range requests; a 300M-tile pyramid would cost ~US$1,500 in request fees as loose files; read-only (rewrite to change); MapLibre integration. ⬜
- **TiTiler**: dynamic COG/STAC tiles via FastAPI, mosaics (MosaicJSON), TileMatrixSets, colormaps, rescale, expressions, OGC Tiles/WMTS. ⬜
- **Kerchunk / VirtualiZarr**: index chunk byte-ranges inside existing HDF5/NetCDF so tools read them as Zarr with no copy. ⬜ (natural next step after the HDF5 reader)
- STAC: items, collections, extensions (projection: EPSG/shape/transform; raster: dtype/unit/nodata; eo; view; processing), `stac_extensions` array. ✅ export; 🟡 extensions used
- OGC API: Features (WFS successor), Tiles (WMTS successor), Records (CSW successor, Dublin Core-based), Processes (WPS successor, async jobs), EDR. ⬜ a read-only OGC API Features/Records endpoint on a release
- Frictionless Data Package: `datapackage.json` with `resources` (required), `name`, `id` (UUID/DOI), `licenses`, `version`, `sources`, `contributors` (with roles), `keywords`, `created`. ⬜ export

### 20.2 FAIR and citation
- FAIR: persistent identifiers, rich metadata, standard protocols, open formats, provenance, licences, community standards. 🟡
- DOI per release via Zenodo/DataCite; **concept DOI vs version DOI**; communities; embargo/restricted access; citation export. ⬜
- RO-Crate for packaging data + code + provenance. ⬜
- W3C PROV / OpenLineage for run lineage. ⬜
- HydroShare: resource types (time series, rasters, vectors, multidimensional, composite, model program, model instance); collections; groups; publish with DOI; apps and cloud compute; web-service API. 🟡

### 20.3 HEC-RAS file and HDF intelligence (community docs: ras-commander, rivia, rashdf)
- Plan HDF holds a copy of the Geometry group plus `Results/Unsteady/...`; geometry HDF holds `Geometry/...`.
- 2D water surface time series: `.../Unsteady Time Series/2D Flow Areas/{area}/Water Surface` as (times × cells); `Time Date Stamp` dataset; max water surface under Summary Output; cell centres under `Geometry/2D Flow Areas/{area}/Cells Center Coordinate`. (paths vary by version; verify on real files)
- Run status attributes under `Results/Unsteady/Summary`: solution status (e.g. "Unsteady Went Unstable"), run window, compute time total/DSS, max cores, **max WSEL error**, time unstable. ⬜ show on file page
- Volume accounting (1D, 2D per area, combined) with error percent; pass/fail against thresholds. ⬜
- Results by element: cross-section WSE/flow/velocity, bridges, laterals, inline structures, SA/2D connections; profiles (post-process) with energy grade, friction slope, shear, conveyance, top width, hydraulic radius. ⬜
- 2D flow area results: water surface, cell velocity, face flow/velocity, depth, max depth. ⬜
- Mesh exports (cell polygons, faces, points, breaklines, structures) to GeoParquet/GeoPackage/Shapefile with reprojection (rashdf CLI). ⬜ "export mesh as GeoPackage" in backlog
- GZIP-compressed large datasets (chunked); need filter support to read values. ⬜
- Project files: `.prj`, `.gNN` geometry, `.pNN` plan, `.uNN` unsteady flow, `.fNN` steady flow, `.hdf` results, `.rasmap`, `.dss`. ✅ recognition; 🟡 relationships

### 20.4 Modelling QA and review practice (TUFLOW, FEMA, state agencies)
- **Modelling log**: executable/software version, model versions through calibration, simulation observations, key assumptions, data sources; reviewed by an experienced modeller. ⬜
- **QA checklist**: naming/structure and relative paths; version naming set before modelling; cell size vs topography; 1D resolution; DEM interrogation and datum; cross-section locations and conveyance trends; bed resistance and Manning's n consistency; calibration/validation adequacy and limits; **mass conservation** (inflow vs outflow with flow lines); hydraulic structure head losses; eddy viscosity. ⬜
- Phased review with named designer and reviewer; findings in a technical memorandum. ⬜ (maps onto PR review + checklist + release)
- FEMA submissions: model table (duplicate effective, corrected effective, existing, proposed) per natural/floodway run; show every step from effective to proposed with explanation of WSE changes; software must be on FEMA's accepted list; cHECk-RAS flags (Manning's n and transition coefficients, cross-section placement and flow regimes, ineffective flow, floodway surcharge). ⬜ "model lineage view": effective → duplicate → corrected → proposed
- Third-party RasCheck port checks for unsteady: mass balance, computation warnings, peak WSE/velocity, 2D stability/convergence, mesh quality. ⬜
- Deliverable shapefiles: 1% and 0.2% annual chance inundation, floodway extents. ✅ shapefile check
- Fit for Craton: a **"Model review" tab** per release combining checks, log, checklist and sign-offs; PDF/Word export for submission. ⬜

### 20.5 Market notes (India, from tender pages; secondary)
- Large public buyers: Central Water Commission and state irrigation/water departments, often via World Bank-financed National Hydrology Project consultancy tenders (national/international competitive bidding, REoI).
- Government built its own forecasting product (C-FLOOD: CWC + C-DAC + NRSC; 2-D hydrodynamic; Mahanadi, Godavari, Tapi); direction is to expand to all major basins.
- Implication (my inference): sell to consultancies winning those tenders and to state departments needing model governance, not to compete with C-FLOOD on forecasting.
- No SaaS pricing or GeM evidence found; needs a separate pass.

---

## 21. Growth, launch, community and trust

- Hacker News "Show HN": make it easy to try without sign-up; personally made and non-trivial; explain how and why; no landing pages; don't ask friends to upvote; respectful discussion. 
- Product Hunt (secondary): start weeks early, Tue–Thu, ≤60-character tagline, first gallery image matters most, story-driven maker comment, reply to every comment. Treat upvote statistics as unverified.
- Public build log, changelog posts, "how we built it" engineering posts (Stripe, Linear, Figma, Notion all grew trust this way).
- Docs as marketing: task-based pages that rank, runnable examples, comparison pages ("Craton vs Git LFS vs DVC").
- Programmatic SEO from public repos and datasets (sitemap exists ✅).
- Open-source the CLI and schemas; open core pattern (PostHog, lakeFS Apache-2.0 + managed cloud).
- Community: Discord/Slack, office hours, workshops (DataHub), good-first-issues, contributor guide.
- Education: classroom organisations and free academic tier (Hugging Face, Felt). IIT/university labs are the natural beachhead.
- Trust centre page: security practices, subprocessors, uptime, DPA, pen-test summary. ⬜
- Case studies with a real basin and numbers.
- Customer feedback loop: in-app widget → public board → roadmap status → changelog closes the loop (Canny pattern); public boards capture a minority of real feedback so also mine support and calls (secondary).
- Referral/invite mechanics: invite by email ✅, "share a read-only link" ✅, "invite your reviewer" flows.
- Badges in READMEs (checks, release, licence, size) as distribution. ✅

---

## 22. Anti-patterns the sources warned about

- Feature factory; building for the loudest or biggest customer; chasing the easiest feature (PostHog).
- User stories instead of problems (Linear).
- Taking feature requests literally (Linear).
- Buying users or counting inactive ones (PG).
- Big launch dependency; big-partner dependency (PG).
- Over-limiting the free tier; "contact sales" for basic pricing; surprise overage bills (secondary).
- Forcing password complexity rules and rotation (NIST).
- Quick-exit login paths that leak whether an account exists (OWASP).
- Alerts that page for "something seems weird" (SRE).
- Zebra-striped, centre-aligned tables; disabling zoom; blocking paste (table and Vercel guides).
- Using `<button>` for navigation (breaks middle-click) (Vercel).
- Never requiring a prompt in CLIs; secrets in flags or env (clig.dev).
- Major-version API redesigns instead of small dated versions (Stripe).
- Relying on a single public feedback board as the whole signal (secondary).
- One-size onboarding for every persona (secondary).

---

## 23. Research gaps (what I could not confirm; do another pass)

- Linear's keyboard shortcuts list and perceived-performance targets (Superhuman "100 ms" rule) were not fetched.
- Supabase Studio UX details beyond feature lists.
- Stripe/Vercel docs search and language-switcher behaviour.
- India GeM listings, willingness to pay, and procurement cycle length.
- Actual HEC-RAS HDF attribute and group names for current versions: community docs disagree on a few paths; validate against a genuine plan file.
- cHECk-RAS rule list with thresholds (needs FEMA's user guide).
- MIKE (DHI) QA practice.
- Accessible chart palettes and data-viz guidance for flood maps (the `dataviz` skill is available locally).
- Mobile/field data collection (Felt "field data collection") for site inspections.

---

## 24. Sources actually read

- clig.dev: https://clig.dev/
- PostHog, how we decide what to build: https://posthog.com/newsletter/how-we-decide-what-to-build
- Linear Method: https://linear.app/method (pages: write-issues-not-user-stories, build-with-users)
- Linear UI redesign: https://linear.app/now/how-we-redesigned-the-linear-ui
- Vercel Web Interface Guidelines: https://vercel.com/design/guidelines
- Stripe API reference, errors, idempotency: https://docs.stripe.com/api , /api/errors , /api/idempotent_requests
- Stripe API versioning: https://stripe.com/blog/api-versioning
- Stripe rate limiters: https://stripe.com/blog/rate-limiters
- Stripe online migrations: https://stripe.com/blog/online-migrations
- Stripe agent skills / usage-based billing: https://docs.stripe.com/skills , https://docs.stripe.com/billing/subscriptions/usage-based
- GitHub features, rulesets, security features, notifications: https://github.com/features and docs.github.com pages; changelog https://github.blog/changelog/
- GitHub token formats: https://github.blog/engineering/platform-security/behind-githubs-new-authentication-token-formats/
- GitLab features: https://about.gitlab.com/features/
- Hugging Face Hub docs, Xet, repository settings: https://huggingface.co/docs/hub/
- Paul Graham: https://paulgraham.com/ds.html , /growth.html , /good.html
- Y Combinator library and Startup School recaps (via search summaries)
- Show HN rules: https://news.ycombinator.com/showhn.html
- Figma multiplayer: https://www.figma.com/blog/how-figmas-multiplayer-technology-works/
- Notion data model: https://www.notion.com/blog/data-model-behind-notion
- Google SRE book, monitoring: https://sre.google/sre-book/monitoring-distributed-systems/
- OWASP session management and authentication cheat sheets; OWASP API Security Top 10 2023: https://api-security.owasp.org/
- NIST SP 800-63B: https://pages.nist.gov/800-63-4/sp800-63b.html
- passkeys.dev: https://passkeys.dev/
- Model Context Protocol architecture: https://modelcontextprotocol.io/docs/learn/architecture
- llms.txt: https://llmstxt.org/
- Keep a Changelog: https://keepachangelog.com/
- Pencil & Paper, enterprise data tables: https://www.pencilandpaper.io/articles/ux-pattern-analysis-enterprise-data-tables
- Nielsen Norman Group heuristics: https://www.nngroup.com/articles/ten-usability-heuristics/
- Carbon design system, empty states and notifications: https://carbondesignsystem.com/patterns/
- Felt help (sharing and collaboration): https://help.felt.com/sharing-and-collaboration
- Kepler.gl user guides: https://docs.kepler.gl/
- Kart docs: https://docs.kartproject.org/
- HydroShare about: https://help.hydroshare.org/about-hydroshare/
- Frictionless Data Package spec: https://specs.frictionlessdata.io/data-package/
- Cloud-Native Geospatial guide: https://guide.cloudnativegeo.org/
- PMTiles: https://docs.protomaps.com/pmtiles/ ; TiTiler: https://developmentseed.org/titiler/
- DataHub features: https://docs.datahub.com/docs/features ; Great Expectations: https://docs.greatexpectations.io/
- rashdf: https://github.com/fema-ffrd/rashdf ; rivia: https://rivia.readthedocs.io/
- TUFLOW QA checklist: https://docs.tuflow.com/classic-hpc/manual/2026.0/QAchecklist-2.html
- Search-summary only (secondary): lakeFS, DagsHub/DVC/Dolt/Oxen comparisons, WorkOS/SSOJet enterprise checklists, SOC 2 checklists, GDPR checklists, multi-tenancy articles, pricing articles, Canny comparisons, Product Hunt guides, FEMA/state LOMR guidance, CWC/World Bank tenders.
