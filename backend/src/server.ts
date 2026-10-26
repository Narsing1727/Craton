// Start the Craton API: `npm run dev` (watch) or `npm start`.

import { serve } from "@hono/node-server";
import { createApp } from "./api/app.ts";
import { createContext } from "./services/context.ts";
import { config } from "./config.ts";
import { startRetryLoop } from "./services/webhooks.ts";
import { startDigestLoop } from "./services/digest.ts";
import { backfillFootprints } from "./services/extent.ts";
import { backfillPaths } from "./services/history.ts";
import { warmUp } from "./services/warmup.ts";
import { beginDrain } from "./api/lifecycle.ts";
import { startBackupLoop } from "./services/backup.ts";
import { flushTokenRequests } from "./services/audit.ts";

const ctx = await createContext();
const app = await createApp(ctx);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Craton API on http://localhost:${info.port}/v1  (data: ${config.dataDir}, chunks: ${ctx.store.kind})`);
  if (!config.email.apiKey) console.log(`Email isn't configured: messages go to ${config.dataDir}/outbox and GET /v1/dev/outbox.`);
});

// Work out where existing repositories' data is, once, in the background.
void backfillFootprints(ctx).then((n) => n && console.log(`Located ${n} repositories.`)).catch((err) => console.error("footprint backfill failed:", err));

// Index the file names of repositories that predate the file index, once, in the background.
void backfillPaths(ctx).then((n) => n && console.log(`Indexed the files of ${n} repositories.`)).catch((err) => console.error("file index backfill failed:", err));

// Get the busiest repositories' pages and previews ready, so the first visitor does not pay for cold reads.
if (config.warmup > 0) setTimeout(() => void warmUp(app, ctx, { limit: config.warmup, log: (line) => console.log(line) }), 1500);

// Retry webhook deliveries that failed and are due again.
startRetryLoop(ctx);
startDigestLoop(ctx);

// Copies of the database on a schedule (on by default when the data folder is the only copy there is).
const backups = startBackupLoop(ctx);
if (backups) console.log(`Backing up the database every ${config.backup.everyHours} h to ${config.backup.dir} (newest ${config.backup.keep} kept).`);

// Keep idle connections open longer than clients keep them pooled. With Node's 5 s default, a
// client that was busy (or blocked) can reuse a socket the server just closed and get ECONNRESET.
// headersTimeout must stay above keepAliveTimeout.
if ("keepAliveTimeout" in server) {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}

// Stop taking requests, let the ones in flight finish, then close the database connections (Ctrl-C, or a platform stopping the container).
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: shutting down${config.drainSeconds ? ` (draining for ${config.drainSeconds} s first)` : ""}`);
    // Readiness turns to 503 at once; the load balancer needs a few seconds to notice and send new requests elsewhere.
    beginDrain();
    backups?.stop();
    const force = setTimeout(() => process.exit(1), config.drainSeconds * 1000 + 15_000);
    force.unref();
    setTimeout(() => {
      server.close(() => void flushTokenRequests(ctx).finally(() => ctx.db.close()).finally(() => process.exit(0)));
      if ("closeIdleConnections" in server) server.closeIdleConnections();
    }, config.drainSeconds * 1000);
  });
}
