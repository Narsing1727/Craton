// The server's own life cycle, as the rest of the API needs to know it.
//
// When a platform stops a container (a deploy, a scale-in) it first takes it out of the load balancer, but not instantly: for a few seconds the
// balancer still sends it requests. So on SIGTERM the server does not close at once; it says "draining" (readiness answers 503 and every reply
// carries Connection: close, so keep-alive clients reconnect to a healthy server), waits CRATON_DRAIN_SECONDS, and only then stops taking
// connections and lets the requests in flight finish.

export const lifecycle = { draining: false };

export function beginDrain() {
  lifecycle.draining = true;
}
