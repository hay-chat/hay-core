import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { SmtpSender } from "./smtp-sender.js";
import { PluginApiClient } from "./plugin-api.js";

export interface DeliverContext {
  getSmtpSender: () => SmtpSender | null;
  logger: HayLogger;
}

interface DeliverPayload {
  to: string; // Customer email address (external_id)
  content: string; // Bot/agent reply text
  messageId: string; // Hay message ID
  conversationId: string;
}

/**
 * Handle outbound email delivery.
 *
 * Called by Channel Delivery Service when the orchestrator generates
 * a response for an email conversation.
 *
 * Threading strategy:
 * - Fetch recent messages for the conversation to find email metadata
 * - Use the latest inbound email's Message-ID as In-Reply-To
 * - Build References chain from conversation history
 * - Use original Subject (with Re: prefix if not present)
 */
export async function deliverHandler(
  req: Request,
  res: Response,
  ctx: DeliverContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    const sender = ctx.getSmtpSender();
    if (!sender) {
      logger.error("Deliver called but SMTP sender not configured");
      res.status(503).json({ success: false, error: "Plugin not fully configured" });
      return;
    }

    const { to, content, messageId, conversationId } = req.body as DeliverPayload;

    if (!to || !content) {
      res.status(400).json({ success: false, error: "Missing 'to' or 'content'" });
      return;
    }

    logger.info("Delivering email", { to, messageId, conversationId });

    // Reconstruct email threading context from conversation history
    let subject = "New message";
    let inReplyTo: string | undefined;
    let references: string[] = [];

    try {
      const apiClient = new PluginApiClient(logger);
      const messages = await apiClient.query<any[]>("messages.getByConversation", {
        conversationId,
      });

      // Find the most recent inbound (Customer) message with email metadata
      const inboundMessages = (messages || [])
        .filter((m: any) => m.type === "Customer" && m.metadata?.messageId)
        .reverse(); // Most recent first

      if (inboundMessages.length > 0) {
        const latestInbound = inboundMessages[0];
        const meta = latestInbound.metadata;

        subject = meta.subject || subject;
        if (!subject.toLowerCase().startsWith("re:")) {
          subject = `Re: ${subject}`;
        }

        inReplyTo = meta.messageId;

        // Build references chain
        if (meta.references && Array.isArray(meta.references)) {
          references = [...meta.references];
        }
        if (meta.messageId && !references.includes(meta.messageId)) {
          references.push(meta.messageId);
        }
      }
    } catch (error: any) {
      logger.warn(
        `Could not fetch threading context: ${error.message}. Sending without threading.`,
      );
    }

    const result = await sender.sendReply({
      to,
      subject,
      content,
      inReplyTo,
      references,
    });

    logger.info("Email delivered", {
      messageId,
      providerMessageId: result.messageId,
      to,
      subject,
    });

    res.status(200).json({
      success: true,
      providerMessageId: result.messageId,
    });
  } catch (error: any) {
    logger.error("Failed to deliver email", {
      error: error.message,
      messageId: req.body?.messageId,
    });

    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
}
