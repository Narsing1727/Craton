// Start the Craton API: `npm run dev` (watch) or `npm start`.

import { serve } from "@hono/node-server";
import { createApp } from "./api/app.ts";
import { createContext } from "./services/context.ts";
import { config } from "./config.ts";
import { startRetryLoop } from "./services/webhooks.ts";
import { startDigestLoop } from "./services/digest.ts";
import { backfillFootprints } from "./services/extent.ts";
import { backfillPaths } from "./services/history.ts";

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

// Retry webhook deliveries that failed and are due again.
startRetryLoop(ctx);
startDigestLoop(ctx);

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
    console.log(`${signal}: shutting down`);
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    server.close(() => void ctx.db.close().finally(() => process.exit(0)));
    if ("closeIdleConnections" in server) server.closeIdleConnections();
  });
}
