# Running Craton

For whoever runs the server. Everything here is checked against the code by `backend/test/operating.test.ts`: a
setting the code reads that is missing from the tables below, or a setting listed that nothing reads, fails the tests.

## What runs

| Part | Command | Port | Needs |
| --- | --- | --- | --- |
| API | `npm start` in `backend` | `PORT` (4000) | Node.js 23.6 or newer; no database server (SQLite in the data folder) |
| Web app | `npm run build && npm start` in `frontend` | 3100 | the API's address in `frontend/.env.local` (`CRATON_API_URL`) |

Both are plain Node processes. The API keeps the database and, unless R2 is configured, every chunk under the data
folder.

## Settings (environment variables of the API)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4000` | Port the API listens on. |
| `CRATON_DATA_DIR` | `backend/data` | Folder for the SQLite database, local chunks, the secret key file and the dev outbox. |
| `CRATON_WEB_URL` | `http://localhost:3100` | Where the web app lives, for links the API writes into emails. |
| `CRATON_CORS_ORIGINS` | `http://localhost:3100` | Comma-separated origins allowed to call the API from a browser. |
| `CRATON_TRUSTED_PROXIES` | loopback addresses | Addresses allowed to pass on a visitor's real address (`x-craton-client-ip`): the web app. Anything else cannot pick its own address for rate limits. |
| `CRATON_RATE_LIMITS` | on | `off` disables rate limiting (tests only). |
| `CRATON_API_RATE` | `1200` | API requests per minute per token, or per address when not signed in. Sign-in, sign-up and reset have their own, fixed limits. |
| `CRATON_UPLOAD_MAX_MB` | `100` | Largest total size of one upload from the browser; bigger goes through the CLI. |
| `CRATON_PREWARM_PREVIEWS` | on | `off` stops drawing map previews in the background after a push. |
| `CRATON_LOCK_STALE_DAYS` | `7` | After this many days a held file lock is reminded about and listed as old. |
| `CRATON_WEBHOOKS_ALLOW_PRIVATE` | off | `1` lets webhooks call private and loopback addresses. Development only: webhook URLs are typed by users. |
| `CRATON_SECRET_KEY` | a key file in the data folder | 32 bytes as 64 hex characters or base64. Encrypts the stored two-step verification secrets. Set it in production and keep it; losing it makes those secrets unreadable and people would have to set two-step verification up again. |
| `EMAIL_API_KEY` | none | A Resend or Postmark key. Without one, mail is written to the data folder and, outside production, listed at `/v1/dev/outbox`. |
| `EMAIL_PROVIDER` | `resend` | `resend` or `postmark`. |
| `EMAIL_FROM` | `Craton <no-reply@craton.local>` | The sender. Use an address on a domain you have set up SPF and DKIM for. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | none | All four together store chunks in Cloudflare R2 instead of the data folder. |
| `CRATON_ACCESS_LOG` | off | `1` writes one JSON line per API request to standard output: time, method, route pattern, status, milliseconds, request id and the signed-in handle. Never request bodies, query strings or tokens. |
| `CRATON_STORE_CONCURRENCY` | automatic | How many chunks are stored at once during a push or an upload, 1 to 64. Automatic is 8 on the local disk (file creation is the limit) and 24 with R2 (each put is a round trip; at 40 ms a push of 10,000 chunks waits 50 s at 8 and about 17 s at 24). |
| `CRATON_SECRET_SCAN` | `on` | Set to `off` to stop reading pushes and uploads for credentials (see “Secret scanning”). It is on for everyone by default; turn it off only on a server whose repositories are all scratch data. |
| `CRATON_GOOGLE_CLIENT_ID`, `CRATON_GOOGLE_CLIENT_SECRET` | none | Both together turn on "Continue with Google" (OpenID Connect, authorization code with PKCE). In Google Cloud Console create an OAuth client of type *Web application* and add the authorized redirect URI `<CRATON_WEB_URL>/auth/google/callback` (for local use `http://localhost:3100/auth/google/callback`). The secret stays on the API; the browser never sees it. Without both, the button is not shown and the Google routes answer 404. |
| `CRATON_GITHUB_CLIENT_ID`, `CRATON_GITHUB_CLIENT_SECRET` | none | Both together turn on "Continue with GitHub" (OAuth 2.0 with PKCE). In GitHub → Settings → Developer settings → OAuth Apps, create an app whose authorization callback URL is `<CRATON_WEB_URL>/auth/github/callback`. The account is read from GitHub's API and only an email address GitHub lists as verified is accepted (a `users.noreply.github.com` address is not). `npm run setup:oauth` writes these for you. |
| `CRATON_GITHUB_AUTH_URL`, `CRATON_GITHUB_TOKEN_URL`, `CRATON_GITHUB_API_URL` | GitHub's own | Where GitHub's authorization page, token endpoint and API are. Only a test needs to change them. |
| `CRATON_ENV_FILE` | `backend/.env` | A `KEY=value` settings file the API reads at start (real environment variables win over it). Copy `backend/.env.example` and fill it in, or run `npm run setup:oauth -- --google-id … --google-secret …`. Tests never read the default file. |
| `CRATON_GOOGLE_AUTH_URL`, `CRATON_GOOGLE_TOKEN_URL`, `CRATON_GOOGLE_JWKS_URL`, `CRATON_GOOGLE_ISSUER` | Google's own | Where Google's authorization page, token endpoint and signing keys are, and which issuer(s) an ID token may name (comma separated). Leave unset; they exist so a test can run a stand-in for Google. |
| `CRATON_PASSKEY_RP_ID` | the host name of `CRATON_WEB_URL` | The site name passkeys are bound to (the WebAuthn relying party id). Leave it alone for one site. Set it to a parent domain such as `nerolith.in` to share passkeys across its subdomains. Changing it later makes every existing passkey unusable, so choose once. |
| `CRATON_PASSKEY_ORIGINS` | the origin of `CRATON_WEB_URL` | Comma-separated web origins whose pages may sign in with a passkey, such as `https://craton.nerolith.in`. A page on any other origin is refused even if it names the right site. |
| `NODE_ENV` | none | `production` turns off the dev outbox route. |

## Settings of the web app (`frontend/.env.local` or its environment)

| Variable | Default | What it does |
| --- | --- | --- |
| `CRATON_API_URL` | `http://localhost:4000` | Where the web app reaches the API (server side). |
| `CRATON_PUBLIC_API_URL` | the same as `CRATON_API_URL` | The address shown to people for the CLI, when the web app reaches the API on a private address. |
| `CRATON_SITE_URL` | the address a visitor used | The public address of the web app, written into `/sitemap.xml`, named in `robots.txt`, and used for the links in `/llms.txt`, `/skill.md` and the Markdown versions of the pages. Set it behind a proxy so crawlers get the address people use. |
| `CRATON_CONTACT_EMAIL` | none | Shown on the Contact page. Without it the page says the deployment has not published one. |
| `CRATON_SECURITY_EMAIL` | none | Shown on the Security page for reports. Without it the page says so. |
| `CRATON_DEMO` | off | `1` renders built-in sample data when the API is down. A design preview only; leave it off in production. |

## Settings of the checking scripts (`frontend/scripts`)

These only matter if you run `npm run sweep`, `npm run focus` or `npm run contrast` against a deployment.

| Variable | Default | What it does |
| --- | --- | --- |
| `CRATON_WEB` | `http://localhost:3100` | The web address to visit. |
| `CRATON_API` | `http://localhost:4000/v1` | The API address the scripts sign in through. |
| `CRATON_BROWSER` | Edge or Chrome if found | Path of a Chromium-based browser. |
| `CRATON_WIDTH` | `1280` | Window width in CSS pixels (390 for a phone, 640 for 200% zoom). |
| `CRATON_E2E_DB` | none | For `npm run e2e:google` only: the `craton.db` of a throwaway API started with Google pointed at `scripts/mock-google.mjs`. The test creates accounts, so never aim it at real data. |
| `CRATON_E2E_SHOTS` | `e2e-shots` | For `npm run e2e:google`: the folder the screenshots go in. |
| `CRATON_ROUTES` | a built-in list | Comma-separated paths for `focus` and `contrast`. |
| `CRATON_THEME` | both | `darker` or `standard` for `contrast`. |
| `CRATON_STEPS` | `70` | How many Tab presses `focus` makes on each page. |

The command-line tool reads its own few: `CRATON_HOME` (where the saved sign-in lives, default `~/.craton`),
`CRATON_TOKEN` (a token to use instead of the saved one, for CI), `CRATON_SERVER` (the API address for the MCP server)
and `CRATON_AUTHOR` (the name shown on commits and locks; for tests). `CRATON_FAIL_AFTER_CHUNKS` drops a download's
connection after that many chunks and exists for the tests.

## Backups

```sh
npm run backup                    # a consistent copy of the database plus new chunks, into data/backups
npm run backup -- --to D:/bk      # somewhere else: another disk, a synced folder
npm run backup -- --keep 14       # database copies to keep (default 14)
```

The database copy is made with SQLite's `VACUUM INTO`, which is safe while the server runs. Chunks never change once
written, so each run copies only new ones. With R2, turn on bucket versioning instead of copying chunks. Nothing here
encrypts the backup; put it somewhere you already protect.

## Restoring

Stop the API first, then:

```sh
npm run restore -- data/backups/db/craton-<time>.db
npm run restore -- <file> --chunks data/backups/chunks    # also copy missing chunk files back
```

The database being replaced is kept next to it as `craton.db.before-restore-<time>`, so a mistaken restore can itself
be undone. Practise it once on a copy before you need it.

## Garbage collection

```sh
npm run gc                        # what would be removed (a dry run)
npm run gc -- --apply             # remove chunks nothing has referenced for more than 30 days
npm run gc -- --grace-days 60     # a longer grace period
```

Run it from time to time, not from a script that nobody reads. Chunks that another repository still references are
never removed.

## Upgrading

1. Take a backup.
2. Stop the API, update the code, run `npm install` in `backend`, start it again. Database changes are applied
   automatically at start, each in a transaction; the version is in the `schema_version` table.
3. Rebuild and restart the web app.
4. `craton doctor` from a machine that uses it shows the server's version and whether the CLI is old enough to warn about.

There is no downgrade: to go back, restore the backup taken in step 1.

## Checking on it

- `GET /v1/health` answers without a token with the server's version, API version and storage kind.
- `GET /v1/ready` is for a load balancer: it answers 200 only when the database answers and a one-chunk probe can be written to,
  read from and removed from the chunk store, and 503 naming the part that failed. The answer is kept for five seconds.
- `GET /api/health` on the web app answers 200 only when the web app can reach the API and the API's `/v1/ready` says yes; 503 with
  the API's status and how long it took otherwise. Point the web app's load balancer at this one.
- `GET /v1/openapi.json` describes every route.
- Each person's Settings → Security lists their own security events: sign-ins and failed sign-ins, password changes and resets, two-step changes, tokens created and revoked.
- Logs go to the process's standard output and error.

## What this document does not cover

Putting it behind TLS, a reverse proxy, process supervision, or monitoring: those depend on where you run it. Craton
itself speaks plain HTTP and expects TLS to be added in front.

## Audit log and token request log

Every successful change under `/repos/...` and `/orgs/...` made by someone signed in, and every such attempt that was refused (401 or 403), is written to `audit_events` after the response: the person, the route pattern, the owner and repository, the path parameters (secret-looking ones dropped), the outcome, the address and the client. Never a body, a query string or a token. Entries older than 400 days are dropped as new ones arrive; `CRATON_ACCESS_LOG` is separate and unrelated. Owners read an organization's log, repository admins read a repository's, and people read what others did on their personal repositories. Each personal access token keeps its last 100 requests (`token_requests`), including requests to routes that do not exist. Both tables are in the backup like everything else in the database.

## Secret scanning

Before a branch moves, the commits a push would add are read for credentials: each file they add or change, if it is text and no larger than 2 MB (at most 2,000 files and 256 MB read per push). Browser uploads are read the same way before anything is stored. The patterns are fixed prefixes with a checksum or length (Craton tokens, GitHub tokens, AWS access key ids, Google API keys and client secrets, Slack tokens and webhooks, Stripe live keys, Anthropic and OpenAI keys, PEM private keys, database addresses with a real password); a Craton token only counts while it still works. A finding is a 422 `secret_detected` naming the file, line and kind, and the first few characters at most. The refusal, and any push an administrator lets through with a reason (`allowSecrets` on the API, `craton push --allow-secrets`), are entries in the audit log (never the secret). A live Craton token let into a *public* repository this way is revoked. A line holding `craton:allow-secret` is skipped. Tokens issued before the `crt_` format (`bcn_…`) still sign in and are still recognised by the scan.

## Markdown versions, `/llms.txt` and `/skill.md`

The web app serves `/llms.txt`, `/llms-full.txt` and `/skill.md`, and a Markdown version of each reading page (`/docs.md`, `/api-reference.md`, `/cli.md`, `/pricing.md`, `/security.md`, `/about.md`, `/changelog.md`, `/help.md`). Nothing is stored: the page is fetched from the site itself (as an anonymous visitor, never with a cookie), converted, and kept in memory for a minute. They are marked `noindex` and name the page as canonical. A request that sends `Accept: text/markdown` for one of those pages gets the Markdown at the page's own address (`Vary: Accept`). Behind a proxy, set `CRATON_SITE_URL` so the links in them are the ones people use; the server must be able to reach its own address (the one the request came in on) to build them.
