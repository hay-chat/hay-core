import type { Message } from "@/types/message";

type AgentNoticeKey = "joined" | "returnedToAi" | "left";

const EVENT_KEYS: Record<string, AgentNoticeKey> = {
  agent_joined: "joined",
  agent_returned_to_ai: "returnedToAi",
  agent_left: "left",
};

/**
 * A takeover/release System message as a line ("Marina Souza joined the chat"):
 * the i18n key under `conversations.agentNotice` and the name to show (full
 * name for staff; null means "A team member"). Older rows only carry
 * isTakeoverMessage/isReleaseMessage.
 */
export function agentNotice(
  message: Pick<Message, "type" | "metadata">,
): { key: AgentNoticeKey; name: string | null } | null {
  const metadata = message.metadata;
  if (message.type !== "System" || !metadata) return null;

  let event: string | undefined = metadata.systemEvent;
  if (!event && metadata.isTakeoverMessage) event = "agent_joined";
  if (!event && metadata.isReleaseMessage) {
    event = metadata.returnToMode === "queue" ? "agent_left" : "agent_returned_to_ai";
  }
  const key = event ? EVENT_KEYS[event] : undefined;
  if (!key) return null;

  return { key, name: metadata.userName || metadata.agentFirstName || null };
}
