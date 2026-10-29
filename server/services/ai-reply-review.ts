import type { Conversation } from "@server/database/entities/conversation.entity";
import { resolveChannelAiMode } from "@server/types/organization-settings.types";

/**
 * True when AI replies on this conversation's channel are queued for a person
 * to approve: test mode (agent, else org default) or a "drafts only" channel.
 * Mirrors the gate in Conversation.addMessage. Needs `agent` and
 * `organization` loaded.
 */
export function aiRepliesHeldForReview(
  conversation: Pick<Conversation, "channel" | "agent" | "organization">,
): boolean {
  const settings = conversation.organization?.settings;
  if (resolveChannelAiMode(settings, conversation.channel) === "drafts") return true;
  const testMode = conversation.agent?.testMode;
  if (testMode !== null && testMode !== undefined) return testMode;
  return settings?.testModeDefault === true;
}
