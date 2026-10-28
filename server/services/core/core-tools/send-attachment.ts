/**
 * `send_attachment` core tool (D8-17): the AI sends the shopper an image or a
 * PDF, e.g. a product photo or a return label.
 *
 * Only files a tool returned in this conversation can be sent (their URL must
 * appear in a tool result, such as recommend_products' imageUrl or a plugin's
 * label link). A URL the shopper typed is never fetched, so a shopper can't
 * make the merchant's account send arbitrary files.
 *
 * The file is downloaded (SSRF-checked, no redirects, size-capped), stored as
 * private conversation media (type checked by content) and sent as an AI
 * message, so test mode and drafts-only queue it like any AI reply and each
 * channel delivers it with its existing outbound code.
 */

import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType } from "@server/database/entities/message.entity";
import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { validateUrlForSSRF } from "@server/utils/ssrf";
import { recheckAiReply } from "@server/orchestrator/reply-guard";
import { CONVERSATION_MEDIA_FOLDER, storageService } from "@server/services/storage.service";
import { cleanFilename } from "@server/services/webchat/widget-attachments";
import type { CoreToolDefinition } from "./index";

const logger = createLogger("core-tool:send-attachment");

/** Types the AI may send: photos and PDFs. Storage re-checks the content. */
const AI_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
];

const DOWNLOAD_TIMEOUT_MS = 15_000;

type SendResult = { sent: true; name: string; type: string } | { sent: false; error: string };

/** True when `url` appears in a tool result of this conversation. */
function cameFromToolResult(
  messages: Awaited<ReturnType<Conversation["getMessages"]>>,
  url: string,
) {
  return messages.some(
    (message) =>
      message.type === MessageType.TOOL &&
      JSON.stringify(message.metadata?.toolOutput ?? null).includes(
        JSON.stringify(url).slice(1, -1),
      ),
  );
}

async function download(
  url: string,
  maxBytes: number,
): Promise<{ buffer: Buffer; mimeType: string }> {
  await validateUrlForSSRF(url);
  // No redirects: a redirect could point past the SSRF check.
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`download failed with status ${response.status}`);
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (declared > maxBytes) throw new Error("file too large");
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error("file too large");
  const mimeType = (response.headers.get("content-type") ?? "application/octet-stream")
    .split(";")[0]
    .trim()
    .toLowerCase();
  return { buffer, mimeType };
}

export const sendAttachmentTool: CoreToolDefinition = {
  name: "send_attachment",
  description:
    "Send the customer an image or PDF that a tool returned in this conversation, " +
    "e.g. a product photo from recommend_products or a return label link from a store tool. " +
    "The url MUST come from a tool result; never use a link the customer typed. " +
    "Use only when the file helps the customer; do not resend a file already sent.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["url"],
    properties: {
      url: { type: "string", description: "https URL of the file, copied from a tool result." },
      name: {
        type: "string",
        description: "File name shown to the customer, e.g. return-label.pdf.",
      },
      caption: {
        type: "string",
        description: "Short text sent with the file, in the customer's language.",
      },
    },
  },

  async execute(conversation, args): Promise<SendResult> {
    const url = typeof args.url === "string" ? args.url.trim() : "";
    const caption = typeof args.caption === "string" ? args.caption.trim().slice(0, 1000) : "";
    if (!/^https:\/\//i.test(url)) return { sent: false, error: "url must be an https link" };

    const messages = await conversation.getMessages();
    if (!cameFromToolResult(messages, url)) {
      return { sent: false, error: "url did not come from a tool result in this conversation" };
    }

    let stored: Awaited<ReturnType<typeof storageService.upload>>;
    try {
      const { buffer, mimeType } = await download(
        url,
        config.storage.limits.conversationMediaMaxFileSize,
      );
      if (!AI_ATTACHMENT_TYPES.includes(mimeType)) {
        return { sent: false, error: "only images and PDFs can be sent" };
      }
      const fallbackName = new URL(url).pathname.split("/").pop() ?? "";
      stored = await storageService.upload({
        buffer,
        originalName: cleanFilename(
          typeof args.name === "string" && args.name.trim() ? args.name : fallbackName,
          mimeType,
        ),
        mimeType,
        folder: CONVERSATION_MEDIA_FOLDER,
        organizationId: conversation.organization_id,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      logger.warn(
        { conversationId: conversation.id, reason },
        "send_attachment could not fetch the file",
      );
      return { sent: false, error: "the file could not be loaded" };
    }

    if (!AI_ATTACHMENT_TYPES.includes(stored.upload.mimeType)) {
      await storageService.delete(stored.upload.id).catch(() => undefined);
      return { sent: false, error: "only images and PDFs can be sent" };
    }

    // A person may have taken over (or the agent paused) while the file loaded.
    if (await recheckAiReply(conversation.id)) {
      await storageService.delete(stored.upload.id).catch(() => undefined);
      return { sent: false, error: "the AI may not reply in this conversation now" };
    }

    const attachment = {
      id: stored.upload.id,
      name: stored.upload.originalName,
      url: stored.url,
      type: stored.upload.mimeType,
      size: Number(stored.upload.size),
    };
    await conversation.addMessage({
      content: caption,
      type: MessageType.BOT_AGENT,
      attachments: [attachment],
      metadata: { sentByTool: "send_attachment" },
    });
    return { sent: true, name: attachment.name, type: attachment.type };
  },
};
