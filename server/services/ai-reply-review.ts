import type { Conversation } from "@server/database/entities/conversation.entity";
import { resolveChannelAiMode } from "@server/types/organization-settings.types";

/**
 * True when AI replies on this conversation's channel are queued for a person
 * to approve: the organization's test mode or a "drafts only" channel.
 * Mirrors the gate in Conversation.addMessage. Needs `organization` loaded.
 */
export function aiRepliesHeldForReview(
  conversation: Pick<Conversation, "channel" | "organization">,
): boolean {
  const settings = conversation.organization?.settings;
  if (resolveChannelAiMode(settings, conversation.channel) === "drafts") return true;
  return settings?.testModeDefault === true;
}
