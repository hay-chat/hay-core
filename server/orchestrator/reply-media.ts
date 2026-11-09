import type pino from "pino";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { type Message, MessageType } from "@server/database/entities/message.entity";
import {
  hasLinksOrImages,
  sanitizeOutboundReply,
} from "@server/services/core/link-guardrail.service";
import { handoffCopy } from "./handoff-copy";

/** A message's URL-bearing text. Metadata carries tool outputs. */
export function messageLinkText(message: Pick<Message, "content" | "metadata">): string {
  return `${message.content ?? ""}\n${JSON.stringify(message.metadata ?? {})}`;
}

/** Tool results recorded since the customer's latest message. */
function toolResultsThisTurn(messages: Message[]): string[] {
  const lastCustomer = messages.map((message) => message.type).lastIndexOf(MessageType.CUSTOMER);
  return messages
    .slice(lastCustomer + 1)
    .filter((message) => message.type === MessageType.TOOL)
    .map(messageLinkText);
}

export interface BotMessagePayload {
  content: string;
  type: string;
  metadata?: Record<string, unknown>;
  sender?: string;
}

/**
 * Applies the outbound image and link policy to an AI reply and records the
 * images clients may load. If the context can't be read, every image and
 * unverified link goes: the reply still sends, without them.
 */
export async function checkReplyMedia(
  conversation: Conversation,
  payload: BotMessagePayload,
  log: pino.Logger,
): Promise<BotMessagePayload> {
  if (payload.type !== MessageType.BOT_AGENT || !hasLinksOrImages(payload.content)) {
    return payload;
  }

  let contextTexts: string[] = [];
  let toolResultTexts: string[] = [];
  let website: string | null = null;
  let siteUrls: string[] = [];
  try {
    const messages = await conversation.getMessages();
    contextTexts = messages.map(messageLinkText);
    toolResultTexts = toolResultsThisTurn(messages);
    const { siteIndexService } = await import("@server/services/site-index.service");
    [website, siteUrls] = await Promise.all([
      siteIndexService.resolveWebsite(conversation.organization_id),
      siteIndexService.listUrls(conversation.organization_id),
    ]);
  } catch (error) {
    log.warn({ err: error }, "Could not read the reply's context; removing unverified media");
  }

  const checked = sanitizeOutboundReply({
    response: payload.content,
    contextTexts,
    toolResultTexts,
    siteUrls,
    website,
  });
  if (checked.removedImages.length > 0 || checked.removedLinks.length > 0) {
    log.warn(
      { removedImages: checked.removedImages.length, removedLinks: checked.removedLinks.length },
      "Removed unverified images or links from a reply",
    );
  }

  return {
    ...payload,
    content: checked.text || handoffCopy("planningFallback", conversation.language),
    metadata: {
      ...payload.metadata,
      ...(checked.approvedImages.length > 0 ? { approvedImages: checked.approvedImages } : {}),
    },
  };
}
