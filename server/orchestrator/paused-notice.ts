import type { Conversation } from "@server/database/entities/conversation.entity";
import { MessageType } from "@server/database/entities/message.entity";
import { handoffCopy } from "./handoff-copy";

/**
 * While the AI is paused (the owner's "Pause AI everywhere", the operator's
 * pause, or the agent switched off) the shopper gets one short line saying
 * the team will reply here, once per conversation (D11-9). Fixed copy, never
 * LLM-written. Returns whether the line was sent.
 */
export async function sendPausedNotice(conversation: Conversation): Promise<boolean> {
  const messages = await conversation.getMessages();
  if (messages.some((message) => message.metadata?.isPausedNotice === true)) return false;

  await conversation.addMessage({
    content: handoffCopy(
      "pausedTeamWillReply",
      conversation.language,
      conversation.organization?.defaultLanguage,
    ),
    type: MessageType.BOT_AGENT,
    metadata: { isPausedNotice: true },
  });
  return true;
}
