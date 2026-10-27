import {
  MessageDirection,
  MessageType,
  type Message,
} from "@server/database/entities/message.entity";

/**
 * What the public webchat API may reveal about a message.
 *
 * Message metadata is internal: the orchestrator stores reasoning, confidence
 * scores, documents used and the original low-confidence answer a fallback
 * replaced. Only the fields the widget renders leave the server, on both the
 * tRPC (`publicConversations.getMessages`) and WebSocket paths. Add a field
 * here only when the widget needs it and it is safe for a shopper to read.
 *
 * Playground conversations (staff demo mode) deliberately bypass this.
 */
export interface PublicMessageMetadata {
  isClosureMessage?: true;
  /** The conversation's opening greeting; replaces the widget's placeholder. */
  isGreeting?: true;
  productRecommendation?: { products: unknown[] };
}

export function toPublicMessageMetadata(metadata: unknown): PublicMessageMetadata {
  if (!metadata || typeof metadata !== "object") return {};
  const source = metadata as Record<string, unknown>;
  const result: PublicMessageMetadata = {};

  if (source.isClosureMessage === true) {
    result.isClosureMessage = true;
  }

  if (source.isGreeting === true) {
    result.isGreeting = true;
  }

  const recommendation = source.productRecommendation as { products?: unknown } | undefined;
  if (recommendation && Array.isArray(recommendation.products)) {
    result.productRecommendation = { products: recommendation.products };
  }

  return result;
}

/** A stored message as `publicConversations.getMessages` returns it. */
export function toPublicMessage(message: Message, options: { isPlayground: boolean }) {
  return {
    id: message.id,
    content: message.content,
    type: message.type,
    sender: message.sender,
    direction:
      message.direction ||
      (message.type === MessageType.CUSTOMER ? MessageDirection.IN : MessageDirection.OUT),
    createdAt: message.created_at,
    metadata: options.isPlayground ? message.metadata : toPublicMessageMetadata(message.metadata),
  };
}

/**
 * The WebSocket `message` event a webchat client receives: an explicit field
 * list, with metadata reduced to what the widget renders.
 */
export function toPublicMessageEvent(
  conversationId: string,
  message: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    type: "message",
    conversationId,
    data: {
      id: message?.id,
      content: message?.content,
      type: message?.type,
      sender: message?.sender,
      timestamp: message?.timestamp,
      attachments: message?.attachments,
      metadata: toPublicMessageMetadata(message?.metadata),
    },
  };
}
