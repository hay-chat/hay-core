import type { IncomingHttpHeaders } from "http";
import { config } from "@server/config/env";

/**
 * Client IP for a request, with the same semantics as Express `req.ip` under
 * `trust proxy = <hops>`: the X-Forwarded-For chain plus the socket peer is
 * read from the right, skipping `trustedHops` addresses added by our own
 * reverse proxies. Entries further left were supplied by the client and are
 * never trusted, so a client cannot choose its own IP.
 *
 * Works without an Express request (WebSocket upgrades) and is kept in step
 * with `app.set("trust proxy", config.server.trustProxy)` in main.ts.
 */
export function getClientIp(
  headers: IncomingHttpHeaders,
  remoteAddress?: string,
  trustedHops: number = config.server.trustProxy,
): string {
  const forwardedFor = headers["x-forwarded-for"];
  const forwarded = (Array.isArray(forwardedFor) ? forwardedFor.join(",") : (forwardedFor ?? ""))
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const chain = [...forwarded, remoteAddress].filter((entry): entry is string => !!entry);
  if (chain.length === 0) {
    return "Unknown";
  }
  return chain[Math.max(0, chain.length - 1 - trustedHops)];
}
