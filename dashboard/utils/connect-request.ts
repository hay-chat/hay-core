const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function comparableHost(url: URL): string {
  return url.hostname.replace(/^www\./, "");
}

/**
 * The URL an external connect flow may send the organization id back to, or null.
 * Sites are the customer's own, so the host can't be listed in advance: it has to
 * be https (http on loopback only), carry no credentials, and match the site the
 * request names. The user still confirms the host shown on the page.
 */
export function parseConnectReturnUrl(returnUrl: string, siteUrl?: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(returnUrl);
  } catch {
    return null;
  }

  const allowedScheme =
    parsed.protocol === "https:" ||
    (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname));
  if (!allowedScheme || parsed.username || parsed.password) return null;

  if (siteUrl) {
    try {
      if (comparableHost(new URL(siteUrl)) !== comparableHost(parsed)) return null;
    } catch {
      return null;
    }
  }
  return parsed;
}
