// Start the Craton API: `npm run dev` (watch) or `npm start`.

import { serve } from "@hono/node-server";
import { createApp } from "./api/app.ts";
import { createContext } from "./services/context.ts";
import { config } from "./config.ts";
import { startRetryLoop } from "./services/webhooks.ts";
import { backfillFootprints } from "./services/extent.ts";

const ctx = createContext();
const app = createApp(ctx);

const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`Craton API on http://localhost:${info.port}/v1  (data: ${config.dataDir}, chunks: ${ctx.store.kind})`);
  if (!config.email.apiKey) console.log(`Email isn't configured: messages go to ${config.dataDir}/outbox and GET /v1/dev/outbox.`);
});

// Work out where existing repositories' data is, once, in the background.
void backfillFootprints(ctx).then((n) => n && console.log(`Located ${n} repositories.`)).catch((err) => console.error("footprint backfill failed:", err));

// Retry webhook deliveries that failed and are due again.
startRetryLoop(ctx);

// Keep idle connections open longer than clients keep them pooled. With Node's 5 s default, a
// client that was busy (or blocked) can reuse a socket the server just closed and get ECONNRESET.
// headersTimeout must stay above keepAliveTimeout.
if ("keepAliveTimeout" in server) {
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
}
