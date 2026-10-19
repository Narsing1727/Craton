# Craton

[![CI](https://github.com/Narsing1727/Craton/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Narsing1727/Craton/actions/workflows/ci.yml)

Version control for hydro and GIS data: DEMs, shapefiles, LiDAR, NetCDF and HEC-RAS/SWMM projects, versioned and
synced like git, with content-defined chunking, Merkle-root verification, visual diffs and checks on every push.

| Part | Folder | What it is |
| --- | --- | --- |
| API and CLI | `backend/` | Hono + PostgreSQL server (port 4000), the `craton` command line, MCP server |
| Web app | `frontend/` | Next.js app (port 3100) |
| Python client | `sdk/python/` | Small client for the HTTP API |
| Checks | `scripts/verify.mjs` | Runs the tests, typechecks, route sweeps, keyboard walk and contrast scan |

## Run it

```
cd backend  && npm install && npm start      # API on http://localhost:4000
cd frontend && npm install && npm run dev    # web app on http://localhost:3100
```

Set `CRATON_API_URL` for the web app if the API is elsewhere. Settings, backup and restore are in `OPERATING.md`; running it on AWS (containers, RDS, S3) is in `DEPLOY.md`;
signed webhook deliveries and receiver examples are in `WEBHOOKS.md`.

## Check it

```
node scripts/verify.mjs          # everything (needs the API and the web app running for the browser steps)
node scripts/verify.mjs --fast   # tests and typechecks only
```

Needs Node 23 or newer.
