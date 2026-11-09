import { config } from "@server/config/env";

export interface WebauthnConfig {
  rpId: string;
  rpName: string;
  origins: string[];
}

const RP_NAME = "Hay";

function hostname(domain: string): string {
  return domain.replace(/:\d+$/, "");
}

/**
 * The relying party for security keys and passkeys, read on use so it follows
 * the environment.
 *
 * The RP ID is `WEBAUTHN_RP_ID`, else the base domain, else the dashboard host.
 * Allowed origins are `WEBAUTHN_ORIGINS` (comma separated), else the dashboard
 * origin. Returns null when no domain is configured, which turns the feature off.
 */
export function getWebauthnConfig(): WebauthnConfig | null {
  const dashboard = config.domain.dashboard;
  const rpId = hostname(process.env.WEBAUTHN_RP_ID || config.domain.base || dashboard);
  if (!rpId) return null;

  const configured = (process.env.WEBAUTHN_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const scheme = config.domain.useSSL ? "https" : "http";
  const origins = configured.length ? configured : dashboard ? [`${scheme}://${dashboard}`] : [];
  if (origins.length === 0) return null;

  return { rpId, rpName: RP_NAME, origins };
}
