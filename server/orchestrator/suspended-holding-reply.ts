import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType } from "@server/database/entities/message.entity";
import { handoffCopy } from "./handoff-copy";

/**
 * While the organization is locked (billing or an admin, see
 * internal.organizations.setAccessState) the AI never answers. On external
 * channels (WhatsApp, Instagram, Messenger, email, ...) the shopper gets one
 * fixed "we've received it" line per conversation so they are not left in
 * silence (D15-4). The web widget shows nothing while locked, so "web" never
 * gets it. It goes out through the normal outbound path (channel delivery),
 * so no channel is named here. Returns whether the line was sent.
 */
export async function sendSuspendedHoldingReply(conversation: Conversation): Promise<boolean> {
  if (conversation.channel === "web") return false;

  const messages = await conversation.getMessages();
  if (!messages.some((message) => message.type === MessageType.CUSTOMER)) return false;
  if (messages.some((message) => message.metadata?.isSuspendedHoldingReply === true)) {
    return false;
  }

  await conversation.addMessage({
    content: handoffCopy(
      "suspendedHoldingReply",
      conversation.language,
      conversation.organization?.defaultLanguage,
    ),
    type: MessageType.BOT_AGENT,
    metadata: { isSuspendedHoldingReply: true },
  });
  return true;
}
