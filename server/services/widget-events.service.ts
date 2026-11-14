import { createLogger } from "@server/lib/logger";
import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType, type Message } from "@server/database/entities/message.entity";

const logger = createLogger("widget-events");

/**
 * Live events the webchat widget receives on its socket besides messages and
 * status changes. They go only to the widget clients identified into the
 * conversation (never to the dashboard), through the same Redis
 * "websocket:events" channel as the other conversation events.
 *
 * - message_ack: the server stored a visitor message ("received"), then
 *   whoever answers has it ("delivered": the AI run picked it up, or it waits
 *   in the team's inbox when no AI run follows).
 * - message_read: a person viewed the conversation in the inbox. The AI never
 *   sends it.
 * - agent_activity: the AI is running a tool (start) / finished it (end).
 */
export interface MessageAckEvent {
  type: "message_ack";
  messageId: string;
  /** The id the widget gave the message when it sent it, when it sent one. */
  clientMessageId?: string;
  status: "received" | "delivered";
}

export interface MessageReadEvent {
  type: "message_read";
  messageId: string;
  /** ISO timestamp. */
  readAt: string;
}

export interface AgentActivityEvent {
  type: "agent_activity";
  state: "start" | "end";
  toolName: string;
  label: string;
  doneLabel: string;
}

export type WidgetEvent = MessageAckEvent | MessageReadEvent | AgentActivityEvent;

export const WIDGET_EVENT_TYPES: readonly WidgetEvent["type"][] = [
  "message_ack",
  "message_read",
  "agent_activity",
];

const MAX_TEXT_LENGTH = 200;

/** Longest id the widget may give a message it sends. */
export const CLIENT_MESSAGE_ID_MAX_LENGTH = 64;

/** The widget's id for a message it sends, if it is a usable one. */
export function validClientMessageId(value: unknown): string | undefined {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= CLIENT_MESSAGE_ID_MAX_LENGTH
    ? value
    : undefined;
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.length <= MAX_TEXT_LENGTH ? value : null;

/**
 * Rebuild a widget event from a Redis payload, keeping only its known fields.
 * Returns null for anything that is not a well-formed widget event.
 */
export function toWidgetEvent(type: unknown, payload: unknown): WidgetEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  const messageId = text(data.messageId);
  if (type === "message_ack") {
    if (!messageId || (data.status !== "received" && data.status !== "delivered")) return null;
    const clientMessageId = text(data.clientMessageId);
    return {
      type,
      messageId,
      status: data.status,
      ...(clientMessageId ? { clientMessageId } : {}),
    };
  }
  if (type === "message_read") {
    const readAt = text(data.readAt);
    return messageId && readAt ? { type, messageId, readAt } : null;
  }
  if (type === "agent_activity") {
    const toolName = text(data.toolName);
    const label = text(data.label);
    const doneLabel = text(data.doneLabel);
    if ((data.state !== "start" && data.state !== "end") || !toolName || !label || !doneLabel) {
      return null;
    }
    return { type, state: data.state, toolName, label, doneLabel };
  }
  return null;
}

/**
 * Send an event to the widget clients of a web conversation. Best effort: a
 * lost event only costs the visitor a tick or a progress line.
 */
export async function publishWidgetEvent(
  conversation: Pick<Conversation, "id" | "organization_id" | "channel">,
  event: WidgetEvent,
): Promise<void> {
  if (conversation.channel !== "web") return;
  try {
    const { type, ...payload } = event;
    const { redisService } = await import("./redis.service");
    if (redisService.isConnected()) {
      await redisService.publish("websocket:events", {
        type,
        organizationId: conversation.organization_id,
        conversationId: conversation.id,
        payload,
      });
      return;
    }
    const { websocketService } = await import("./websocket.service");
    websocketService.sendToConversation(conversation.id, { ...event });
  } catch (error) {
    logger.warn(
      { err: error, conversationId: conversation.id, type: event.type },
      "Could not send widget event",
    );
  }
}

function ackEvent(
  message: Pick<Message, "id" | "metadata">,
  status: MessageAckEvent["status"],
): MessageAckEvent {
  const clientMessageId = text(message.metadata?.clientMessageId);
  return {
    type: "message_ack",
    messageId: message.id,
    status,
    ...(clientMessageId ? { clientMessageId } : {}),
  };
}

/**
 * A visitor message was stored. When no AI run follows (a person holds the
 * conversation, or it waits for the team), the inbox already has it: it is
 * delivered at once. Otherwise the AI run marks it delivered when it starts.
 */
export async function acknowledgeVisitorMessage(
  conversation: Pick<Conversation, "id" | "organization_id" | "channel" | "needs_processing">,
  message: Pick<Message, "id" | "metadata">,
): Promise<void> {
  await publishWidgetEvent(conversation, ackEvent(message, "received"));
  if (!conversation.needs_processing) {
    await publishWidgetEvent(conversation, ackEvent(message, "delivered"));
  }
}

/** The AI run picked up the visitor's latest message. */
export async function markVisitorMessageDelivered(
  conversation: Pick<Conversation, "id" | "organization_id" | "channel">,
  message: Pick<Message, "id" | "metadata"> | null,
): Promise<void> {
  if (!message) return;
  await publishWidgetEvent(conversation, ackEvent(message, "delivered"));
}

/**
 * A person viewed the conversation in the inbox: the visitor's latest message
 * is seen.
 */
export async function announceAgentRead(
  conversation: Pick<Conversation, "id" | "organization_id" | "channel">,
  messages: Pick<Message, "id" | "type" | "created_at">[],
  readAt: Date = new Date(),
): Promise<void> {
  if (conversation.channel !== "web") return;
  let latest: Pick<Message, "id" | "created_at"> | null = null;
  for (const message of messages) {
    if (message.type !== MessageType.CUSTOMER) continue;
    if (!latest || new Date(message.created_at) > new Date(latest.created_at)) latest = message;
  }
  if (!latest) return;
  await publishWidgetEvent(conversation, {
    type: "message_read",
    messageId: latest.id,
    readAt: readAt.toISOString(),
  });
}
