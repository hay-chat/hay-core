// The dashboard's live preview (contract C4): sample content for each state,
// and a chat that never calls the server, stores anything or opens a socket.
// Its own chunk, loaded only when `config.preview` is set.
import { computed, ref } from "vue";
import type { WidgetChat } from "./composables/useChat";
import type { WidgetAvailability } from "./utils/availability";
import type { FormSchema } from "@hay/form-schema";
import type {
  AgentActivity,
  Message,
  PreviewOptions,
  SendFailure,
  VisitorConversation,
} from "./types";

const MINUTE = 60_000;
const PERSON = "Marina";

/** "Typically replies in ~2 min", with the green dot. */
export const PREVIEW_AVAILABILITY: WidgetAvailability = {
  state: "open",
  nextOpening: null,
  timezone: "UTC",
  hasSchedule: false,
  typicalReplyMinutes: 2,
};

/** A returning visitor's list on the home view. */
export function previewConversations(assistantName: string): VisitorConversation[] {
  const now = Date.now();
  return [
    {
      id: "preview-open",
      status: "open",
      lastMessagePreview: "DHL has the new address. Anything else?",
      lastMessageAt: new Date(now - 30 * MINUTE).toISOString(),
      lastSenderName: PERSON,
      resumable: true,
    },
    {
      id: "preview-ended",
      status: "closed",
      lastMessagePreview: "Your refund is on its way to your card.",
      lastMessageAt: new Date(now - 9 * 24 * 60 * MINUTE).toISOString(),
      lastSenderName: assistantName,
      resumable: true,
    },
  ];
}

/** A short AI exchange with sources, then a person takes over (and, ended, wraps up). */
function sampleThread(ended: boolean): { messages: Message[]; seenId: string } {
  const start = Date.now() - 12 * MINUTE;
  const at = (minutes: number) => start + minutes * MINUTE;
  const human = (id: string, content: string, minutes: number): Message => ({
    id,
    sender: "agent",
    agentType: "HumanAgent",
    senderName: PERSON,
    content,
    timestamp: at(minutes),
    metadata: { agentFirstName: PERSON },
  });
  const visitor = (id: string, content: string, minutes: number): Message => ({
    id,
    sender: "user",
    content,
    timestamp: at(minutes),
    metadata: { delivery: "delivered" },
  });
  const ai = (id: string, content: string, minutes: number, extra = {}): Message => ({
    id,
    sender: "agent",
    agentType: "BotAgent",
    content,
    timestamp: at(minutes),
    ...extra,
  });

  const messages: Message[] = [
    visitor("v1", "Where's my order #1043? It was meant to arrive yesterday.", 0),
    ai(
      "a1",
      "I found it. Order **#1043** shipped on 8 Nov with DHL and is out for delivery today, before 6pm.",
      1,
      {
        metadata: {
          sources: [
            { title: "Delivery times", url: "https://example.com/help/delivery" },
            { title: "Tracking your order", url: "https://example.com/help/tracking" },
          ],
        },
      },
    ),
    visitor("v2", "Can I still change the delivery address?", 2),
    ai(
      "a2",
      "The courier already has it, so I can't change the address myself. I've asked the team to step in.",
      3,
    ),
    {
      id: "join",
      sender: "agent",
      agentType: "System",
      content: "",
      timestamp: at(5),
      metadata: { systemEvent: "agent_joined", agentFirstName: PERSON },
    },
    human("h1", "Hi, Marina here. I can ask DHL to redirect it. What's the new address?", 5),
    visitor("v3", "12 Harbour Street, Dublin 2", 6),
  ];
  if (ended) {
    messages.push(
      human("h2", "All done. DHL has the new address and it'll arrive tomorrow.", 8),
      human("h3", "Anything else I can help with?", 8),
    );
  }
  return { messages, seenId: "v3" };
}

/**
 * A chat on sample content. Sending, rating and the end card work on screen
 * only: nothing leaves the page.
 */
export function createPreviewChat(options: PreviewOptions): WidgetChat {
  const ended = options.state === "ended";
  const thread = sampleThread(ended);
  // "closed" shows the button (and the teaser); clicking it opens the chat.
  const isOpen = ref(options.state !== "closed");
  const csatSubmitted = ref(false);
  const ratings = ref<Record<string, "up" | "down">>({});
  const done = async () => true;
  const nothing = () => {};

  return {
    isOpen,
    isInitialized: ref(true),
    conversationId: ref<string | null>("preview"),
    messages: ref(thread.messages),
    isTyping: ref(false),
    unreadCount: computed(() => 0),
    isConversationClosed: ref(ended),
    csatSubmitted,
    currentAgentType: ref<"BotAgent" | "HumanAgent">("HumanAgent"),
    currentAgentName: ref<string | null>(PERSON),
    conversationStatus: ref<string | null>(ended ? "resolved" : "human-took-over"),
    contactEmailSaved: ref(false),
    sendFailure: ref<SendFailure | null>(null),
    challengeHost: ref<HTMLElement | null>(null),
    isChallengeInteractive: ref(false),
    pendingPreChatForm: computed(() => false),
    preChatFormSchema: ref<FormSchema | null>(null),
    activity: ref<AgentActivity | null>(null),
    doneLabels: ref<Record<string, string>>({ a1: "Checked order #1043" }),
    ratings,
    readMessageId: ref<string | null>(thread.seenId),
    toggleChat: () => {
      isOpen.value = !isOpen.value;
    },
    openChat: () => {
      isOpen.value = true;
    },
    closeChat: () => {
      isOpen.value = false;
    },
    sendMessage: async () => {},
    sendAttachment: async () => {},
    submitCsat: async () => {
      csatSubmitted.value = true;
      return true;
    },
    startTyping: nothing,
    stopTyping: nothing,
    startNewConversation: nothing,
    resumeActiveConversation: nothing,
    saveContactEmail: async () => false,
    submitPreChatForm: done,
    submitInConversationForm: done,
    rateMessage: async (messageId: string, rating: "up" | "down") => {
      ratings.value = { ...ratings.value, [messageId]: rating };
      return true;
    },
    openConversation: done,
  };
}
