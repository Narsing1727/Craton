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
| `NODE_ENV` | none | `production` turns off the dev outbox route. |

## Settings of the web app (`frontend/.env.local` or its environment)

| Variable | Default | What it does |
| --- | --- | --- |
| `CRATON_API_URL` | `http://localhost:4000` | Where the web app reaches the API (server side). |
| `CRATON_PUBLIC_API_URL` | the same as `CRATON_API_URL` | The address shown to people for the CLI, when the web app reaches the API on a private address. |
| `CRATON_SITE_URL` | the address a visitor used | The public address of the web app, written into `/sitemap.xml` and named in `robots.txt`. Set it behind a proxy so crawlers get the address people use. |
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
