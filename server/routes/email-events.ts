import { Router, type Request } from "express";
import { verifySvixSignature } from "@server/lib/svix-signature";
import { applyEmailEvent, type ResendEmailEvent } from "@server/services/email-events.service";
import { createLogger } from "@server/lib/logger";

/**
 * POST /v1/webhooks/email-events — Resend email events (D13-10).
 *
 * Configure one Resend webhook for email.bounced, email.complained and
 * email.delivered pointing here; its signing secret goes in
 * RESEND_EVENTS_WEBHOOK_SECRET. Unsigned or badly signed requests get 401.
 * Events for mail we cannot match (core notifications, other senders on the
 * account) are acknowledged so Resend does not retry them.
 */

const logger = createLogger("email-events-webhook");
const router = Router();

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

router.post("/v1/webhooks/email-events", async (req, res) => {
  const secret = process.env.RESEND_EVENTS_WEBHOOK_SECRET;
  if (!secret) {
    res.status(503).json({ error: "Email events are not configured" });
    return;
  }
  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  if (
    !rawBody ||
    !verifySvixSignature(
      Buffer.from(rawBody, "utf8"),
      {
        id: header(req, "svix-id"),
        timestamp: header(req, "svix-timestamp"),
        signature: header(req, "svix-signature"),
      },
      secret,
    )
  ) {
    res.status(401).json({ error: "Invalid signature" });
    return;
  }

  try {
    const outcome = await applyEmailEvent(req.body as ResendEmailEvent);
    if (outcome.handled && outcome.providerStatus === "failed") {
      const { channelHealthService } = await import("@server/services/channel-health.service");
      void channelHealthService.recordDeliveryFailure(outcome.organizationId, outcome.channel);
    }
    res.json({ ok: true, handled: outcome.handled });
  } catch (error) {
    logger.error({ err: error }, "Email event handling failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
