// W3C Trace Context (https://www.w3.org/TR/trace-context/): a request that arrives with a `traceparent` header keeps its trace id through this
// server, which answers with a `traceparent` of its own span, so a trace that starts in a browser, a CDN or the web app can be followed here
// in the access log and in any tracing back end that reads the header. A request without one starts a new trace. No library, no exporter:
// the id is in the log line and the response, which is what a collector (the OpenTelemetry agent, X-Ray, Datadog) needs to join the pieces.

import { randomBytes } from "node:crypto";

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

export type Trace = { traceId: string; flags: string };

/** The trace id and flags of a valid `traceparent` header, or null (all-zero ids, the reserved version ff and malformed values are invalid). */
export function parseTraceparent(header: string | undefined | null): Trace | null {
  const m = TRACEPARENT.exec((header ?? "").trim().toLowerCase());
  if (!m || m[1] === "ff" || /^0+$/.test(m[2]) || /^0+$/.test(m[3])) return null;
  return { traceId: m[2], flags: m[4] };
}

/** The trace this request belongs to (the caller's, or a new one) and the `traceparent` to answer with, naming this server's own span. */
export function startTrace(incoming: string | undefined | null): { traceId: string; spanId: string; header: string } {
  const parsed = parseTraceparent(incoming);
  const traceId = parsed?.traceId ?? randomBytes(16).toString("hex");
  const spanId = randomBytes(8).toString("hex");
  return { traceId, spanId, header: `00-${traceId}-${spanId}-${parsed?.flags ?? "01"}` };
}
