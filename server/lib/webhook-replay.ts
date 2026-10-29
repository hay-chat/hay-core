import crypto from "crypto";
import { redisService } from "@server/services/redis.service";
import { createLogger } from "@server/lib/logger";

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

/**
 * Record a verified webhook delivery id. Returns false when the id was
 * already processed (a replay or a provider re-delivery), true otherwise.
 * Fails open when Redis is unavailable: the signature and timestamp checks
 * still apply.
 */
export async function claimWebhookDelivery(
  namespace: string,
  deliveryId: string,
): Promise<boolean> {
  const client = redisService.getClient();
  if (!client || !redisService.isConnected()) {
    logger.warn({ namespace }, "Redis unavailable, webhook replay check skipped");
    return true;
  }
  try {
    const result = await client.set(
      seenKey(namespace, deliveryId),
      "1",
      "EX",
      SEEN_TTL_SECONDS,
      "NX",
    );
    return result === "OK";
  } catch (error) {
    logger.warn({ err: error, namespace }, "Webhook replay check failed, allowing delivery");
    return true;
  }
}

/**
 * Forget a delivery id after processing failed, so the provider's retry of
 * the same delivery is accepted.
 */
export async function releaseWebhookDelivery(namespace: string, deliveryId: string): Promise<void> {
  try {
    await redisService.getClient()?.del(seenKey(namespace, deliveryId));
  } catch (error) {
    logger.warn({ err: error, namespace }, "Could not release webhook delivery id");
  }
}
