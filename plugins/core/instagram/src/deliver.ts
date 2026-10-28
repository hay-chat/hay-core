import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient, InstagramAttachmentType, SendMode } from "./graph-client.js";
import { GraphApiError } from "./graph-client.js";
import type { SentMessageTracker } from "./echo.js";

export interface DeliverContext {
  /** Resolves the Graph client (built in onStart once credentials exist). */
  getGraphClient: () => GraphClient | null;
  /** Resolves the page/IG access token used to send outbound DMs. */
  getAccessToken: () => string | null;
  logger: HayLogger;
  /** Remembers the mids sent here so their echoes are not mistaken for the owner's (D11-11). */
  tracker?: SentMessageTracker;
}

interface DeliverPayload {
  to: string;
  content: string;
  messageId: string;
  /** Who wrote it; "HumanAgent" may use Meta's Human Agent tag after 24 hours. */
  messageType?: string;
  conversationId: string;
  conversationMetadata?: Record<string, any> | null;
  messageMetadata?: Record<string, any> | null;
  /** Files on the message; Hay.chat sends private ones as short-lived signed links. */
  attachments?: Array<{ name?: string; url?: string; type?: string }> | null;
}

/** Instagram's DM attachment type for a MIME type, or null when Instagram can't send it. */
export function instagramAttachmentType(mimeType: string): InstagramAttachmentType | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "file";
  return null;
}

/**
 * Meta's "message sent outside the allowed window" error.
 *
 * Instagram messaging enforces a 24-hour standard messaging window after the
 * customer's last message. Sending outside it returns Graph error code 10 with
 * subcode ~2534022. We match defensively on code/subcode/message so we don't
 * 500 (and trigger a useless retry) on a permanent, expected failure.
 */
export function is24hWindowError(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) {
    return false;
  }
  if (error.subcode === 2534022 || error.subcode === 2018278) {
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
 *   1. Send each attachment as its own DM (Instagram has no captions), D8-17.
 *   2. Send the text via POST /me/messages using the org's access token.
 *      When Meta refuses because the 24-hour window has closed and a PERSON
 *      wrote the reply, the whole message is sent again with the HUMAN_AGENT
 *      tag (allowed up to 7 days). AI replies never use it.
 *   3. Return { success:true, providerMessageId } so Hay stores the Meta mid.
 *
 * Error semantics (chatwoot pattern — never retry permanent provider errors):
 *   - 24h window expired           → 200 { success:false, error:"24h_window_expired" }
 *   - other non-retryable Graph 4xx → 200 { success:false, error:"graph_<status>" }
 *   - unknown / network errors      → 500 (Hay may retry)
 *   - a failure after part of the message went out → 200 { success:false,
 *     error:"partial_delivery" }, never a retry that would send it twice
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

    const { to, content, messageId, messageType, conversationId, attachments } =
      req.body as DeliverPayload;

    const files = (Array.isArray(attachments) ? attachments : []).flatMap((file) => {
      const type = instagramAttachmentType(file?.type ?? "");
      const url = file?.url;
      return type && typeof url === "string" && url.startsWith("https://") ? [{ type, url }] : [];
    });
    const unsendable = (Array.isArray(attachments) ? attachments.length : 0) - files.length;

    if (!to || (!content && !files.length)) {
      if (to && unsendable > 0) {
        res.status(200).json({ success: false, error: "attachment_type_not_supported" });
        return;
      }
      res.status(400).json({ success: false, error: "Missing 'to' or 'content'" });
      return;
    }

    // `to` arrives namespaced as "instagram:{psid}" (set on inbound). Strip the
    // namespace before calling the Graph API, tolerating an already-bare psid.
    const recipientPsid = to.startsWith("instagram:") ? to.slice("instagram:".length) : to;

    logger.info("Delivering Instagram message", {
      conversationId,
      messageId,
      contentLength: content?.length ?? 0,
      attachmentCount: files.length,
      unsendableAttachments: unsendable,
    });

    // Instagram has no captions: each file is its own DM, then the text.
    const sentIds: string[] = [];
    const sendAll = (mode: SendMode) => async () => {
      for (const file of files) {
        const mid = await graphClient.sendAttachment(recipientPsid, file, accessToken, mode);
        ctx.tracker?.remember(mid);
        sentIds.push(mid);
      }
      if (content) {
        const mid = await graphClient.sendText(recipientPsid, content, accessToken, mode);
        ctx.tracker?.remember(mid);
        sentIds.push(mid);
      }
    };
    const run = (mode: SendMode) =>
      ctx.tracker ? ctx.tracker.track(recipientPsid, sendAll(mode)) : sendAll(mode)();
    try {
      try {
        await run("response");
      } catch (error) {
        // Nothing went out and the window has closed: a person may still reply.
        if (sentIds.length || !is24hWindowError(error) || messageType !== "HumanAgent") {
          throw error;
        }
        logger.info("Instagram window closed — resending a person's reply with the Human Agent tag", {
          messageId,
        });
        await run("human_agent");
      }
    } catch (error) {
      // Part of the message already reached the shopper: report, don't retry.
      if (sentIds.length) {
        logger.error("Instagram message only partly delivered", {
          messageId,
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(200).json({
          success: false,
          error: "partial_delivery",
          providerMessageId: sentIds[sentIds.length - 1],
        });
        return;
      }
      throw error;
    }
    const providerMessageId = sentIds[sentIds.length - 1];

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
