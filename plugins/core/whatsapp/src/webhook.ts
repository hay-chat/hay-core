import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import { PluginApiClient } from "./plugin-api.js";
import { validateTwilioSignature } from "./signature.js";

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

    // Validate Twilio signature to ensure the request is authentic.
    // The proxy passes x-twilio-signature and x-original-url headers,
    // and re-encodes the form body as JSON (same key-value pairs).
    const signature = req.headers["x-twilio-signature"] as string | undefined;
    const originalUrl = req.headers["x-original-url"] as string | undefined;

    if (!signature || !originalUrl) {
      logger.warn("Webhook missing Twilio signature or original URL headers");
      res.status(403).json({ error: "Missing signature" });
      return;
    }

    if (!validateTwilioSignature(token, signature, originalUrl, req.body)) {
      logger.warn("Invalid Twilio webhook signature", { originalUrl });
      res.status(403).json({ error: "Invalid signature" });
      return;
    }

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
