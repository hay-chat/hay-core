import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { ChatwootApi } from "./chatwoot-api.js";
import { ChatwootApiError } from "./chatwoot-api.js";

export interface DeliverContext {
  getChatwootApi: () => ChatwootApi | null;
  logger: HayLogger;
}

interface DeliverPayload {
  to: string;
  content: string;
  messageId: string;
  conversationId: string;
  // Populated by channel-delivery.service. For Chatwoot we read
  // `conversationMetadata.chatwoot.conversationId` to find the Chatwoot
  // conversation id we should post the message to.
  conversationMetadata?: Record<string, any> | null;
  messageMetadata?: Record<string, any> | null;
}

/**
 * Outbound delivery handler — called by Hay's ChannelDeliveryService when the
 * orchestrator produces a bot response on a chatwoot-channel conversation.
 *
 * Flow:
 *   1. Resolve the Chatwoot conversation id from conversationMetadata
 *   2. POST the message via the Chatwoot API (message_type=outgoing, not private)
 *   3. Return { success, providerMessageId } so Hay can store the Chatwoot id
 */
export async function deliverHandler(
  req: Request,
  res: Response,
  ctx: DeliverContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    const api = ctx.getChatwootApi();
    if (!api) {
      logger.error("Deliver called but Chatwoot API client not configured");
      res.status(503).json({ success: false, error: "Plugin not fully configured" });
      return;
    }

    const { content, messageId, conversationId, conversationMetadata } = req.body as DeliverPayload;

    const chatwootConversationId =
      conversationMetadata?.chatwoot?.conversationId ??
      conversationMetadata?.chatwoot?.chatwootConversationId;

    if (!chatwootConversationId) {
      logger.error("Deliver payload missing chatwoot conversation id", {
        conversationId,
        messageId,
        hasMetadata: !!conversationMetadata,
      });
      res.status(400).json({
        success: false,
        error: "missing_chatwoot_conversation_id",
      });
      return;
    }

    if (!content) {
      res.status(400).json({ success: false, error: "Missing content" });
      return;
    }

    logger.info("Delivering message to Chatwoot", {
      chatwootConversationId,
      messageId,
      conversationId,
      contentLength: content.length,
    });

    const result = await api.sendMessage(chatwootConversationId, content, { private: false });

    logger.info("Chatwoot message delivered", {
      chatwootMessageId: result.id,
      messageId,
    });

    res.status(200).json({
      success: true,
      providerMessageId: String(result.id),
    });
  } catch (error: any) {
    if (error instanceof ChatwootApiError) {
      logger.error("Chatwoot API returned error on deliver", {
        status: error.status,
        message: error.message,
        messageId: req.body?.messageId,
      });
      res.status(200).json({
        success: false,
        error: `chatwoot_${error.status}`,
      });
      return;
    }

    logger.error("Failed to deliver Chatwoot message", {
      error: error.message,
      messageId: req.body?.messageId,
    });
    res.status(500).json({ success: false, error: error.message });
  }
}
