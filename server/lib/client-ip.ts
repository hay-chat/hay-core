import type { IncomingHttpHeaders } from "http";

/**
 * Client IP for a request that reached us through the reverse proxy.
 *
 * Takes the first X-Forwarded-For entry, then X-Real-IP, then the socket peer.
 * This is only trustworthy if the edge proxy overwrites X-Forwarded-For with
 * the address it saw (rather than appending to a client-supplied value);
 * otherwise a client can choose its own IP, so never use it as the only limit.
 */
export function getClientIp(headers: IncomingHttpHeaders, remoteAddress?: string): string {
  const forwardedFor = headers["x-forwarded-for"];
  const firstForwarded = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)
    ?.split(",")[0]
    ?.trim();
  const realIp = headers["x-real-ip"];
  return (
    firstForwarded ||
    (typeof realIp === "string" ? realIp : undefined) ||
    remoteAddress ||
    "Unknown"
  );
}
