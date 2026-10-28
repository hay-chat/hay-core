import type { Request, Response } from "express";
import type { HayLogger } from "@hay/plugin-sdk/types";
import type { GraphClient, MessengerAttachmentType, SendMode } from "./graph-client.js";
import { GraphApiError, splitText } from "./graph-client.js";
import type { SentMessageTracker } from "./echo.js";
import { parseAddress, type PageRegistry } from "./pages.js";

export interface DeliverContext {
  getGraphClient: () => GraphClient | null;
  pages: PageRegistry;
  logger: HayLogger;
  /** Remembers the mids sent here so their echoes are not mistaken for the owner's. */
  tracker?: SentMessageTracker;
}

interface DeliverPayload {
  to: string;
  content: string;
  messageId: string;
  /** Who wrote it; "HumanAgent" may use Meta's Human Agent tag after 24 hours. */
  messageType?: string;
  conversationId: string;
  attachments?: Array<{ name?: string; url?: string; type?: string }> | null;
}

/** Messenger's attachment type for a MIME type, or null when Messenger can't send it. */
export function messengerAttachmentType(mimeType: string): MessengerAttachmentType | null {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "application/pdf") return "file";
  return null;
}

/**
 * Meta's "sent outside the allowed window" error: code 10 / subcode 2018278 on
 * Messenger (2534022 on Instagram), matched defensively.
 */
export function isWindowError(error: unknown): boolean {
  if (!(error instanceof GraphApiError)) return false;
  if (error.subcode === 2018278 || error.subcode === 2534022) return true;
  return error.code === 10 && /24|outside.*window|allowed window/i.test(error.message);
}

/**
 * Outbound delivery, called by core's ChannelDeliveryService.
 *
 *   1. Each file is its own message, then the text (split at 2000 characters).
 *   2. Sent as a RESPONSE. When Meta refuses because the 24-hour window has
 *      closed and a PERSON wrote the reply, the whole message is sent again
 *      with the HUMAN_AGENT tag (allowed up to 7 days). The AI never uses it.
 *   3. Returns { success:true, providerMessageId } with the last Meta mid.
 *
 * Errors: window closed → 200 { success:false, error:"24h_window_expired" };
 * other Graph 4xx → 200 { error:"graph_<status>" }; a failure after part of
 * the message went out → 200 { error:"partial_delivery" }; network/5xx → 500.
 */
export async function deliverHandler(
  req: Request,
  res: Response,
  ctx: DeliverContext,
): Promise<void> {
  const { logger } = ctx;
  const { to, content, messageId, messageType, conversationId, attachments } = (req.body ??
    {}) as DeliverPayload;

  try {
    const graphClient = ctx.getGraphClient();
    if (!graphClient) {
      logger.error("Deliver called but Messenger is not connected");
      res.status(503).json({ success: false, error: "Plugin not fully configured" });
      return;
    }

    const files = (Array.isArray(attachments) ? attachments : []).flatMap((file) => {
      const type = messengerAttachmentType(file?.type ?? "");
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

    const address = parseAddress(to);
    if (!address) {
      res.status(200).json({ success: false, error: "invalid_recipient" });
      return;
    }
    const page = await ctx.pages.get(address.pageId);
    if (!page) {
      logger.warn("Messenger Page is no longer connected", { pageId: address.pageId });
      res.status(200).json({ success: false, error: "page_not_connected" });
      return;
    }

    logger.info("Delivering Messenger message", {
      conversationId,
      messageId,
      messageType,
      contentLength: content?.length ?? 0,
      attachmentCount: files.length,
      unsendableAttachments: unsendable,
    });

    const sentIds: string[] = [];
    const sendAll = (mode: SendMode) => async () => {
      for (const file of files) {
        const mid = await graphClient.sendAttachment(address.psid, file, page.accessToken, mode);
        ctx.tracker?.remember(mid);
        sentIds.push(mid);
      }
      for (const chunk of content ? splitText(content) : []) {
        const mid = await graphClient.sendText(address.psid, chunk, page.accessToken, mode);
        ctx.tracker?.remember(mid);
        sentIds.push(mid);
      }
    };
    const run = (mode: SendMode) =>
      ctx.tracker ? ctx.tracker.track(address.psid, sendAll(mode)) : sendAll(mode)();

    try {
      try {
        await run("response");
      } catch (error) {
        // Nothing went out and the window has closed: a person may still reply.
        if (sentIds.length || !isWindowError(error) || messageType !== "HumanAgent") throw error;
        logger.info(
          "Messenger window closed — resending a person's reply with the Human Agent tag",
          {
            messageId,
          },
        );
        await run("human_agent");
      }
    } catch (error) {
      if (sentIds.length) {
        logger.error("Messenger message only partly delivered", {
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
    logger.info("Messenger message delivered", { providerMessageId, messageId });
    res.status(200).json({ success: true, providerMessageId });
  } catch (error: unknown) {
    if (error instanceof GraphApiError) {
      if (isWindowError(error)) {
        logger.warn("Messenger messaging window closed", {
          messageId,
          messageType,
          code: error.code,
          subcode: error.subcode,
        });
        res.status(200).json({ success: false, error: "24h_window_expired" });
        return;
      }
      if (error.status >= 400 && error.status < 500) {
        logger.error("Messenger Graph API refused the message", {
          status: error.status,
          code: error.code,
          subcode: error.subcode,
          message: error.message,
          messageId,
        });
        res.status(200).json({ success: false, error: `graph_${error.status}` });
        return;
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to deliver Messenger message", { error: message, messageId });
    res.status(500).json({ success: false, error: message });
  }
}
