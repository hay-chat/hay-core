import type { Request, Response } from "express";
import type Twilio from "twilio";
import type { HayLogger } from "@hay/plugin-sdk/types";

export interface DeliverContext {
  getTwilioClient: () => Twilio.Twilio | null;
  getWhatsappNumber: () => string | null;
  logger: HayLogger;
}

interface DeliverPayload {
  to: string;
  content: string;
  messageId: string;
  conversationId: string;
}

/**
 * Handle outbound message delivery via Twilio
 *
 * Called by the Channel Delivery Service when the orchestrator generates
 * a bot response on a WhatsApp conversation.
 *
 * Flow:
 * 1. Validate payload
 * 2. Send message via Twilio API
 * 3. Handle 24h window expiration (error 63016)
 * 4. Return provider message ID
 */
export async function deliverHandler(
  req: Request,
  res: Response,
  ctx: DeliverContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    const client = ctx.getTwilioClient();
    const fromNumber = ctx.getWhatsappNumber();

    if (!client || !fromNumber) {
      logger.error("Deliver called but Twilio client or number not configured");
      res.status(503).json({ success: false, error: "Plugin not fully configured" });
      return;
    }

    const { to, content, messageId, conversationId } = req.body as DeliverPayload;

    if (!to || !content) {
      res.status(400).json({ success: false, error: "Missing 'to' or 'content'" });
      return;
    }

    logger.info("Delivering WhatsApp message", {
      to,
      messageId,
      conversationId,
      contentLength: content.length,
    });

    const message = await client.messages.create({
      from: `whatsapp:${fromNumber}`,
      to: `whatsapp:${to}`,
      body: content,
    });

    logger.info("WhatsApp message delivered", {
      providerMessageId: message.sid,
      status: message.status,
    });

    res.status(200).json({
      success: true,
      providerMessageId: message.sid,
    });
  } catch (error: any) {
    // Twilio error 63016 = 24h customer service window expired
    if (error.code === 63016) {
      logger.warn("24h WhatsApp session window expired", {
        messageId: req.body?.messageId,
      });
      res.status(200).json({
        success: false,
        error: "24h_window_expired",
      });
      return;
    }

    logger.error("Failed to deliver WhatsApp message", {
      error: error.message,
      code: error.code,
      messageId: req.body?.messageId,
    });

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
