// How the message list is laid out: day dividers, agent join/leave notices and
// groups of consecutive messages from the same sender (one avatar, one name
// line and one time per group). Pure, so the grouping rules are unit tested.
import type { Message } from "@/types";
import { agentAvatarUrl, agentFirstName, agentSystemEvent } from "./agentNotice";

export type Author =
  { kind: "visitor" } | { kind: "ai" } | { kind: "human"; name: string; avatarUrl: string | null };

export type ThreadItem =
  | { type: "day"; key: string; timestamp: number }
  | { type: "notice"; key: string; message: Message }
  | { type: "group"; key: string; author: Author; messages: Message[] };

/** A longer pause than this between two messages from one sender starts a new group. */
const GROUP_GAP_MS = 10 * 60 * 1000;

function humanName(message: Message): string {
  return agentFirstName(message) ?? message.senderName?.trim().split(/\s+/)[0] ?? "";
}

export function authorOf(message: Message): Author {
  if (message.sender === "user") return { kind: "visitor" };
  if (message.agentType === "HumanAgent") {
    return { kind: "human", name: humanName(message), avatarUrl: agentAvatarUrl(message) };
  }
  return { kind: "ai" };
}

const authorKey = (author: Author) =>
  author.kind === "human" ? `human:${author.name}` : author.kind;

const dayOf = (timestamp: number) => new Date(timestamp).toDateString();

/** Something to show: text, files, products or a form (empty System lines are not). */
function hasContent(message: Message): boolean {
  return Boolean(
    message.content?.trim() ||
    message.attachments?.length ||
    message.metadata?.ui ||
    message.metadata?.productRecommendation,
  );
}

export function buildThread(messages: Message[]): ThreadItem[] {
  const items: ThreadItem[] = [];
  // A brand-new chat (only the greeting) gets no "Today" divider.
  const withDays = messages.some((message) => !message.isGreeting);
  let day: string | null = null;
  let group: Extract<ThreadItem, { type: "group" }> | null = null;
  let last: Message | null = null;

  for (const message of messages) {
    const isNotice = agentSystemEvent(message) !== null;
    if (!isNotice && !hasContent(message)) continue;

    if (withDays && dayOf(message.timestamp) !== day) {
      day = dayOf(message.timestamp);
      items.push({ type: "day", key: `day-${message.id}`, timestamp: message.timestamp });
      group = null;
    }

    if (isNotice) {
      items.push({ type: "notice", key: message.id, message });
      group = null;
    } else {
      const author = authorOf(message);
      const continues =
        group !== null &&
        last !== null &&
        authorKey(group.author) === authorKey(author) &&
        message.timestamp - last.timestamp <= GROUP_GAP_MS;
      if (continues && group) {
        group.messages.push(message);
      } else {
        group = { type: "group", key: `group-${message.id}`, author, messages: [message] };
        items.push(group);
      }
    }
    last = message;
  }
  return items;
}

/**
 * The person who has taken over the conversation, for the header and the
 * typing bubble: the latest team member reply or join event, while the
 * conversation is with a person. Null while the AI answers.
 */
export function currentHuman(
  messages: Message[],
  currentAgentType: string | undefined,
  currentAgentName: string | undefined,
): { name: string; avatarUrl: string | null } | null {
  if (currentAgentType !== "HumanAgent") return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    const event = agentSystemEvent(message);
    if (message.agentType === "HumanAgent" || event === "agent_joined") {
      const name = humanName(message);
      if (name) return { name, avatarUrl: agentAvatarUrl(message) };
    }
  }
  const name = currentAgentName?.trim().split(/\s+/)[0];
  return name ? { name, avatarUrl: null } : null;
}
