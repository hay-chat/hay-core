import { config } from "@server/config/env";
import { matchesAllowedDomains } from "@server/services/webchat/webchat-settings.service";
import type { WebchatSettings } from "@server/database/entities/webchat-settings.entity";

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
 * Whether a page on `hostname` may register page tools: the organization opted
 * in and the page is on the list. With no list of its own the feature uses the
 * allowed domains, minus `*`: letting any site embed the chat does not mean
 * letting any site give the AI tools.
 */
export function isPageToolsOrigin(
  settings: Pick<WebchatSettings, "pageTools" | "allowedDomains">,
  hostname: string | null,
): boolean {
  if (!settings.pageTools?.enabled) return false;
  if (isDashboardHost(hostname)) return true;
  const own = settings.pageTools.allowedOrigins ?? [];
  const allowed = own.length > 0 ? own : settings.allowedDomains.filter((d) => d.trim() !== "*");
  return matchesAllowedDomains(allowed, hostname);
}

/**
 * Hostname (no port) the challenge frame is served from. Challenge providers
 * report this hostname when a token is verified, so gates compare against it.
 */
export function challengeFrameHostname(): string {
  return config.domain.api.replace(/:\d+$/, "").toLowerCase();
}
