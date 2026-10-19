# Deploying Craton on AWS

Craton is two containers, a database and an object store. Nothing in the code is AWS-specific: each piece is chosen by environment variables ([OPERATING.md](OPERATING.md) lists every one), so moving from your laptop to AWS is configuration.

```
browser ──► load balancer ──► web (Next.js, :3100) ──► api (:4000) ──► PostgreSQL (RDS / Aurora)
                                                                  └──► S3 bucket (chunks)
identity provider / CI / CLI ───────────────────────► api (through the same or a second listener)
```

| Piece | On AWS | Setting |
| --- | --- | --- |
| API image | ECS Fargate service (or App Runner, EKS) | `backend/Dockerfile` |
| Web image | ECS Fargate service | `frontend/Dockerfile` |
| Database | RDS for PostgreSQL 14+ or Aurora PostgreSQL | `CRATON_DATABASE_URL`, `CRATON_DB_CA` |
| Chunks | S3 bucket, versioning on | `CRATON_S3_BUCKET`, `CRATON_S3_REGION` |
| Shared cache (optional) | ElastiCache for Redis OSS or Valkey, in the same VPC | `CRATON_REDIS_URL` |
| Secrets | Secrets Manager / SSM, injected as environment | `CRATON_DATABASE_URL`, `CRATON_SECRET_KEY`, `EMAIL_API_KEY` |
| Email | Resend or Postmark (a key) | `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` |

## Try the same containers on your machine first

```sh
docker compose --profile stack up --build          # database, API (4000) and web app (3100)
CRATON_API_PORT=4100 CRATON_WEB_PORT=3200 docker compose --profile stack up --build   # other ports
```

These are the images you will run on AWS. Both have health checks (`/v1/ready` for the API, which includes the database).

## 1. Database

1. Create an RDS PostgreSQL (or Aurora PostgreSQL) instance, version 14 or newer, in private subnets. Create a database and a user that owns it. Craton creates the `citext` extension itself on first start; RDS lets the database owner do that.
2. Allow the API's security group to reach it on 5432. Nothing else needs to.
3. Download the AWS certificate bundle (`global-bundle.pem`, from the RDS documentation), put it in the API image or a mounted volume, and set:
   ```
   CRATON_DATABASE_URL=postgres://craton_app:<password>@<endpoint>:5432/craton?sslmode=require
   CRATON_DB_CA=/etc/ssl/rds-global-bundle.pem
   CRATON_DB_POOL_MAX=10        # keep (tasks × this) below the server's max_connections
   ```
4. The schema is created and updated by the API when it starts, in a transaction under a lock. Start one task, then the rest (see "Upgrading").
5. Backups: turn on automated RDS backups and snapshots. `npm run backup` in the API image is a second, engine-neutral copy.

Moving an existing SQLite-era installation: run `npm run migrate-sqlite` once against the new database (OPERATING.md → The database).

## 2. Chunk storage

1. Create a private S3 bucket with versioning on and public access blocked.
2. Give the API's **task role** this policy (no access keys are needed; Craton reads the role's credentials itself):
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], "Resource": "arn:aws:s3:::YOUR-BUCKET/*" },
       { "Effect": "Allow", "Action": "s3:ListBucket", "Resource": "arn:aws:s3:::YOUR-BUCKET" }
     ]
   }
   ```
   (`ListBucket` makes S3 answer 404 instead of 403 for a missing chunk.)
3. `CRATON_S3_BUCKET=YOUR-BUCKET`, `CRATON_S3_REGION=ap-south-1`, optionally `CRATON_S3_PREFIX=prod`.

A bucket in the same region as the API costs nothing for traffic between them.

## 2b. A shared cache (optional, recommended from two API tasks up)

Create an ElastiCache cluster (Redis OSS or Valkey, one node is enough; no persistence, no replicas needed), in the same VPC, reachable from the API's security group on 6379, with `maxmemory-policy allkeys-lru`. Set `CRATON_REDIS_URL=rediss://<endpoint>:6379` (`rediss://` when in-transit encryption is on). With it, rate limits are counted across all tasks, rendered raster tiles are shared between tasks and survive deploys, and anonymous visitors to the explore list are answered from a short copy. Without it everything still works, per task. If it goes away, the API keeps serving (`/v1/ready` shows `cache: degraded`).

## 3. The API service

- Image from `backend/Dockerfile`; container port 4000; health check path `/v1/ready`.
- Environment (secrets from Secrets Manager):
  ```
  CRATON_DATABASE_URL, CRATON_DB_CA, CRATON_S3_BUCKET, CRATON_S3_REGION
  CRATON_SECRET_KEY=<64 hex characters>     # REQUIRED: without it each container makes its own key and cannot read the others' secrets
  CRATON_WEB_URL=https://craton.example.org            # the web app, as browsers see it
  CRATON_PUBLIC_API_URL=https://api.craton.example.org # what identity providers call (SCIM base URL)
  CRATON_CORS_ORIGINS=https://craton.example.org
  CRATON_TRUSTED_PROXIES=10.0.0.0/16                   # your VPC range: the web tasks may pass on a visitor's real address
  EMAIL_PROVIDER=resend  EMAIL_API_KEY=...  EMAIL_FROM="Craton <no-reply@craton.example.org>"
  ```
- Metrics: set `CRATON_METRICS_TOKEN` and scrape `https://<api>/metrics` with that token (Prometheus, Grafana Agent, the CloudWatch agent with a Prometheus config). Alarms worth having: `craton_database_unavailable_total` rising, `craton_db_pool_connections{state="waiting"}` above zero for minutes, `craton_cache_up` at 0, the 5xx share of requests.
- Any number of tasks. Background work is safe on several (OPERATING.md → Running several servers). Run maintenance (`recode`, `repack`, `gc`) as a one-off task, not inside the service.
- Memory: 1 GB is a floor for a small installation; previews and tiles of large rasters are cached in memory, so size up with use.

## 4. The web service

- Image from `frontend/Dockerfile`; container port 3100; health check path `/login`.
- `CRATON_API_URL=http://<internal address of the API service>:4000` (service discovery or an internal load balancer). The browser never talks to the API directly.
- Terminate TLS at the load balancer; forward `X-Forwarded-Proto` and `X-Forwarded-Host`.

## 5. Load balancer

- An ALB with an ACM certificate. `/` to the web service; if identity providers or CI call the API directly, put it on a second hostname (`api.craton.example.org`) routed to the API service.
- Raise the idle timeout above the default if people push very large files (60 s is too short for a multi-GB upload through one request; the CLI uploads in batches of chunks, so the default is usually fine).
- A WAF rate rule is worth adding: Craton's own request limits are per task.

## 6. Identity provider connections

- OpenID Connect redirect URI: `<CRATON_WEB_URL>/auth/sso/callback`. SAML ACS URL: `<CRATON_WEB_URL>/auth/saml/acs`. SCIM base URL: `<CRATON_PUBLIC_API_URL>/v1/scim/v2/<organization>`. All three are shown in the organization's settings.

## Upgrading

1. Snapshot the database.
2. Deploy the new image to **one** task first and wait for it to be healthy (it applies pending migrations), then roll the rest. Do not run old and new versions together while a migration is pending.
3. There is no downgrade: roll back by restoring the snapshot and the previous image.

## What you do not need

No Redis (limits that matter for security are in the database), no queue (webhook deliveries are leased in the database), no shared disk (chunks are in S3), no sticky sessions.

## Checklist before real users

- [ ] `CRATON_SECRET_KEY` set from a secret store and backed up separately from the database.
- [ ] RDS backups on, a restore rehearsed (`npm run restore` on a copy).
- [ ] S3 versioning on; the task role has only the four actions above.
- [ ] `CRATON_TRUSTED_PROXIES` is your VPC range, not `0.0.0.0/0`.
- [ ] An email provider key, so people can confirm addresses and reset passwords (the development outbox is off in production).
- [ ] Certificate expiry reminders for any SAML provider you connect.
