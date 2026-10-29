import { TRPCError } from "@trpc/server";

/**
 * Which OAuth endpoints core may call for a plugin.
 *
 * Endpoint URLs come from the plugin worker's metadata (and may carry a
 * merchant-supplied `{shop}` host), so they are checked before core sends a
 * code, token or client secret to them: always HTTPS on the default port, and
 * when the client secret is server-managed (an env var core holds for the
 * plugin), only on hosts the plugin's static manifest declares in
 * `hay-plugin.oauthHosts` (exact host or `*.suffix`).
 */
export interface OAuthEndpointPolicy {
  /** Hosts the endpoint must match; null means any HTTPS host. */
  allowedHosts: string[] | null;
}

export function oauthEndpointPolicy(params: {
  managedSecret: boolean;
  declaredHosts: string[] | undefined;
}): OAuthEndpointPolicy {
  return { allowedHosts: params.managedSecret ? (params.declaredHosts ?? []) : null };
}

function hostMatches(host: string, pattern: string): boolean {
  const normalized = pattern.trim().toLowerCase();
  if (normalized.startsWith("*.")) {
    const suffix = normalized.slice(1); // ".example.com"
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === normalized;
}

/** Throws unless `rawUrl` is an OAuth endpoint core may call under `policy`. */
export function assertOAuthEndpoint(rawUrl: string, policy: OAuthEndpointPolicy): void {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "OAuth endpoint URL is invalid" });
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "OAuth endpoint must be a plain https URL" });
  }
  const host = url.hostname.toLowerCase();
  if (policy.allowedHosts && !policy.allowedHosts.some((pattern) => hostMatches(host, pattern))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `OAuth endpoint host ${host} is not declared by the plugin`,
    });
  }
}
