// The home view's "Your conversations" (`publicConversations.listMine`). Loaded
// with the home view, never before: only returning visitors who allowed
// storage have anything to list.
import { createDPoPProof, listKeypairs } from "@/composables/useDPoP";
import { useConsent } from "@/composables/useConsent";
import { agentFirstName, agentSystemEvent } from "@/utils/agentNotice";
import type { HayChatConfig, Message, VisitorConversation } from "@/types";

/** The server checks at most this many proofs. */
const MAX_PROOFS = 20;

/**
 * The visitor's conversations, newest first: those whose key this browser
 * holds, plus the signed-in customer's. Empty before consent (the keys sit
 * behind it) and on any failure: the list is a convenience, never a blocker.
 */
export async function listMyConversations(config: HayChatConfig): Promise<VisitorConversation[]> {
  if (!useConsent().canUseLocal.value) return [];
  try {
    const url = `${config.baseUrl}/v1/publicConversations.listMine`;
    const keys = (await listKeypairs())
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, MAX_PROOFS);
    const signedIn = Boolean(config.customerExternalId && config.customerExternalIdSignature);
    if (keys.length === 0 && !signedIn) return [];

    // No nonce: listing is read-only and must not spend the conversations' nonces.
    const conversations = await Promise.all(
      keys.map(async (key) => ({
        conversationId: key.conversationId,
        proof: await createDPoPProof("POST", url, key.privateKey, key.publicJwk),
      })),
    );
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId: config.organizationId,
        conversations,
        ...(signedIn
          ? {
              customerExternalId: config.customerExternalId,
              customerExternalIdSignature: config.customerExternalIdSignature,
            }
          : {}),
      }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.result?.data) ? data.result.data : [];
  } catch (error) {
    console.warn("[Hay Webchat] Could not list your conversations:", error);
    return [];
  }
}

/**
 * The conversation open in this tab as a row of the list, from what is on
 * screen (fresher than the server's, and listed even before consent). Null
 * until something was said.
 */
export function summarizeThread(
  thread: { id: string; messages: Message[]; closed: boolean },
  assistantName: string,
): VisitorConversation | null {
  const shown = thread.messages.filter(
    (m) => !m.isGreeting && !agentSystemEvent(m) && (m.content?.trim() || m.attachments?.length),
  );
  const last = shown[shown.length - 1];
  if (!last) return null;
  const sender =
    last.sender === "user"
      ? null
      : last.agentType === "HumanAgent"
        ? (agentFirstName(last) ?? last.senderName?.split(" ")[0] ?? null)
        : assistantName;
  return {
    id: thread.id,
    status: thread.closed ? "closed" : "open",
    lastMessagePreview: (last.content ?? "").replace(/\s+/g, " ").trim(),
    lastMessageAt: new Date(last.timestamp).toISOString(),
    lastSenderName: sender,
    resumable: true,
  };
}

/**
 * What the home view lists: open conversations first, then ended ones, newest
 * first within each, at most `max`.
 */
export function homeConversations(
  conversations: VisitorConversation[],
  max = 3,
): VisitorConversation[] {
  const byNewest = (a: VisitorConversation, b: VisitorConversation) =>
    b.lastMessageAt.localeCompare(a.lastMessageAt);
  return [
    ...conversations.filter((c) => c.status === "open").sort(byNewest),
    ...conversations.filter((c) => c.status === "closed").sort(byNewest),
  ].slice(0, max);
}
