import type { Conversation } from "@server/database/entities/conversation.entity";
import { isOrganizationAiPaused } from "@server/types/organization-access.types";

/**
 * Why the AI may not speak in a conversation right now. The orchestrator reads
 * these once at the start of a run, but a run takes seconds (retrieval, LLM,
 * guardrail retries) and the owner can take over or pause the agent meanwhile,
 * so every AI-authored message re-reads them just before it is saved.
 */
export type AiReplyBlocker =
  | "conversation_missing"
  | "human_took_over"
  | "assigned_to_human"
  | "organization_suspended"
  | "organization_paused"
  | "agent_disabled";

type GuardedConversation = Pick<Conversation, "status" | "assigned_user_id"> & {
  deleted_at?: Date | null;
  agent?: { enabled: boolean } | null;
  organization?: {
    agentPausedAt?: Date | null;
    aiPausedAt?: Date | null;
    suspendedAt?: Date | null;
  } | null;
};

/** Pure check on an already loaded conversation (with agent and organization). */
export function getAiReplyBlocker(conversation: GuardedConversation | null): AiReplyBlocker | null {
  if (!conversation || conversation.deleted_at) return "conversation_missing";
  if (conversation.status === "human-took-over") return "human_took_over";
  if (conversation.assigned_user_id) return "assigned_to_human";
  if (conversation.organization?.suspendedAt) return "organization_suspended";
  if (isOrganizationAiPaused(conversation.organization)) return "organization_paused";
  if (conversation.agent && !conversation.agent.enabled) return "agent_disabled";
  return null;
}

/** Re-read the conversation and report whether the AI may still speak. */
export async function recheckAiReply(conversationId: string): Promise<AiReplyBlocker | null> {
  const { conversationRepository } = await import("@server/repositories/conversation.repository");
  return getAiReplyBlocker(await conversationRepository.findById(conversationId));
}

export function isPauseBlocker(
  blocker: AiReplyBlocker,
): blocker is "organization_paused" | "agent_disabled" {
  return blocker === "organization_paused" || blocker === "agent_disabled";
}

/** Thrown inside a run to abandon it without sending; not a processing failure. */
export class AiReplySuppressedError extends Error {
  constructor(readonly blocker: AiReplyBlocker) {
    super(`AI reply suppressed: ${blocker}`);
    this.name = "AiReplySuppressedError";
  }
}
