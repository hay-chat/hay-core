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
  /** A team member joined or left; the widget words it in the shopper's language. */
  systemEvent?: AgentSystemEvent;
  /** First name of the team member behind a HumanAgent message or a systemEvent. */
  agentFirstName?: string;
}

/**
 * System messages the shopper sees, as a centred line ("Marina joined the
 * chat"). Stored as System messages so the orchestrator never reads them as
 * customer input, and so channel delivery (WhatsApp, email...) skips them.
 * - agent_joined: a team member took over.
 * - agent_returned_to_ai: they handed the conversation back to the AI.
 * - agent_left: they released it to the queue (another person picks it up).
 */
export const AGENT_SYSTEM_EVENTS = ["agent_joined", "agent_returned_to_ai", "agent_left"] as const;
export type AgentSystemEvent = (typeof AGENT_SYSTEM_EVENTS)[number];

const isAgentSystemEvent = (value: unknown): value is AgentSystemEvent =>
  typeof value === "string" && (AGENT_SYSTEM_EVENTS as readonly string[]).includes(value);

const MAX_FIRST_NAME_LENGTH = 50;

/**
 * The only part of a team member's name a shopper may see: their first name,
 * or undefined when the profile has none (the widget then says "A team member").
 */
export function agentFirstName(user: { firstName?: string | null } | null | undefined) {
  const firstName = user?.firstName?.trim();
  return firstName ? firstName.slice(0, MAX_FIRST_NAME_LENGTH) : undefined;
}

/** Customer-facing message types the widget always receives. */
const WIDGET_MESSAGE_TYPES: string[] = [
  MessageType.CUSTOMER,
  MessageType.BOT_AGENT,
  MessageType.HUMAN_AGENT,
];

/**
 * Whether the widget may receive this message (before the deliveryState and
 * playground checks): customer-facing types, plus System messages that carry
 * an agent join/leave event. Every other System message stays internal.
 */
export function isWidgetVisibleMessage(type: unknown, metadata: unknown): boolean {
  if (typeof type !== "string") return false;
  if (WIDGET_MESSAGE_TYPES.includes(type)) return true;
  return (
    type === MessageType.SYSTEM &&
    !!metadata &&
    typeof metadata === "object" &&
    isAgentSystemEvent((metadata as Record<string, unknown>).systemEvent)
  );
}

/**
 * Stored System content is staff-facing ("Marina Souza took over this
 * conversation"); the widget renders agent events from metadata alone.
 */
const publicContent = <T>(type: unknown, content: T): T | "" =>
  type === MessageType.SYSTEM ? "" : content;

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

  if (isAgentSystemEvent(source.systemEvent)) {
    result.systemEvent = source.systemEvent;
  }

  const firstName = agentFirstName({
    firstName: typeof source.agentFirstName === "string" ? source.agentFirstName : undefined,
  });
  if (firstName) {
    result.agentFirstName = firstName;
  }

  return result;
}

/** A stored message as `publicConversations.getMessages` returns it. */
export function toPublicMessage(message: Message, options: { isPlayground: boolean }) {
  return {
    id: message.id,
    content: options.isPlayground ? message.content : publicContent(message.type, message.content),
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
      content: publicContent(message?.type, message?.content),
      type: message?.type,
      sender: message?.sender,
      timestamp: message?.timestamp,
      attachments: message?.attachments,
      metadata: toPublicMessageMetadata(message?.metadata),
    },
  };
}
