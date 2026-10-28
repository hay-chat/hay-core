import type { Message } from "@/types";
import type { TranslationKey } from "@/i18n";

/**
 * A team member joining or leaving arrives as a System message whose metadata
 * carries only `systemEvent` and `agentFirstName` (the server blanks its text).
 * The widget words it in the shopper's language.
 */
const EVENT_KEYS = {
  agent_joined: "chat.agentJoined",
  agent_left: "chat.agentLeft",
  agent_returned_to_ai: "chat.agentReturnedToAi",
} as const satisfies Record<string, TranslationKey>;

type AgentSystemEvent = keyof typeof EVENT_KEYS;

/** The team member's first name on a HumanAgent reply or an agent event. */
export function agentFirstName(message: Pick<Message, "metadata">): string | undefined {
  const name = message.metadata?.agentFirstName;
  return typeof name === "string" && name.trim() ? name.trim() : undefined;
}

export function agentSystemEvent(
  message: Pick<Message, "agentType" | "metadata">,
): AgentSystemEvent | null {
  if (message.agentType !== "System") return null;
  const event = message.metadata?.systemEvent;
  return typeof event === "string" && event in EVENT_KEYS ? (event as AgentSystemEvent) : null;
}

/** "Marina joined the chat", or null when the message is not an agent event. */
export function agentNoticeText(
  message: Pick<Message, "agentType" | "metadata">,
  t: (key: TranslationKey) => string,
): string | null {
  const event = agentSystemEvent(message);
  if (!event) return null;
  const name = agentFirstName(message) ?? t("chat.teamMember");
  return t(EVENT_KEYS[event]).replace("{name}", name);
}
