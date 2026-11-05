import { computed, onBeforeUnmount, ref } from "vue";
import { Hay } from "@/utils/api";
import { MessageStatus, MessageType, type Message } from "@/types/message";
import type { RouterOutputs } from "@/types/trpc";
import { useWebSocket } from "@/composables/useWebSocket";

type SetupSource = RouterOutputs["setup"]["get"]["rows"][number]["sources"][number];
type ServerMessage = NonNullable<RouterOutputs["conversations"]["get"]["messages"]>[number];

/** Shown in the test chat: customer questions and the assistant's replies. */
const VISIBLE_TYPES: string[] = [
  MessageType.CUSTOMER,
  MessageType.BOT_AGENT,
  MessageType.HUMAN_AGENT,
];

const POLL_MS = 4000;
const REPLY_TIMEOUT_MS = 90_000;

export type SetupChatError = "start" | "reply" | null;

interface WsMessagePayload {
  conversationId?: string;
  data?: {
    id: string;
    content: string;
    type: string;
    timestamp?: string;
    metadata?: Message["metadata"];
    status?: string;
  };
}

interface WsStatusPayload {
  conversationId?: string;
  processingPhase?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * The setup page's test chat. It runs the real pipeline in a dry-run playground
 * conversation (nothing reaches customers) and receives replies the way the
 * playground page does: a conversation-scoped WebSocket `message` event, with a
 * slow `conversations.get` poll as the fallback if the socket missed it.
 */
export function useSetupTestChat() {
  const websocket = useWebSocket();

  const messages = ref<Message[]>([]);
  const sourcesByMessage = ref<Record<string, SetupSource[]>>({});
  const conversationId = ref<string | null>(null);
  const sending = ref(false);
  const awaitingReply = ref(false);
  const typing = ref(false);
  const error = ref<SetupChatError>(null);

  let pendingSources: SetupSource[] = [];
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let replyDeadline: ReturnType<typeof setTimeout> | null = null;
  let lastQuestion = "";
  let stopped = false;
  const unsubscribers: Array<() => void> = [];

  const toMessage = (
    id: string,
    content: string,
    type: string,
    createdAt: Date,
    metadata: Message["metadata"],
    status?: string,
  ): Message => ({
    id,
    conversation_id: conversationId.value ?? "",
    content,
    type: type as MessageType,
    created_at: createdAt,
    updated_at: createdAt,
    status: (status as MessageStatus | undefined) ?? MessageStatus.APPROVED,
    metadata,
    deliveryState: "sent",
  });

  const clearTimers = () => {
    if (pollTimer) clearTimeout(pollTimer);
    if (replyDeadline) clearTimeout(replyDeadline);
    pollTimer = null;
    replyDeadline = null;
  };

  const finishWaiting = () => {
    awaitingReply.value = false;
    typing.value = false;
    clearTimers();
  };

  /** Add or update one message; a bot reply ends the wait and takes the question's sources. */
  const upsert = (incoming: Message) => {
    if (!VISIBLE_TYPES.includes(incoming.type)) return;

    const optimistic =
      incoming.type === MessageType.CUSTOMER
        ? messages.value.findIndex(
            (m) =>
              m.deliveryState === "pending" &&
              m.type === MessageType.CUSTOMER &&
              m.content === incoming.content,
          )
        : -1;
    const existing =
      optimistic !== -1 ? optimistic : messages.value.findIndex((m) => m.id === incoming.id);

    if (existing !== -1) messages.value[existing] = incoming;
    else messages.value.push(incoming);

    if (incoming.type !== MessageType.CUSTOMER && awaitingReply.value) {
      if (pendingSources.length) sourcesByMessage.value[incoming.id] = pendingSources;
      pendingSources = [];
      finishWaiting();
    }
  };

  const reconcile = async () => {
    if (!conversationId.value) return;
    try {
      const result = await Hay.conversations.get.query({ id: conversationId.value });
      if (stopped) return;
      for (const m of result.messages ?? []) upsertServerMessage(m);
    } catch {
      // The next poll tick tries again; the reply deadline reports a lasting failure.
    }
  };

  // The poll only needs what the chat shows: the text and the documents the reply drew on.
  const upsertServerMessage = (m: ServerMessage) =>
    upsert(
      toMessage(
        m.id,
        m.content,
        m.type,
        new Date(m.created_at),
        m.metadata?.documentsUsed ? { documentsUsed: m.metadata.documentsUsed } : undefined,
        m.status,
      ),
    );

  const schedulePoll = () => {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      await reconcile();
      if (!stopped && awaitingReply.value) schedulePoll();
    }, POLL_MS);
  };

  const startWaiting = () => {
    awaitingReply.value = true;
    typing.value = true;
    error.value = null;
    schedulePoll();
    replyDeadline = setTimeout(() => {
      if (!awaitingReply.value) return;
      finishWaiting();
      error.value = "reply";
    }, REPLY_TIMEOUT_MS);
  };

  const listen = (id: string) => {
    websocket.connect();
    websocket.send({ type: "subscribe", conversationId: id });

    unsubscribers.push(
      websocket.on("message", (payload: unknown) => {
        const body = payload as WsMessagePayload;
        if (!isRecord(payload) || body.conversationId !== id || !body.data) return;
        const { data } = body;
        upsert(
          toMessage(
            data.id,
            data.content,
            data.type,
            data.timestamp ? new Date(data.timestamp) : new Date(),
            data.metadata,
            data.status,
          ),
        );
      }),
      websocket.on("conversation_status_changed", (payload: unknown) => {
        const body = payload as WsStatusPayload;
        if (!isRecord(payload) || body.conversationId !== id || !body.processingPhase) return;
        if (!awaitingReply.value) return;
        typing.value = body.processingPhase !== "idle";
        if (body.processingPhase === "idle") void reconcile();
      }),
    );
  };

  const ensureConversation = async (): Promise<string | null> => {
    if (conversationId.value) return conversationId.value;
    try {
      const created = await Hay.conversations.create.mutate({
        metadata: { sourceId: "playground", dryRun: true },
        status: "open",
      });
      conversationId.value = created.id;
      listen(created.id);
      return created.id;
    } catch {
      error.value = "start";
      return null;
    }
  };

  /** Ask one question. `sources` are shown under the reply that answers it. */
  const send = async (text: string, sources: SetupSource[] = []): Promise<void> => {
    const content = text.trim();
    if (!content || sending.value || awaitingReply.value) return;

    sending.value = true;
    error.value = null;
    lastQuestion = content;
    try {
      const id = await ensureConversation();
      if (!id) return;

      const tempId = `temp-${Date.now()}`;
      const optimistic = toMessage(tempId, content, MessageType.CUSTOMER, new Date(), undefined);
      optimistic.deliveryState = "pending";
      messages.value.push(optimistic);
      pendingSources = sources;

      try {
        const result = await Hay.conversations.sendMessage.mutate({
          conversationId: id,
          content,
          role: "user",
        });
        const index = messages.value.findIndex((m) => m.id === tempId);
        if (index !== -1) {
          messages.value[index] = {
            ...messages.value[index],
            id: result.id,
            deliveryState: "sent",
          };
        }
        startWaiting();
      } catch {
        const index = messages.value.findIndex((m) => m.id === tempId);
        if (index !== -1) {
          messages.value[index] = { ...messages.value[index], deliveryState: "failed" };
        }
        pendingSources = [];
      }
    } finally {
      sending.value = false;
    }
  };

  /** Resend a message that failed, or ask the last question again after a missing reply. */
  const retry = async (messageId?: string) => {
    const failed = messageId ? messages.value.find((m) => m.id === messageId) : undefined;
    const text = failed?.content ?? lastQuestion;
    if (failed) messages.value = messages.value.filter((m) => m.id !== failed.id);
    error.value = null;
    await send(text);
  };

  /** Every message the pipeline produced, plus the sources of the question that prompted it. */
  const entries = computed(() =>
    messages.value.map((message) => ({
      message,
      sources: sourcesByMessage.value[message.id] ?? [],
    })),
  );

  const dispose = () => {
    stopped = true;
    clearTimers();
    unsubscribers.splice(0).forEach((off) => off());
    // Playground conversations are throwaway: close so they don't linger as open.
    if (conversationId.value) {
      void Hay.conversations.update
        .mutate({ id: conversationId.value, data: { status: "closed" } })
        .catch(() => {});
    }
  };

  onBeforeUnmount(dispose);

  return { entries, sending, awaitingReply, typing, error, send, retry };
}
