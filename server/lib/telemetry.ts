import { PostHog } from "posthog-node";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";

const logger = createLogger("telemetry");

/**
 * Server-side error telemetry.
 *
 * Entirely opt-in: without POSTHOG_KEY the client is never constructed and every
 * exported function returns immediately, so local development and self-hosted
 * installs run with no PostHog dependency and no outbound requests.
 */
let client: PostHog | null = null;

export function isTelemetryEnabled(): boolean {
  return client !== null;
}

export function initTelemetry(): void {
  if (client) {
    return;
  }

  if (!config.posthog.key) {
    logger.debug("POSTHOG_KEY not set — server telemetry disabled");
    return;
  }

  client = new PostHog(config.posthog.key, {
    host: config.posthog.host,
    // Errors are low-volume and we want them promptly, but still batched enough
    // that a burst of failures doesn't turn into a request per error.
    flushAt: 20,
    flushInterval: 10_000,
  });

  logger.info({ host: config.posthog.host }, "Server telemetry enabled");
}

export interface ExceptionContext {
  /** Authenticated user id, when the request got far enough to have one. */
  userId?: string | null;
  organizationId?: string | null;
  /** Free-form tags — must never contain request input or customer data. */
  properties?: Record<string, unknown>;
}

/**
 * Report a server-side error to PostHog.
 *
 * Never throws and never blocks the caller: telemetry must not be able to turn a
 * handled error into a second failure. Events are queued and flushed in the
 * background, then drained by {@link shutdownTelemetry}.
 */
export function captureException(error: unknown, context: ExceptionContext = {}): void {
  if (!client) {
    return;
  }

  try {
    client.captureException(error, context.userId ?? undefined, {
      ...context.properties,
      // Distinguishes backend issues from browser ones in the shared project.
      source: "server",
      environment: config.env,
      ...(context.organizationId ? { organization_id: context.organizationId } : {}),
    });
  } catch (telemetryError) {
    logger.warn({ err: telemetryError }, "Failed to report exception to PostHog");
  }
}

/** Flush anything still queued. Safe to call when telemetry was never enabled. */
export async function shutdownTelemetry(): Promise<void> {
  if (!client) {
    return;
  }

  try {
    await client.shutdown();
  } catch (error) {
    logger.warn({ err: error }, "Failed to flush telemetry on shutdown");
  } finally {
    client = null;
  }
}
