import { createHash } from "node:crypto";

export interface SecurityHeaderConfig {
  /** Absolute API base URL (e.g. https://api.hay.chat); empty when same-origin. */
  apiBaseUrl: string;
  /** PostHog ingestion host; only added when telemetry is configured. */
  posthogHost?: string;
  useSSL: boolean;
}

/** Headers sent with every dashboard response. */
export function baseSecurityHeaders(useSSL: boolean): Record<string, string> {
  return {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    ...(useSSL ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

function originOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

/** The WebSocket origin matching an http(s) origin. */
function socketOriginOf(origin: string): string {
  return origin.replace(/^http/, "ws");
}

/** PostHog serves its lazy-loaded scripts from `<region>-assets.i.posthog.com`. */
function posthogAssetsOriginOf(origin: string): string | undefined {
  const match = /^https:\/\/([a-z]+)\.i\.posthog\.com$/.exec(origin);
  return match ? `https://${match[1]}-assets.i.posthog.com` : undefined;
}

/** `'sha256-…'` source for an inline script body. */
export function scriptHashSource(body: string): string {
  return `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;
}

/** Bodies of the inline (no `src`) scripts in an HTML fragment. */
export function inlineScriptBodies(html: string): string[] {
  const bodies: string[] = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (!/\bsrc\s*=/i.test(match[1]) && match[2]) bodies.push(match[2]);
  }
  return bodies;
}

/**
 * Content-Security-Policy for the dashboard document. Hosts come from runtime
 * config so one build serves any deployment; inline scripts are allowed by hash.
 */
export function contentSecurityPolicy(
  config: SecurityHeaderConfig,
  inlineScriptHashes: string[] = [],
): string {
  const api = originOf(config.apiBaseUrl);
  const posthog = originOf(config.posthogHost);
  const posthogAssets = posthog ? posthogAssetsOriginOf(posthog) : undefined;
  const sources = (...values: (string | undefined)[]) =>
    [...new Set(values.filter((value): value is string => !!value))].join(" ");

  const directives: Record<string, string> = {
    "default-src": "'self'",
    // Plugin settings UIs load as script bundles from the API.
    "script-src": sources("'self'", ...inlineScriptHashes, api, posthogAssets),
    // Components set inline styles; plugin UIs ship their CSS from the API.
    "style-src": sources("'self'", "'unsafe-inline'", "https://fonts.googleapis.com", api),
    "font-src": "'self' data: https://fonts.gstatic.com",
    // Product images, avatars and media come from shops and storage hosts.
    "img-src": "'self' data: blob: https:",
    "media-src": "'self' blob: https:",
    "connect-src": sources(
      "'self'",
      api,
      api ? socketOriginOf(api) : undefined,
      posthog,
      posthogAssets,
    ),
    "worker-src": "'self'",
    "manifest-src": "'self'",
    "object-src": "'none'",
    "base-uri": "'self'",
    "form-action": "'self'",
    "frame-ancestors": "'none'",
  };
  if (config.useSSL) directives["upgrade-insecure-requests"] = "";

  return Object.entries(directives)
    .map(([name, value]) => (value ? `${name} ${value}` : name))
    .join("; ");
}
