import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType, type Message } from "@server/database/entities/message.entity";
import { toPublicMessageMetadata } from "@server/services/webchat/public-message";

/** The most conversations `publicConversations.listMine` returns. */
export const LIST_MINE_LIMIT = 20;

const PREVIEW_LENGTH = 140;

const ENDED_STATUSES: ReadonlyArray<Conversation["status"]> = ["closed", "resolved", "unresolved"];

/** One row of the widget's "Your conversations" list. */
export interface VisitorConversationSummary {
  id: string;
  status: "open" | "closed";
  /** The latest message the widget shows, as one short plain line. */
  lastMessagePreview: string;
  /** ISO time of that message. */
  lastMessageAt: string;
  /** The assistant's name, or a team member's first name; null for the visitor's own message. */
  lastSenderName: string | null;
  /** This browser proved it holds the conversation's key, so the widget can open it. */
  resumable: boolean;
}

function preview(message: Message): string {
  if (toPublicMessageMetadata(message.metadata).mediaPlaceholder) return "";
  const line = (message.content ?? "").replace(/\s+/g, " ").trim();
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1)}…` : line;
}

function senderName(message: Message, assistantName: string | null): string | null {
  if (message.type === MessageType.BOT_AGENT) return assistantName;
  if (message.type === MessageType.HUMAN_AGENT) {
    return toPublicMessageMetadata(message.metadata).agentFirstName ?? null;
  }
  return null;
}

/**
 * A visitor's conversations as the widget lists them, in the given order.
 * Conversations with no message the widget shows are left out.
 */
export function toVisitorConversationSummaries(
  conversations: Conversation[],
  lastMessages: Map<string, Message>,
  options: { assistantName: string | null; resumableIds: Set<string> },
): VisitorConversationSummary[] {
  return conversations.flatMap((conversation) => {
    const last = lastMessages.get(conversation.id);
    if (!last) return [];
    return [
      {
        id: conversation.id,
        status: ENDED_STATUSES.includes(conversation.status) ? "closed" : "open",
        lastMessagePreview: preview(last),
        lastMessageAt: new Date(last.created_at).toISOString(),
        lastSenderName: senderName(last, options.assistantName),
        resumable: options.resumableIds.has(conversation.id),
      },
    ];
  });
}
