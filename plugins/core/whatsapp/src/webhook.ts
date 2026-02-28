import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { PluginApiClient } from "./plugin-api.js";

export interface WebhookContext {
  getAuthToken: () => string | null;
  logger: HayLogger;
}

/**
 * Handle incoming Twilio WhatsApp webhook
 *
 * Flow:
 * 1. Validate Twilio signature
 * 2. Extract sender phone and message body
 * 3. Call plugin API messages.receive to create/reuse conversation
 * 4. Return 200
 */
export async function webhookHandler(
  req: Request,
  res: Response,
  ctx: WebhookContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    const token = ctx.getAuthToken();
    if (!token) {
      logger.error("Webhook received but auth token not configured");
      res.status(503).json({ error: "Plugin not fully configured" });
      return;
    }

    // NOTE: Twilio signature validation cannot be done here because the proxy
    // converts the original form-encoded body to JSON, invalidating the HMAC signature.
    // TODO: Implement signature validation at the proxy level (server/routes/v1/plugins/proxy.ts)
    // before the body transformation, where the raw form-encoded body is still available.

    // Extract message data from Twilio's form-encoded body (now JSON after proxy conversion)
    const { From, Body, ProfileName, WaId, MessageSid } = req.body;

    if (!From || !Body) {
      logger.warn("Webhook missing required fields", { hasFrom: !!From, hasBody: !!Body });
      res.status(400).json({ error: "Missing From or Body" });
      return;
    }

    // Strip "whatsapp:" prefix to get clean E.164 phone number
    const phone = From.replace("whatsapp:", "");

    logger.info("WhatsApp message received", {
      from: phone,
      messageSid: MessageSid,
      profileName: ProfileName,
    });

    // Call the main server's plugin API to create/reuse conversation and add message
    const apiClient = new PluginApiClient(logger);
    const result = await apiClient.mutation<{
      messageId: string;
      conversationId: string;
      processed: boolean;
    }>("messages.receive", {
      from: phone,
      content: Body,
      channel: "whatsapp",
      metadata: {
        profileName: ProfileName,
        waId: WaId,
        messageSid: MessageSid,
      },
    });

    logger.info("Message processed", {
      messageId: result.messageId,
      conversationId: result.conversationId,
    });

    res.status(200).json({ received: true });
  } catch (error: any) {
    logger.error("Webhook handler error", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: "Internal server error" });
  }
}
