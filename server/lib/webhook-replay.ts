import crypto from "crypto";
import { redisService } from "@server/services/redis.service";
import { createLogger } from "@server/lib/logger";
import { metrics } from "@server/lib/metrics";

const logger = createLogger("webhook-replay");

/**
 * How long a delivery id is remembered. Covers the whole window in which a
 * signed request passes the timestamp check (5 minutes either side).
 */
const SEEN_TTL_SECONDS = 10 * 60;

function seenKey(namespace: string, deliveryId: string): string {
  const digest = crypto.createHash("sha256").update(deliveryId).digest("hex");
  return `webhook:seen:${namespace}:${digest}`;
}

/** How long a provider should wait before retrying a refused delivery. */
export const WEBHOOK_RETRY_AFTER_SECONDS = 30;

/**
 * The store of seen delivery ids cannot be reached. The delivery has not been
 * processed: answer 503 so the provider retries it.
 */
export class WebhookReplayUnavailableError extends Error {
  constructor() {
    super("Webhook delivery store unavailable");
    this.name = "WebhookReplayUnavailableError";
  }
}

/**
 * Record a verified webhook delivery id for `ttlSeconds`. Returns false when
 * the id was already processed (a replay or a provider re-delivery), true
 * otherwise. Throws WebhookReplayUnavailableError when Redis is unavailable,
 * because without the store a repeat cannot be told from a first delivery.
 */
export async function claimWebhookDelivery(
  namespace: string,
  deliveryId: string,
  ttlSeconds: number = SEEN_TTL_SECONDS,
): Promise<boolean> {
  const client = redisService.getClient();
  if (!client || !redisService.isConnected()) {
    logger.error({ namespace }, "Redis unavailable, refusing webhook delivery");
    metrics.redisUnavailable.inc({ surface: "webhook_replay", action: "rejected" });
    throw new WebhookReplayUnavailableError();
  }
  try {
    const result = await client.set(seenKey(namespace, deliveryId), "1", "EX", ttlSeconds, "NX");
    return result === "OK";
  } catch (error) {
    logger.error({ err: error, namespace }, "Webhook replay check failed, refusing delivery");
    metrics.redisUnavailable.inc({ surface: "webhook_replay", action: "rejected" });
    throw new WebhookReplayUnavailableError();
  }
}

/**
 * Forget a delivery id after processing failed, so the provider's retry of
 * the same delivery is accepted.
 */
export async function releaseWebhookDelivery(namespace: string, deliveryId: string): Promise<void> {
  // Commands issued while disconnected would wait in ioredis's offline queue.
  if (!redisService.isConnected()) {
    logger.warn({ namespace }, "Redis unavailable, webhook delivery id not released");
    return;
  }
  try {
    await redisService.getClient()?.del(seenKey(namespace, deliveryId));
  } catch (error) {
    logger.warn({ err: error, namespace }, "Could not release webhook delivery id");
  }
}
