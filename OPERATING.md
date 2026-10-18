# Running Craton

For whoever runs the server. Everything here is checked against the code by `backend/test/operating.test.ts`: a
setting the code reads that is missing from the tables below, or a setting listed that nothing reads, fails the tests.

## What runs

| Part | Command | Port | Needs |
| --- | --- | --- | --- |
| API | `npm start` in `backend` | `PORT` (4000) | Node.js 23.6 or newer; PostgreSQL (`CRATON_DATABASE_URL`), or none for development: the API then runs Postgres inside its own process and keeps it in the data folder |
| Web app | `npm run build && npm start` in `frontend` | 3100 | the API's address in `frontend/.env.local` (`CRATON_API_URL`) |

Both are plain Node processes. The database is PostgreSQL. Unless R2 is configured, every chunk is a file under the data folder.

## Settings (environment variables of the API)

| Variable | Default | What it does |
| --- | --- | --- |
| `PORT` | `4000` | Port the API listens on. |
| `CRATON_DATA_DIR` | `backend/data` | Folder for local chunks, the secret key file, the dev outbox and, when no database address is set, the development database (`pgdata`). |
| `CRATON_DATABASE_URL` | none | The PostgreSQL server: `postgres://user:password@host:5432/craton?sslmode=require`. AWS RDS and Aurora work as they are (see “The database” below). `DATABASE_URL` is read when this is not set. Without either, a development database runs inside the API process and is kept in `<data folder>/pgdata`; it is real Postgres, but only one process can use it at a time. |
| `CRATON_DB_CA` | none | A certificate bundle file to verify the database server against (for RDS, AWS's `global-bundle.pem`). With it, the connection is encrypted and the server's certificate is checked. |
| `CRATON_DB_POOL_MAX` | `10` | Most connections the API holds open to the database (1 to 200). Keep it below the server's `max_connections` divided by the number of API processes. |
| `CRATON_PUBLIC_API_URL` | `http://localhost:<PORT>` | The address identity providers reach the API at; it is the start of the SCIM base URL shown in organization settings (`<this>/v1/scim/v2/<org>`). |
| `CRATON_DB_STATEMENT_TIMEOUT_MS` | `120000` | A database statement that runs longer than this is cancelled by the server (0 turns it off). |
| `CRATON_TEST_PG` | none | For `npm test` in `backend` only: a Postgres address (for example the container from `docker compose up -d db`). Every test database then gets its own schema on that server, dropped when it closes, so the suite runs against the real driver and server instead of the in-process database. |
| `CRATON_WEB_URL` | `http://localhost:3100` | Where the web app lives, for links the API writes into emails. |
| `CRATON_CORS_ORIGINS` | `http://localhost:3100` | Comma-separated origins allowed to call the API from a browser. |
| `CRATON_TRUSTED_PROXIES` | loopback addresses | Addresses allowed to pass on a visitor's real address (`x-craton-client-ip`): the web app. Anything else cannot pick its own address for rate limits. |
| `CRATON_RATE_LIMITS` | on | `off` disables rate limiting (tests only). |
| `CRATON_API_RATE` | `1200` | API requests per minute per token, or per address when not signed in. Sign-in, sign-up and reset have their own, fixed limits. |
| `CRATON_UPLOAD_MAX_MB` | `100` | Largest total size of one upload from the browser; bigger goes through the CLI. |
| `CRATON_PREWARM_PREVIEWS` | on | `off` stops drawing map previews in the background after a push. |
| `CRATON_LOCK_STALE_DAYS` | `7` | After this many days a held file lock is reminded about and listed as old. |
| `CRATON_WEBHOOKS_ALLOW_PRIVATE` | off | `1` lets webhooks and single sign-on discovery call private and loopback addresses and plain http. Development only: those addresses are typed by users. |
| `CRATON_SECRET_KEY` | a key file in the data folder | 32 bytes as 64 hex characters or base64. Encrypts the stored two-step verification secrets. Set it in production and keep it; losing it makes those secrets unreadable and people would have to set two-step verification up again. |
| `EMAIL_API_KEY` | none | A Resend or Postmark key. Without one, mail is written to the data folder and, outside production, listed at `/v1/dev/outbox`. |
| `EMAIL_PROVIDER` | `resend` | `resend` or `postmark`. |
| `EMAIL_FROM` | `Craton <no-reply@craton.local>` | The sender. Use an address on a domain you have set up SPF and DKIM for. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | none | All four together store chunks in Cloudflare R2 instead of the data folder. |
| `CRATON_S3_BUCKET`, `CRATON_S3_REGION` (or `AWS_REGION` / `AWS_DEFAULT_REGION`) | none | Both together store chunks in Amazon S3 instead of the data folder (R2 wins if both are set). Objects are `chunks/<first two>/<hash>` inside the bucket. Give the role `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` and `s3:ListBucket` (without list permission S3 answers 403 instead of 404 for a missing chunk). Turn on bucket versioning. |
| `CRATON_S3_PREFIX` | none | A folder inside the bucket, for example `prod`, so one bucket can hold several installations. |
| `CRATON_S3_ENDPOINT` | none | For an S3-compatible service that is not AWS (MinIO and the like): its address, used path-style. Leave empty for AWS. |
| `CRATON_S3_ACCESS_KEY_ID`, `CRATON_S3_SECRET_ACCESS_KEY` (or `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`) | none | Fixed credentials for S3. On AWS leave them unset and give the ECS task or EC2 instance a role instead: Craton then asks for the role's short-lived credentials itself (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`, `AWS_CONTAINER_CREDENTIALS_FULL_URI` and `AWS_CONTAINER_AUTHORIZATION_TOKEN` are set by ECS; EC2 uses its instance metadata). |
| `CRATON_ACCESS_LOG` | off | `1` writes one JSON line per API request to standard output: time, method, route pattern, status, milliseconds, request id and the signed-in handle. Never request bodies, query strings or tokens. |
| `CRATON_SESSION_TOKEN` | none | Only for the scripts that check the web app (`npm run contrast`, `npm run focus`, `npm run audit` in `frontend`): a session token to use instead of signing in as the demo user, so the checks run on a throwaway account and write nothing to the demo user's security log. |
| `CRATON_RECODE` | off | Set to `1` to keep the old versions of DEFLATE GeoTIFFs as their pixels (the cold tier, see below). About 28% smaller, and a later version of a tile as a difference from an earlier one; reading an old version then costs CPU. The newest version of each file is never touched. |
| `CRATON_TILE_CACHE_MB` | 128 | How much recompressed tile data is kept in memory so that reading a cold file costs one rebuild per tile, not one per chunk (16 to 4096). |
| `CRATON_REPACK` | on | Set to `0` to stop storing a changed numeric raster as its difference from the previous version (see below). It saves most of the space when every value moves by a little (a datum shift, a recalibration) and never changes what anyone downloads. |
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
| `CRATON_E2E_DATABASE_URL` | none | For the `npm run e2e:*` browser scripts only: the PostgreSQL address of a throwaway API (its own database, for example `createdb craton_e2e`) so the script can confirm an email address or switch two-step on, as a link or a settings page would. The scripts create accounts, so never aim it at real data. |
| `CRATON_E2E_SHOTS` | `e2e-shots` | For `npm run e2e:google`: the folder the screenshots go in. |
| `CRATON_ROUTES` | a built-in list | Comma-separated paths for `focus` and `contrast`. |
| `CRATON_THEME` | both | `darker` or `standard` for `contrast`. |
| `CRATON_STEPS` | `70` | How many Tab presses `focus` makes on each page. |

The command-line tool reads its own few: `CRATON_HOME` (where the saved sign-in lives, default `~/.craton`),
`CRATON_TOKEN` (a token to use instead of the saved one, for CI), `CRATON_SERVER` (the API address for the MCP server)
and `CRATON_AUTHOR` (the name shown on commits and locks; for tests). `CRATON_FAIL_AFTER_CHUNKS` drops a download's
connection after that many chunks and exists for the tests.

## The database

Craton keeps everything but the bytes of chunks in PostgreSQL (version 14 or newer; the `citext` extension, which RDS and Aurora allow
for the database owner, is created on first start). The schema is applied automatically at start, in one transaction under an advisory
lock, so several API processes starting together do not collide; the version is in the `schema_version` table.

- **Development:** set nothing. The API runs Postgres inside its own process (PGlite) and keeps it in `<data folder>/pgdata`. Stop the
  API before running a script that opens the database, because only one process can use it.
- **A local server:** `docker compose up -d db` in the Craton folder starts Postgres 16 on port 5433; then
  `CRATON_DATABASE_URL=postgres://craton:craton@localhost:5433/craton`.
- **AWS RDS or Aurora:** create the database and a user that owns it, put the endpoint in `CRATON_DATABASE_URL` with `?sslmode=require`,
  and set `CRATON_DB_CA` to the downloaded AWS certificate bundle. Allow the API's security group in the database's. Nothing else in
  Craton changes. Chunks stay in files, or in R2 (S3-compatible) when it is configured.
- **From the old SQLite file:** `npm run migrate-sqlite` (in `backend`) copies `data/craton.db` into the configured database with every id
  kept, moves the counters past them, and checks each table's row count. It refuses a target that already has data unless you add
  `--force`. It never changes the SQLite file.

## Running several servers

Behind a load balancer, any number of API servers can share one database and one chunk store (S3 or R2: a local data folder belongs to one machine). What is shared, through the database, and therefore correct however many servers there are:

- accounts, sessions, tokens, every repository's data, issue and pull request numbers, branch moves (a push that lost a race is told its branch moved);
- the failed-password lockout, the two-step code budget and the share-link guessing budget (`rate_hits`), so an attacker gains nothing by spreading guesses over servers;
- webhook deliveries (each is leased to one server while it is being sent, and comes due again if that server dies) and the weekly digest (each person's turn is taken once).

What is per server, and what to do about it:

- the general request limits, the idempotency-key cache and the preview and tile caches live in each server's memory: the limits are "slow down" limits, so put a rate limit on the load balancer too if you want one for the whole site;
- the cold tier (`CRATON_RECODE`) and `npm run repack` / `recode` / `gc` are maintenance work: run them on one server (or from one machine) at a time;
- the development email outbox is a folder on the machine; configure a real email provider for more than one server.

Every server runs the schema migrations when it starts, one at a time (a lock in the database), so start one, then the others, when upgrading; do not run an old and a new version together while a migration is pending.

## Backups

```sh
npm run backup                    # a consistent copy of the database plus new chunks, into data/backups
npm run backup -- --to D:/bk      # somewhere else: another disk, a synced folder
npm run backup -- --keep 14       # database copies to keep (default 14)
```

The database copy (`craton-<time>.dump.gz`) is every table as compressed lines of JSON, read in one repeatable-read transaction, so it is
one moment in time and safe while the server runs; the script reads the file back and compares the row count of every table before it
says it is done. It works the same on a Postgres server and on the development database, and it loads into either. On a production
server also take RDS snapshots (or `pg_dump`); they are faster for a very large database. What a chunk stands for never changes, so each
run copies only chunk files that are not already in the backup (repacking may later keep a chunk in a smaller form; the older copy in the
backup is then an equally valid form of the same chunk). With R2, turn on bucket versioning instead of copying chunks. Nothing here
encrypts the backup; put it somewhere you already protect.

## Restoring

Stop the API first, then:

```sh
npm run restore -- data/backups/db/craton-<time>.dump.gz
npm run restore -- <file> --chunks data/backups/chunks    # also copy missing chunk files back
npm run fsck -- --repair                                  # then check it, and put right anything the backup caught half way
```

A backup taken while repacking or the cold tier was running can hold a chunk file that is newer than its database snapshot. The chunk
file is the truth; `npm run fsck -- --repair` reads every rewritten chunk and puts back the database rows that say what it is built on, so
`npm run gc` keeps those chunks, then verifies the whole store.

Restoring empties the configured database and fills it from the file in one transaction: a file that fails halfway leaves the database as
it was. Before that, what is there now is written next to the backup as `before-restore-<time>.dump.gz`, so a mistaken restore can itself
be undone. Practise it once on a copy before you need it.

## Storing changes as differences

When a new version of an uncompressed numeric raster (a `.flt`, `.hgt` or similar, or a GeoTIFF without compression, little
endian) or of an uncompressed LAS point cloud (compared record by record, even when the header grew; a reclassification or a vertical
shift stores about 13 times smaller) is committed, each new chunk is compared with the bytes at the same place in the previous version. If the
difference is under 70% of what the chunk would take on its own, the chunk is stored as that difference. A datum shift or a
smooth recalibration then costs a few percent of a new copy. Nothing about what people download changes: the stored form is
decoded and must hash to the chunk's own SHA-256 before it replaces anything, a chunk is always sent to a client in a form it
can decode alone, and the chunks a difference is built on are never removed by `npm run gc` while it exists.

```sh
npm run repack                    # how much history that is already stored would shrink (a dry run)
npm run repack -- --apply         # do it
npm run repack -- --repo owner/name
```

New commits are handled automatically after the push or upload is answered; `CRATON_REPACK=0` turns that off (differences
already stored keep working). A chunk that is itself a difference is never used as a base, so a third version in a row is
stored whole unless its previous version was not shrunk.

## The cold tier for GeoTIFFs and HDF5

Most GeoTIFFs are compressed with DEFLATE (and so are the chunks of HEC-RAS results and NetCDF 4 files, which are HDF5: gzip alone, or the shuffle filter then gzip, in the usual chunked layout), which makes every tile incompressible and different from the same tile in the next
version, however small the change. The cold tier keeps the tiles of **old versions** as their pixels (about 28% smaller) together
with the exact zlib settings that wrote them, and a later version of a tile as its difference from an earlier one (a datum shift
or a smooth recalibration costs a few percent). When anyone reads an old version, each tile is compressed again from its pixels
(in worker threads) and **must come out as the same bytes**: a tile is only kept as pixels after it has been rebuilt and compared
with the original, a chunk is only rewritten after it has been put back together and hashed to its own SHA-256, and a rebuilt
tile that does not hash to its own name is refused at read time. For HDF5, the shuffle filter is undone before one version is compared with another, so a run that moved every value by a little costs a few percent. Files written by a compressor that `pako` (a plain JavaScript
zlib, pinned at 2.1.0) does not match, such as libdeflate, are not recoded; nothing is lost, they are stored as uploaded.

What stays exactly as it was uploaded: the newest version of every file (every branch tip), anything a tag points at, and every
chunk those versions are made of, even when an old version shares it. Reading an old version costs about 2 seconds per
40 MB file (measured; the tip takes 0.2 s): tiles of a file read from the start are made again several at a time, in worker threads.
So this is a choice, not a default.

```sh
npm run recode                        # how much stored history would shrink (a dry run)
npm run recode -- --apply             # do it
npm run recode -- --repo owner/name
npm run recode -- --verify            # make every stored tile's original stream again and check it
```

With `CRATON_RECODE=1` a push that moves a branch does this for that repository after the answer is sent. `npm run gc` keeps
the tiles that chunks are made of and removes the rest after the grace period.

## Checking the whole store

```sh
npm run fsck               # read and verify every chunk, stored difference and tile
npm run fsck -- --quick    # structure only: nothing is read
```

It changes nothing and exits 1 when something is wrong. Every chunk is read and decoded and must hash to its own name (a chunk kept
as a difference, or as pieces of tiles, is rebuilt first); every tile must make its original stream again; every file's chunks must
all be stored and add up to its size; every commit's Merkle root must match its tree; and the form the database says a chunk is kept
in must be the form its bytes are in. Run it after a restore, after a disk problem, and before and after turning on `CRATON_RECODE`.
On this machine's store (158 chunks) it takes under a second; a store of many gigabytes is read once, four chunks at a time.

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

## Weekly summary email

A person can switch on (Settings → Profile) one email a week listing what is still unread in their inbox that arrived since the last one; with nothing new, nothing is sent. It is off by default and only a confirmed address receives it. The first one comes a week after switching it on. The server checks hourly (nothing to configure; it needs the same email settings as every other message, `EMAIL_API_KEY` in production). Every message carries a one-click unsubscribe link (`/digest/unsubscribe?token=…`, a keyed signature of the account made with `CRATON_SECRET_KEY` or the key file in the data folder, so links stay valid across restarts only while that key does).

## Organization single sign-on

An organization that has verified a domain can connect its own OpenID Connect provider (Settings → Single sign-on: issuer, client id, client secret). Register `<CRATON_WEB_URL>/auth/sso/callback` as the redirect URI there; every organization uses that one address. On the sign-in page, “Continue with single sign-on” asks for a work email and sends the person to the provider of the organization that verified that email's domain. The provider can only vouch for addresses at that organization's verified domains. Craton reads the provider's `/.well-known/openid-configuration` when the setup is saved (and the signing keys when someone signs in) over https to public addresses only; set `CRATON_WEBHOOKS_ALLOW_PRIVATE=1` on a development machine to allow a provider on a private address or plain http. The client secret is stored encrypted with the server's secret key (`CRATON_SECRET_KEY`, or the key file in the data folder: keep it out of backups of the database). People who sign in through it join the organization as Members. Once someone has signed in through it, owners can require it: members with an address at the organization's domains are then refused passwords, Google, GitHub and passkeys, while owners are exempt (the way back in if the provider breaks) and personal access tokens keep working. Removing the setup removes the links, not the accounts. Only RS256-signed ID tokens are accepted.

## Organization provisioning (SCIM)

An organization that has a verified domain can let its identity provider (Okta, Microsoft Entra ID, OneLogin, Google Workspace through a connector) add and remove its people with SCIM 2.0, so someone who leaves the directory loses access to the organization the same day. Owners make a token in the organization's settings (up to five; only a hash is kept, the token itself is shown once) and give the provider two things: the base URL (`<CRATON_PUBLIC_API_URL>/v1/scim/v2/<org>`) and the token as a Bearer token. Run the API where the provider can reach it over https.

- The token manages that one organization's membership and nothing else. Addresses are accepted only at the organization's verified domains, the same rule single sign-on uses.
- Creating a person adds them as a Member. An account with that address is joined if its address was confirmed (refused with 409 if it never was, because it might be someone else's); with no account, one is made with a confirmed address and no password, and the person signs in through the organization's single sign-on.
- `active: false` (PATCH or PUT) or DELETE removes the person from the organization. Their account stays: it is theirs and may belong to other organizations. Owners are never removed this way (409), so a directory mistake cannot orphan an organization.
- Supported: Users (list with `userName eq`, `externalId eq`, `id eq`, `emails.value eq` filters, create, read, replace, patch, delete), discovery documents, an empty Groups list. Not supported: group sync, bulk, sorting, ETags.

## SAML single sign-on

An organization whose identity provider speaks SAML 2.0 rather than OpenID Connect (Okta, Microsoft Entra ID, OneLogin, ADFS, Shibboleth) sets it up in Settings → Single sign-on (SAML 2.0), after verifying a domain. Give the provider the ACS URL (`<CRATON_WEB_URL>/auth/saml/acs`) and the entity ID shown there (or import the metadata address), and send the person's email in an attribute called `email` (or `mail`, or the standard claims address) or as the name ID. Then paste back the provider's sign-in URL, entity ID and signing certificate. An organization uses OpenID Connect or SAML, not both; the sign-in page asks for a work email and sends the person to whichever the organization chose. The rules are those of OpenID Connect single sign-on: addresses only at verified domains, an existing account whose address was never confirmed is refused, the person joins the organization, and owners can require it of members (owners exempt).

- Signatures are mandatory: the response or the assertion must be signed by the certificate you saved (the library checks the XML signature, audience, issuer, validity times and a two-minute clock skew). Unsigned answers are refused.
- Only sign-ins started from Craton work (the answer must reply to a request Craton made, and each request answers once). Provider-initiated sign-in from the provider's app portal is not supported; send people to Craton's "Continue with single sign-on".
- Encrypted assertions are not supported; turn assertion encryption off at the provider (the connection is https and the assertion is signed).
- Put the certificate's expiry in a calendar: when it runs out the provider's answers stop verifying. Paste the new certificate (you can paste the old and the new together during a rollover) before then.

## Organization domains

An organization owner can claim a domain and prove it by publishing a DNS TXT record (`_craton-challenge.<domain>` with the value `craton-verify=<token>`); the server looks it up when asked (Settings → Domains → Check now, or `POST /v1/orgs/:org/domains/:domain/verify`), using the host's own DNS resolver. A verified domain shows on the organization's public page, and only one organization can hold a given domain. With joining switched on, anyone whose *confirmed* email address ends in `@<domain>` (exactly: sub-domains and look-alikes do not match) becomes a Member, when they confirm the address or sign in with Google or GitHub, and the people already registered are added when it is switched on. Removing a domain or switching joining off never removes anyone. Free-mail domains (gmail.com, outlook.com, …) and public suffixes (co.uk, ac.in) are refused. The verify route is limited to 30 checks per owner per ten minutes. Nothing to configure on the server.

## Chat webhooks (Slack, Teams, Discord)

A webhook whose address is a Slack (`hooks.slack.com`), Microsoft Teams (`*.webhook.office.com`, `*.logic.azure.com`, `*.powerplatform.com`) or Discord (`discord.com/api/webhooks/…`) incoming-webhook is sent a short message in that service's own JSON shape instead of the signed envelope (`format` on the webhook: `auto`, `json`, `slack`, `teams`, `discord`; `slack` also suits Mattermost and similar). Same events, retries, pausing and delivery log; no signature headers and no secret, because a chat service cannot verify one. The message text is built when each attempt is made, from the stored event, and anything a person typed is escaped (Slack `&`, `<`, `>`; markdown characters and `@` for Teams and Discord, plus `allowed_mentions: none` for Discord). Nothing to configure on the server.

## Markdown versions, `/llms.txt` and `/skill.md`

The web app serves `/llms.txt`, `/llms-full.txt` and `/skill.md`, and a Markdown version of each reading page (`/docs.md`, `/api-reference.md`, `/cli.md`, `/pricing.md`, `/security.md`, `/about.md`, `/changelog.md`, `/help.md`). Nothing is stored: the page is fetched from the site itself (as an anonymous visitor, never with a cookie), converted, and kept in memory for a minute. They are marked `noindex` and name the page as canonical. A request that sends `Accept: text/markdown` for one of those pages gets the Markdown at the page's own address (`Vary: Accept`). Behind a proxy, set `CRATON_SITE_URL` so the links in them are the ones people use; the server must be able to reach its own address (the one the request came in on) to build them.
