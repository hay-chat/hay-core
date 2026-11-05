import { getDashboardUrl } from "@server/config/env";

/**
 * Origins a plugin connect handshake may send the browser back to: the ones listed in
 * CONNECT_ALLOWED_REDIRECT_ORIGINS (external apps such as a Shopify admin page) plus the
 * dashboard's own origin, so the in-app setup can resume after OAuth. Deny by default.
 */
export function allowedConnectReturnOrigins(): string[] {
  const listed = (process.env.CONNECT_ALLOWED_REDIRECT_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = new Set(listed);
  try {
    const dashboard = getDashboardUrl();
    // An unconfigured dashboard domain yields "http://": not an origin to trust.
    if (new URL(dashboard).hostname) origins.add(new URL(dashboard).origin);
  } catch {
    // No usable dashboard URL configured: only the listed origins apply.
  }
  return [...origins];
}

/** True only when `returnTo` parses as an http(s) URL whose origin is exactly an allowed one. */
export function isAllowedConnectReturn(returnTo: string): boolean {
  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return allowedConnectReturnOrigins().includes(url.origin);
}
