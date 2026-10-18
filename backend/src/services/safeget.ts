// Outbound requests to an address somebody else typed in (an identity provider's discovery document, its keys, its token
// endpoint). The same protections as webhooks: https only, no credentials in the URL, and the connection can only go to a
// public address (the DNS answer is checked, so a name that points inside the network is refused). Redirects are not
// followed, answers are size-limited, and nothing waits longer than ten seconds.

import http from "node:http";
import https from "node:https";
import net from "node:net";
import { config } from "../config.ts";
import { ApiError } from "./context.ts";
import { isBlockedAddress, safeLookup, validateUrl } from "./webhooks.ts";

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;

export type Reply = { status: number; text: string };

export function guardedRequest(opts: { method: "GET" | "POST"; url: string; headers?: Record<string, string>; body?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    let target: URL;
    try {
      target = validateUrl(opts.url);
    } catch (err) {
      return reject(err);
    }
    const host = target.hostname.replace(/^\[|\]$/g, "");
    // A host that is already an address never goes through the lookup guard, so check it here.
    if (!config.webhooks.allowPrivate && net.isIP(host) !== 0 && isBlockedAddress(host)) {
      return reject(new ApiError(400, "blocked_address", "That address is on a private network, so Craton won’t connect to it."));
    }
    const lib = target.protocol === "https:" ? https : http;
    const body = opts.body;
    const req = lib.request(
      target,
      { method: opts.method, headers: { "user-agent": "Craton/1", ...(opts.headers ?? {}), ...(body !== undefined ? { "content-length": String(Buffer.byteLength(body)) } : {}) }, timeout: TIMEOUT_MS, lookup: safeLookup as never },
      (res) => {
        const parts: Buffer[] = [];
        let size = 0;
        res.on("data", (d: Buffer) => {
          size += d.length;
          if (size > MAX_BYTES) return req.destroy(new ApiError(502, "too_large", "The other side answered with more data than Craton will read."));
          parts.push(d);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(parts).toString("utf8") }));
      },
    );
    req.on("timeout", () => req.destroy(new ApiError(502, "timeout", "No answer within 10 seconds.")));
    req.on("error", (err: NodeJS.ErrnoException) => reject(err instanceof ApiError ? err : new ApiError(502, err.code === "EBLOCKED" ? "blocked_address" : "unreachable", err.code === "EBLOCKED" ? err.message : "Couldn’t reach that address.")));
    req.end(body);
  });
}
