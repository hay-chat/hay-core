import { config } from "@server/config/env";
import { matchesAllowedDomains } from "@server/services/webchat/webchat-settings.service";

/**
 * Hostname of the page that made the request: from Origin, falling back to
 * Referer. Null when neither is present or parseable.
 */
export function requestHostname(
  headers: Record<string, string | string[] | undefined>,
): string | null {
  for (const name of ["origin", "referer"]) {
    const value = headers[name];
    if (typeof value !== "string" || !value) continue;
    try {
      return new URL(value).hostname.toLowerCase() || null;
    } catch {
      continue;
    }
  }
  return null;
}

// The Hay.chat dashboard previews the widget (demo page, playground) on its own
// domain, which merchants never add to their allowed list.
export function isDashboardHost(hostname: string | null): boolean {
  const dashboardHost = config.domain.dashboard.replace(/:\d+$/, "").toLowerCase();
  return !!hostname && !!dashboardHost && matchesAllowedDomains([dashboardHost], hostname);
}

/**
 * Hostname (no port) the challenge frame is served from. Challenge providers
 * report this hostname when a token is verified, so gates compare against it.
 */
export function challengeFrameHostname(): string {
  return config.domain.api.replace(/:\d+$/, "").toLowerCase();
}
