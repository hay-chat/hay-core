import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient } from "./graph-client.js";
import { GraphApiError } from "./graph-client.js";

export interface DeliverContext {
  /** Resolves the Graph client (built in onStart once credentials exist). */
  getGraphClient: () => GraphClient | null;
  /** Resolves the page/IG access token used to send outbound DMs. */
  getAccessToken: () => string | null;
  logger: HayLogger;
}

interface DeliverPayload {
  to: string;
  content: string;
  messageId: string;
  conversationId: string;
  conversationMetadata?: Record<string, any> | null;
  messageMetadata?: Record<string, any> | null;
}

/**
 * Meta's "message sent outside the allowed window" error.
 *
 * Instagram messaging enforces a 24-hour standard messaging window after the
 * customer's last message. Sending outside it returns Graph error code 10 with
 * subcode ~2534022. We match defensively on code/subcode/message so we don't
 * 500 (and trigger a useless retry) on a permanent, expected failure.
 */
function is24hWindowError(error: GraphApiError): boolean {
  if (error.subcode === 2534022) {
    return true;
  }
  if (error.code === 10 && /24|outside.*window|messaging window/i.test(error.message)) {
    return true;
  }
  return false;
}

/**
 * Outbound delivery handler — called by Hay's ChannelDeliveryService when the
 * orchestrator produces a bot response on an instagram-channel conversation.
 *
 * Flow:
 *   1. Send the text via POST /me/messages using the org's access token.
 *   2. Return { success:true, providerMessageId } so Hay stores the Meta mid.
 *
 * Error semantics (chatwoot pattern — never retry permanent provider errors):
 *   - 24h window expired           → 200 { success:false, error:"24h_window_expired" }
 *   - other non-retryable Graph 4xx → 200 { success:false, error:"graph_<status>" }
 *   - unknown / network errors      → 500 (Hay may retry)
 */
export async function deliverHandler(
  req: Request,
  res: Response,
  ctx: DeliverContext,
): Promise<void> {
  const { logger } = ctx;

  try {
    const graphClient = ctx.getGraphClient();
    const accessToken = ctx.getAccessToken();

    if (!graphClient || !accessToken) {
      logger.error("Deliver called but Instagram Graph client not configured");
      res.status(503).json({ success: false, error: "Plugin not fully configured" });
      return;
    }

    const { to, content, messageId, conversationId } = req.body as DeliverPayload;

    if (!to || !content) {
      res.status(400).json({ success: false, error: "Missing 'to' or 'content'" });
      return;
    }

    // `to` arrives namespaced as "instagram:{psid}" (set on inbound). Strip the
    // namespace before calling the Graph API, tolerating an already-bare psid.
    const recipientPsid = to.startsWith("instagram:") ? to.slice("instagram:".length) : to;

    logger.info("Delivering Instagram message", {
      conversationId,
      messageId,
      contentLength: content.length,
    });

    const providerMessageId = await graphClient.sendText(recipientPsid, content, accessToken);

    logger.info("Instagram message delivered", {
      providerMessageId,
      messageId,
    });

    res.status(200).json({
      success: true,
      providerMessageId,
    });
  } catch (error: any) {
    if (error instanceof GraphApiError) {
      if (is24hWindowError(error)) {
        logger.warn("24h Instagram messaging window expired", {
          messageId: req.body?.messageId,
          code: error.code,
          subcode: error.subcode,
        });
        res.status(200).json({ success: false, error: "24h_window_expired" });
        return;
      }

      // Non-retryable provider error (4xx, or a structured Graph error with no
      // network failure). status 0 means a network-level failure → retryable.
      if (error.status >= 400 && error.status < 500) {
        logger.error("Instagram Graph API returned non-retryable error on deliver", {
          status: error.status,
          code: error.code,
          subcode: error.subcode,
          message: error.message,
          messageId: req.body?.messageId,
        });
        res.status(200).json({ success: false, error: `graph_${error.status}` });
        return;
      }

      // Network or 5xx Graph error — allow Hay to retry.
      logger.error("Instagram Graph API transient error on deliver", {
        status: error.status,
        message: error.message,
        messageId: req.body?.messageId,
      });
      res.status(500).json({ success: false, error: error.message });
      return;
    }

    logger.error("Failed to deliver Instagram message", {
      error: error?.message,
      messageId: req.body?.messageId,
    });
    res.status(500).json({ success: false, error: error?.message });
  }
}
