// The address the browser used to reach this site, for redirects built inside route handlers.
//
// `request.url` is not it: the server is started with `-H 0.0.0.0` (to be reachable on the LAN), and Next puts that
// bind address in the URL, so a redirect built from it sends the browser to http://0.0.0.0:3100, which browsers refuse.
// The Host header (or the proxy's forwarded one) is what the person typed.

export function requestOrigin(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost || request.headers.get("host") || url.host;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto = forwardedProto || url.protocol.replace(":", "");
  // A bind address is never something to send a browser to.
  const safeHost = /^(0\.0\.0\.0|\[::\])(:\d+)?$/.test(host) ? host.replace(/^(0\.0\.0\.0|\[::\])/, "localhost") : host;
  return `${proto}://${safeHost}`;
}

/** An absolute URL for `path` on the address the browser used. */
export function redirectUrl(request: Request, path: string): URL {
  return new URL(path, requestOrigin(request));
}
