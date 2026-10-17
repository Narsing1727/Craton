# Craton pages

Every route in the frontend, what it is for, and where its data comes from. Visual and
interaction rules are in [DESIGN.md](DESIGN.md); the API is in [`../backend`](../backend/README.md).

**Data** column:
- **Live**: read from the Craton API.
- **Live + writes**: every action goes through the API as well.
- **Static**: content in the page itself, true of this codebase.

Demo data (`lib/data.ts`) is shown only with `CRATON_DEMO=1`, for design previews without a
backend. Otherwise a failed request is a 404 when the API is up and an error page when it's down
(`lib/source.ts`, `offline()`). Pages for features that don't exist yet are in `_parked/`, out of
the app. Server components fetch through `lib/api.ts` as the signed-in person (their session is an
httpOnly cookie, `lib/session.ts`), `lib/source.ts` converts responses into the page types, and
writes are server actions in `app/actions.ts` and `app/auth-actions.ts`.

## Sign-in and first run

- `proxy.ts`: signed-out visitors on app pages go to `/login?next=…` and come back after signing
  in; signed-in people skip `/`, `/login` and `/signup`. Repositories, profiles, explore and docs
  stay public; comment and review boxes become a "Sign in to…" prompt.
- `/signup` → `/onboarding` (you, workspace, first repository, command line). Only the first step
  is required. "Explore a sample project" creates a real repository with a DEM, shapefiles, a
  HEC-RAS plan, gauges and an open pull request to merge.
- The dashboard shows a five-step getting-started checklist that the API checks off from what the
  person actually did (repository, merge, CLI token used, own push). It can be hidden.
- `/forgot-password` and `/reset-password`: one-time links, valid for an hour. Without an email
  service the API prints the link in its log. A reset signs out every other session.

## App

| Route | Page | Data | Notes |
| --- | --- | --- | --- |
| `/dashboard` | Dashboard | Live | Plan usage, reviews you owe, failing branches, assigned issues, activity |
| `/issues` | Your issues | Live | Assigned / created / mentioning you, across repositories |
| `/pulls` | Your pull requests | Live | Review requested / created / all |
| `/notifications` | Inbox | Live | The activity feed minus your own actions; read state is per browser |
| `/explore` | Explore | Live | Public repositories |
| `/trending` | Trending | Live + writes | `GET /v1/trending?period=`: stars actually received in the last day, week or month |
| `/search` | Search | Live | API search over repositories, file paths, people and orgs you can see |
| `/new` | New repository | Live + writes | Owners you can push to; URL import isn't built yet and says so |
| `/stars` | Your stars | Live | Newest first; star and unstar from any repository header or Trending |

## Repository (`/[owner]/[repo]/…`)

`layout.tsx` loads the repository once for the header; an unknown repository is a real 404.

| Route | Page | Data | Notes |
| --- | --- | --- | --- |
| `` | Code | Live | Tree for any branch or commit (`?ref=`), README, head commit, raster preview caption |
| `/tree/[...path]` | Folder | Live | Branch picker navigates; last commit per entry |
| `/blob/[...path]` | File | Live | GeoTIFF tags, shapefile header, CSV table, text preview, SHA-256, history, download (≤16 MB) |
| `/raw/[...path]` | Download | Live | Route handler that streams file bytes with the server-side token |
| `/commits` | Commits | Live | Per-branch history with files and new-chunk counts |
| `/commit/[sha]` | Commit | Live | Chunk map per file (new vs reused), Merkle root, the check run, older/newer |
| `/branches` | Branches | Live + writes | Create and delete (with undo) through the API; linked PRs; ahead/behind |
| `/compare` | Compare | Live | `?base=&head=`: commits ahead, chunk maps, conflicts, fast-forward or merge |
| `/checks` | Checks | Live | Real runs with failing files; pass rate, median time, blocked merges; the settings they use |
| `/issues`, `/issues/[id]`, `/issues/new` | Issues | Live + writes | Open, comment, close, reopen |
| `/pulls`, `/pull/[id]`, `/pulls/new` | Pull requests | Live + writes | Open, comment, approve, request changes, merge, close; merge gate from the backend's rules |
| `/releases`, `/releases/new`, `/tags` | Releases | Live + writes | Publish; real checksums, Merkle root, manifest and SHA256SUMS downloads |
| `/storage` | Storage | Live | Logical vs stored, savings breakdown, public repos sharing chunks, audit package export |
| `/insights` | Insights | Live | Weekly commits, size after each commit, contributor share |
| `/settings` | Repository settings | Live + writes | Rename, details, protection, check settings (CRS, datum, nodata), visibility, delete |
| `/render/[...path]` | Map previews | Live | Proxies `GET /v1/repos/:o/:r/render/:ref/:path`: hillshade PNG for GeoTIFFs, SVG for shapefiles, `?base=` for the change |

## People and organizations

| Route | Page | Data | Notes |
| --- | --- | --- | --- |
| `/[owner]` | Profile | Live | Name, bio, orgs, repositories, commit count, activity and a heat map built from it. Org handles redirect to `/orgs/…` |
| `/[owner]/stars` | Profile stars | Live | What they starred that you can see; `?q=` filters |
| `/orgs/[org]` | Organization | Live | Members, repositories, org storage (members only), activity |
| `/orgs/[org]/people` | People | Live + writes | Add, change role, remove; the API keeps at least one owner |
| `/orgs/new` | New organization | Live + writes | |
| `/orgs/[org]/settings` | Org settings | Live + writes | Owners rename and describe it, and delete it once it has no repositories |

## Account settings

| Route | Page | Data | Notes |
| --- | --- | --- | --- |
| `/settings/tokens` | Access tokens | Live + writes | Real tokens that work with `craton auth login`; the web app's own token can't be revoked here |
| `/settings/developer` | CLI and API | Live | The real install and sign-in commands, token count, API address |
| `/settings` | Profile | Live + writes | Name and bio |
| `/settings?tab=security` | Security | Live + writes | Email confirmation, password change, signed-in browsers with sign-out, JSON export, account deletion |
| `/settings/export` | Export | Live | Route handler: downloads `GET /v1/user/export` as a file |
| `/settings/billing` | Plan and usage | Live | Per account and organization: stored after dedup vs plan, private repos, shared data, storage by repository |
| `/verify-email` | Confirm email | Live + writes | Needs a click, so mail scanners opening the link don't use it up |

## Public and marketing

| Route | Page | Data | Notes |
| --- | --- | --- | --- |
| `/` | Home | Live | Features the public repository with the widest mix of data |
| `/api-reference` | API reference | Static | All 61 endpoints from `backend/src/api/app.ts`, the push protocol, errors |
| `/cli`, `/docs` | CLI and docs | Static | Commands match the real CLI (`craton help`) |
| `/pricing` | Pricing | Live | Limits from `GET /v1/plans` (what the API enforces); paid plans marked not available |
| `/status` | Status | Live | `GET /v1/status`: live probes and sampled daily uptime; no data is shown as no data |
| `/changelog`, `/about`, `/security`, `/contact`, `/help`, `/support`, `/terms`, `/privacy` | Content | Static | Only true statements; contacts from `CRATON_CONTACT_EMAIL` / `CRATON_SECURITY_EMAIL` |
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | Auth | Live + writes | Session cookie; inline errors; returns to `?next=` |
| `/onboarding` | First run | Live + writes | Profile, org and invites, sample or empty repository, CLI token |
| `error.tsx`, `not-found.tsx` | Errors | Static | |

## Not connected yet

- SSO and two-factor sign-in.
- Followers, forks, wiki, repository collaborators, teams, SSH keys, billing, webhooks, URL import
  (see `_parked/README.md`).
- Notification read and done state is kept per browser (localStorage); there's no server inbox yet.

## Known mismatches with the design doc (flagged, not changed)

- None left from the P0 list: pricing now reads the enforced limits (20 GB free, 3 private
  repositories) from the API.
