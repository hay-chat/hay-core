import { ref, shallowRef, computed, watch } from "vue";
import { useWebSocket } from "./useWebSocket";
import { useConversation, WidgetRequestError } from "./useConversation";
import { useMessageQueue } from "./useMessageQueue";
import { initContext, getContext } from "./useWidgetContext";
import {
  generateKeypair,
  storeKeypair,
  getKeypair,
  createDPoPProof,
  clearKeypair,
} from "./useDPoP";
import { safeStorage, useConsent } from "./useConsent";
import { debugLog } from "@/utils/debug";
import { resumeConversationId } from "@/utils/resume";
import type { HayChatConfig, Message, SendFailure, WidgetContribution } from "@/types";
import { useChallenge } from "./useChallenge";
import { insertMessage, parseServerTime } from "@/utils/messageOrder";
import {
  WIDGET_ATTACHMENT_MAX_BYTES,
  isAcceptedAttachmentType,
  readFileAsBase64,
} from "@/utils/attachments";

import type { FormResponse, FormSchema } from "@hay/form-schema";
import { findMissingRequiredFields } from "@hay/form-schema";

export interface UseChatOptions {
  /** The org's challenge@1 contribution, when a bot check is on. */
  challenge?: WidgetContribution | null;
  /** The org's pre-chat form, asked before the first message when set. */
  preChatForm?: FormSchema | null;
}

interface Keypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export function useChat(config: HayChatConfig, options: UseChatOptions = {}) {
  const { canUseSession, canUseLocal, markInteraction } = useConsent();
  // Bot check (challenge@1 contribution), run right before the conversation is
  // created, i.e. after the shopper sends their first message.
  const challenge = useChallenge(config);

  const isOpen = ref(false);
  const isInitialized = ref(false);
  const customerId = ref<string>("");
  // shallowRef: a deep ref wraps the CryptoKeys in reactive proxies, which
  // IndexedDB cannot clone (DataCloneError when persisting after consent).
  const keypair = shallowRef<Keypair | null>(null);
  const nonce = ref<string>("");
  const isConversationClosed = ref(false);
  const isSending = ref(false);
  // Set when the server refuses the shopper's message (rate limited, website
  // not allowed, too long). The UI shows a short notice and restores the text.
  const sendFailure = ref<SendFailure | null>(null);
  // Why the last createNewConversation() failed, so sendMessage can tell a
  // refusal from a network blip.
  let lastCreateError: unknown = null;
  // These start as null and are populated inside initialize() via safeStorage.
  // This matters because consent state may change between useChat() being
  // called (at widget mount) and initialize() running (on first open), e.g.
  // when the host site calls grantConsent() from its cookie banner.
  const lastReadMessageId = ref<string | null>(null);
  const currentAgentType = ref<"BotAgent" | "HumanAgent">("BotAgent");
  const currentAgentName = ref<string | null>(null);
  // Server status of the conversation ("pending-human" while it waits for a person).
  const conversationStatus = ref<string | null>(null);
  const contactEmailSaved = ref(false);

  // Pre-chat form (from the public config): shown instead of the input until
  // the shopper fills it, unless the host context already carries every
  // required field. The response rides along with conversation creation.
  const preChatFormSchema = ref<FormSchema | null>(options.preChatForm ?? null);
  const preChatFormResponse = ref<FormResponse | null>(null);
  const pendingPreChatForm = computed(() => {
    if (!preChatFormSchema.value) return false;
    if (preChatFormResponse.value) return false;
    if (conversationId.value) return false;
    return findMissingRequiredFields(preChatFormSchema.value, getContext()).length > 0;
  });

  // Populated inside initialize() via safeStorage — see comment above.
  const existingConversationId = ref<string | null>(null);
  // A conversation found in sessionStorage whose DPoP key sits behind the
  // closed persistent-storage gate. Resumed when the gate opens.
  let pendingRestoreId: string | null = null;

  // Initialize conversation HTTP service (used for all message sending and loading)
  const conversation = useConversation(config);

  // Initialize WebSocket (used only for receiving real-time updates like new agent messages, typing indicators, etc.)
  const {
    isConnected,
    conversationId,
    messages,
    isTyping,
    connect,
    identify,
    sendTypingIndicator,
    disconnect,
    setStatusChangeCallback,
  } = useWebSocket(config.baseUrl, config.organizationId);

  // Initialize message queue for offline/retry handling
  const messageQueue = useMessageQueue();

  // When the session gate opens (first message or pre-interaction grant),
  // flush the current conversation's in-memory state to sessionStorage so a
  // reload can resume it. This handles the case where initialize() ran
  // pre-interaction and wrote nothing.
  watch(canUseSession, (allowed) => {
    if (!allowed) return;
    if (conversationId.value) {
      safeStorage.session.setItem("hay-conversation-id", conversationId.value);
    }
    if (lastReadMessageId.value) {
      safeStorage.session.setItem("hay-last-read-message-id", lastReadMessageId.value);
    }
  });

  // When the persistent-storage gate opens, flush the customer ID and the
  // DPoP keypair to their respective stores. Without this, strict-mode chats
  // that start before grantConsent() would lose their persistent identifiers.
  watch(canUseLocal, async (allowed) => {
    if (!allowed) return;
    // A customer ID stored on an earlier visit wins over the in-memory one
    // made while the gate was closed; overwriting it would split the
    // shopper's history across two customers.
    const storedCustomerId = safeStorage.local.getItem("hay-customer-id");
    if (storedCustomerId) {
      customerId.value = storedCustomerId;
    } else if (customerId.value) {
      safeStorage.local.setItem("hay-customer-id", customerId.value);
    }
    // The page loaded with a conversation to resume but its key could not be
    // read yet (strict mode, consent granted after load). Resume it now.
    if (pendingRestoreId && !conversationId.value) {
      const restoreId = pendingRestoreId;
      pendingRestoreId = null;
      if (await loadExistingConversation(restoreId)) await startRealtime();
      return;
    }
    if (keypair.value && conversationId.value) {
      try {
        await storeKeypair(
          conversationId.value,
          keypair.value.privateKey,
          keypair.value.publicKey,
          keypair.value.publicJwk,
        );
      } catch (error) {
        console.error("[Webchat] Failed to persist keypair after consent:", error);
      }
    }
  });

  // Check WebCrypto availability
  const isWebCryptoAvailable = (): boolean => {
    return (
      typeof window !== "undefined" &&
      !!window.crypto &&
      !!window.crypto.subtle &&
      typeof window.crypto.subtle.generateKey === "function"
    );
  };

  // Pin the configured greeting to the top of the conversation. It is a local
  // placeholder until the server's greeting message arrives and takes its
  // place (see insertMessage), and it carries a server time so the browser
  // clock never decides where it sits.
  const pinGreeting = (timestamp: number) => {
    if (!config.showGreeting || !config.greetingMessage) return;
    insertMessage(messages.value, {
      id: "greeting",
      sender: "agent",
      content: config.greetingMessage,
      timestamp,
      isGreeting: true,
    });
  };

  // Create new conversation
  const createNewConversation = async (): Promise<boolean> => {
    lastCreateError = null;
    try {
      debugLog("[Webchat] Creating new conversation...");

      // Generate new keypair
      const newKeypair = await generateKeypair();
      if (!newKeypair) {
        throw new Error("Failed to generate keypair");
      }

      const challengeResult = options.challenge
        ? await challenge.run(options.challenge)
        : undefined;

      // The pre-chat form answers, when the shopper filled one.
      const preChatPayload =
        preChatFormSchema.value && preChatFormResponse.value
          ? { schema: preChatFormSchema.value, response: preChatFormResponse.value }
          : undefined;

      // Create conversation via HTTP, passing current context and the signed customer id
      const conversationData = await conversation.createConversation(
        newKeypair.publicJwk,
        getContext(),
        { externalId: config.customerExternalId, signature: config.customerExternalIdSignature },
        challengeResult,
        preChatPayload,
      );
      if (!conversationData) {
        throw new Error("Failed to create conversation");
      }

      // Fire onConversationStarted callback — if it returns a Promise, wait for it
      // This allows the host to attach server-side secrets before input is enabled
      if (config.onConversationStarted) {
        const result = config.onConversationStarted({ id: conversationData.id });
        if (result instanceof Promise) {
          await result;
        }
      }

      // Persist keypair only when the persistent-storage gate is open.
      // If the gate is closed, the keypair stays in-memory in `keypair.value`
      // and will be flushed to IndexedDB by the canUseLocal watcher when the
      // user interacts or the host grants consent.
      if (canUseLocal.value) {
        await storeKeypair(
          conversationData.id,
          newKeypair.privateKey,
          newKeypair.publicKey,
          newKeypair.publicJwk,
        );
      }
      safeStorage.session.setItem("hay-conversation-id", conversationData.id);

      keypair.value = newKeypair;
      nonce.value = conversationData.nonce;
      existingConversationId.value = conversationData.id;
      conversationId.value = conversationData.id;
      isConversationClosed.value = false;

      debugLog("[Webchat] Conversation created:", conversationData.id);

      pinGreeting(parseServerTime(conversationData.createdAt));

      // Identifying on the socket happens in startRealtime().
      return true;
    } catch (error) {
      console.error("[Webchat] Failed to create conversation:", error);
      lastCreateError = error;
      return false;
    }
  };

  // Load existing conversation
  const loadExistingConversation = async (convId: string): Promise<boolean> => {
    try {
      debugLog("[Webchat] Loading existing conversation:", convId);

      // The key lives in IndexedDB, behind the persistent-storage gate. While
      // the gate is closed, keep the conversation ID: the host may still grant
      // consent (cookie banners often answer after the widget loads), and the
      // canUseLocal watcher resumes it then.
      if (!canUseLocal.value) {
        debugLog("[Webchat] Conversation key not readable before consent, deferring resume");
        pendingRestoreId = convId;
        return false;
      }
      const storedKeypair = await getKeypair(convId);
      if (!storedKeypair) {
        debugLog("[Webchat] No keypair found, clearing conversation");
        safeStorage.session.removeItem("hay-conversation-id");
        existingConversationId.value = null;
        return false;
      }

      keypair.value = storedKeypair;
      conversationId.value = convId;

      // Load message history via HTTP with DPoP proof
      const wsUrl = `${config.baseUrl}/v1/publicConversations.getMessages`;
      const proof = await createDPoPProof(
        "POST",
        wsUrl,
        storedKeypair.privateKey,
        storedKeypair.publicJwk,
        "initial", // Use 'initial' for first request
      );

      if (!proof) {
        throw new Error("Failed to create DPoP proof");
      }

      const messagesData = await conversation.getMessages(convId, proof, "POST", wsUrl);

      // Handle nonce expiration
      if (messagesData?.error === "NONCE_EXPIRED") {
        debugLog("[Webchat] Nonce expired, retrying...");
        nonce.value = messagesData.nonce;

        // Retry with new nonce
        const retryProof = await createDPoPProof(
          "POST",
          wsUrl,
          storedKeypair.privateKey,
          storedKeypair.publicJwk,
          messagesData.nonce,
        );

        if (!retryProof) {
          throw new Error("Failed to create retry DPoP proof");
        }

        const retryData = await conversation.getMessages(convId, retryProof, "POST", wsUrl);
        if (!retryData) {
          throw new Error("Failed to load messages on retry");
        }

        nonce.value = retryData.nonce;

        // Load messages
        if (retryData.messages && retryData.messages.length > 0) {
          loadMessagesIntoUI(retryData.messages);
        }

        conversationStatus.value = retryData.status ?? null;

        // Check if conversation is closed
        if (retryData.isClosed) {
          isConversationClosed.value = true;
        }
      } else if (messagesData) {
        nonce.value = messagesData.nonce;

        // Load messages
        if (messagesData.messages && messagesData.messages.length > 0) {
          loadMessagesIntoUI(messagesData.messages);
        }

        conversationStatus.value = messagesData.status ?? null;

        // Check if conversation is closed
        if (messagesData.isClosed) {
          isConversationClosed.value = true;
        }
      }

      debugLog("[Webchat] Conversation loaded successfully");

      // Identifying on the socket happens in startRealtime().
      return true;
    } catch (error) {
      console.error("[Webchat] Failed to load existing conversation:", error);
      // Clear invalid conversation
      safeStorage.session.removeItem("hay-conversation-id");
      existingConversationId.value = null;
      return false;
    }
  };

  // Load messages into UI
  const loadMessagesIntoUI = (msgs: any[]) => {
    // The server returns messages in conversation order; insertMessage keeps
    // it and pins the server greeting first.
    messages.value = [];
    msgs.forEach((msg) => {
      const sender = msg.type === "Customer" ? "user" : "agent";
      insertMessage(messages.value, {
        id: msg.id,
        sender,
        content: msg.content,
        timestamp: parseServerTime(msg.createdAt),
        metadata: msg.metadata,
        agentType: msg.type,
        senderName: msg.sender || undefined,
        attachments: msg.attachments ?? [],
      });

      // Track agent type from messages
      if (msg.type === "HumanAgent") {
        currentAgentType.value = "HumanAgent";
        if (msg.sender) {
          currentAgentName.value = msg.sender;
        }
      }

      // Check for closure message
      if (msg.metadata?.isClosureMessage === true) {
        isConversationClosed.value = true;
      }
    });

    // Conversations whose server greeting has not been stored yet still show
    // the local one; pinGreeting leaves an existing server greeting alone.
    if (messages.value.length > 0) pinGreeting(messages.value[0].timestamp);
  };

  // Connect the socket for live updates on the current conversation, plus the
  // retry loop and the polling fallback. Only called once a conversation
  // exists: a socket without one has nothing to listen to.
  const startRealtime = async () => {
    if (!conversationId.value) return;

    // Both run over HTTP, so they don't wait for the socket.
    startRetryLoop();
    startPolling();

    if (!isConnected.value) {
      connect();
      // Wait for the socket (up to 5 seconds) so we can identify right away.
      await new Promise<void>((resolve) => {
        const checkConnection = setInterval(() => {
          if (isConnected.value) {
            clearInterval(checkConnection);
            clearTimeout(giveUp);
            resolve();
          }
        }, 100);
        const giveUp = setTimeout(() => {
          clearInterval(checkConnection);
          resolve();
        }, 5000);
      });
    }

    if (conversationId.value && isConnected.value) {
      debugLog("[Webchat] Identifying with WebSocket after connection...");
      identify(customerId.value, conversationId.value);
    }
  };

  // Prepare the chat: read what storage allows and resume this tab's
  // conversation if there is one. It never creates a conversation: that waits
  // for the shopper's first message, so browsing and opening the widget leave
  // no rows behind and give bots nothing to farm.
  let initializing: Promise<void> | null = null;
  const initialize = (): Promise<void> => {
    if (isInitialized.value) return Promise.resolve();
    if (!initializing) {
      initializing = runInitialize().finally(() => {
        initializing = null;
      });
    }
    return initializing;
  };

  const runInitialize = async () => {
    try {
      // Check WebCrypto availability
      if (!isWebCryptoAvailable()) {
        console.error("[Webchat] WebCrypto API not available");
        throw new Error("WebCrypto not supported");
      }

      // Initialize context store from config
      if (config.context && Object.keys(config.context).length > 0) {
        initContext(config.context);
      }

      // Populate any cached state from storage — only returns data when the
      // consent gate is open (pre-granted or post-interaction).
      lastReadMessageId.value = safeStorage.session.getItem("hay-last-read-message-id");
      // A follow-up email link (D5-9) names the conversation to reopen.
      const resumeId = resumeConversationId();
      if (resumeId) safeStorage.session.setItem("hay-conversation-id", resumeId);
      existingConversationId.value = resumeId ?? safeStorage.session.getItem("hay-conversation-id");

      // Generate or retrieve customer ID. When the persistent-storage gate is
      // closed, the ID lives only in memory and the canUseLocal watcher will
      // flush it to localStorage once the gate opens.
      let storedCustomerId = safeStorage.local.getItem("hay-customer-id");
      if (!storedCustomerId) {
        storedCustomerId = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        safeStorage.local.setItem("hay-customer-id", storedCustomerId);
      }
      customerId.value = storedCustomerId;

      // Resume this tab's conversation (HTTP operations don't need WebSocket).
      // When its key is still behind the consent gate the resume is deferred
      // (see loadExistingConversation); nothing new is created either way.
      if (existingConversationId.value) {
        await loadExistingConversation(existingConversationId.value);
      }

      if (conversationId.value) {
        // Messages are sent over HTTP, so the chat is usable before the socket is up.
        void startRealtime();
      } else {
        pinGreeting(Date.now());
      }

      isInitialized.value = true;
      debugLog("[Webchat] Chat initialized successfully");
    } catch (error) {
      console.error("[Webchat] Failed to initialize chat:", error);
    }
  };

  // The shopper is about to send their first message: make sure there is a
  // conversation to send it to, resuming this tab's one when its key has
  // become readable, and creating one otherwise.
  const ensureConversation = async (): Promise<boolean> => {
    if (conversationId.value && keypair.value) return true;

    if (pendingRestoreId && canUseLocal.value) {
      const restoreId = pendingRestoreId;
      pendingRestoreId = null;
      if (await loadExistingConversation(restoreId)) {
        void startRealtime();
        return true;
      }
    }

    if (!(await createNewConversation())) return false;
    // Connect while the message goes out over HTTP; the reply takes longer.
    void startRealtime();
    return true;
  };

  // Set status change callback for conversation status updates
  setStatusChangeCallback((status: string, _payload: any) => {
    conversationStatus.value = status;

    // Handle conversation closure
    if (status === "closed" || status === "resolved" || status === "unresolved") {
      isConversationClosed.value = true;
    }

    // Handle conversation reopening
    if (status === "open" && isConversationClosed.value) {
      isConversationClosed.value = false;
    }

    // Track human takeover / release
    if (status === "human-took-over") {
      currentAgentType.value = "HumanAgent";
    } else if (status === "open" && currentAgentType.value === "HumanAgent") {
      currentAgentType.value = "BotAgent";
      currentAgentName.value = null;
    }
  });

  // Retry loop for queued messages
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  const startRetryLoop = () => {
    if (retryTimer) return;

    retryTimer = setInterval(async () => {
      // Skip if not initialized (we don't need WebSocket for HTTP sending)
      if (!isInitialized.value) return;

      const nextMessage = messageQueue.getNextRetry();
      if (nextMessage) {
        try {
          // Try to send the message again via HTTP
          await sendMessageInternal(nextMessage.content, nextMessage.conversationId);

          // Success - remove from queue
          messageQueue.dequeue(nextMessage.id);
        } catch (error) {
          console.error("[MessageQueue] Retry failed for:", nextMessage.id, error);
          // Increment retry count
          messageQueue.incrementRetry(nextMessage.id);
        }
      }

      // Clean up failed messages that exceeded max retries
      messageQueue.clearFailedMessages();
    }, 5000); // Check every 5 seconds
  };

  const stopRetryLoop = () => {
    if (retryTimer) {
      clearInterval(retryTimer);
      retryTimer = null;
    }
  };

  // Periodic polling for new messages (fallback if WebSocket fails)
  let pollingTimer: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    if (pollingTimer) return;

    pollingTimer = setInterval(async () => {
      // Skip if not initialized or no conversation
      if (!isInitialized.value || !conversationId.value) return;

      try {
        await refreshMessages();
      } catch (error) {
        console.error("[Webchat] Polling refresh failed:", error);
      }
    }, 10000); // Poll every 10 seconds
  };

  const stopPolling = () => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  };

  // Note: We no longer need to watch WebSocket connection status for retry
  // since messages are sent via HTTP now. The retry loop runs independently.

  // Mark all current messages as read
  const markMessagesAsRead = () => {
    const agentMessages = messages.value.filter((msg) => msg.sender === "agent" && !msg.isGreeting);
    if (agentMessages.length > 0) {
      const lastAgentMessage = agentMessages[agentMessages.length - 1];
      lastReadMessageId.value = lastAgentMessage.id;
      safeStorage.session.setItem("hay-last-read-message-id", lastAgentMessage.id);
    }
  };

  // After a reload or a navigation, pick the conversation from this tab back
  // up without waiting for a click, so the socket reconnects and replies that
  // arrive meanwhile show on the unread badge.
  const resumeActiveConversation = () => {
    if (safeStorage.session.getItem("hay-conversation-id")) void initialize();
  };

  // Toggle chat window
  const toggleChat = () => {
    isOpen.value = !isOpen.value;
    // Initialize in background if not already initialized
    if (!isInitialized.value && isOpen.value) {
      initialize();
    }
    // Mark messages as read when opening
    if (isOpen.value) {
      markMessagesAsRead();
    }
  };

  // Open chat
  const openChat = () => {
    isOpen.value = true;
    // Initialize in background if not already initialized
    if (!isInitialized.value) {
      initialize();
    }
    // Mark messages as read when opening
    markMessagesAsRead();
  };

  // Close chat
  const closeChat = () => {
    isOpen.value = false;
  };

  // Clear conversation and create new one
  const clearConversation = async () => {
    if (conversationId.value) {
      await clearKeypair(conversationId.value);
    }
    safeStorage.session.removeItem("hay-conversation-id");
    safeStorage.session.removeItem("hay-last-read-message-id");
    existingConversationId.value = null;
    conversationId.value = null;
    keypair.value = null;
    nonce.value = "";
    messages.value = [];
    isConversationClosed.value = false;
    lastReadMessageId.value = null;
    conversationStatus.value = null;
    contactEmailSaved.value = false;
  };

  // Start over after a closed conversation. The new conversation is created
  // when the shopper sends its first message.
  const startNewConversation = async () => {
    await clearConversation();
    pinGreeting(Date.now());
  };

  // Merge server messages into existing messages (additive only - never removes messages)
  const mergeMessages = (serverMessages: any[]) => {
    // A file the shopper sent keeps its local id; the server's id is in metadata.serverId.
    const existingIds = new Set(
      messages.value.flatMap((m) =>
        typeof m.metadata?.serverId === "string" ? [m.id, m.metadata.serverId] : [m.id],
      ),
    );
    let added = 0;

    for (const msg of serverMessages) {
      // Skip messages we already have (including optimistic temp messages matched by content)
      if (existingIds.has(msg.id)) continue;

      const sender = msg.type === "Customer" ? "user" : "agent";
      const newMessage: Message = {
        id: msg.id,
        sender,
        content: msg.content,
        timestamp: parseServerTime(msg.createdAt),
        metadata: msg.metadata,
        agentType: msg.type,
        senderName: msg.sender || undefined,
        attachments: msg.attachments ?? [],
      };

      // Track agent type from new messages
      if (msg.type === "HumanAgent") {
        currentAgentType.value = "HumanAgent";
        if (msg.sender) {
          currentAgentName.value = msg.sender;
        }
      }

      // Check if this is a server confirmation of an optimistic user message
      // Don't replace it — changing the key (temp-* → real ID) causes Vue to
      // destroy and recreate the DOM element, which triggers a visual flash.
      // Just skip the server duplicate; the temp message already shows correctly.
      if (sender === "user") {
        const fileNames = (msg.attachments ?? []).map((a: { name: string }) => a.name);
        const hasTempMatch = messages.value.some(
          (m) =>
            m.id.startsWith("temp-") &&
            m.sender === "user" &&
            (fileNames.length
              ? (m.attachments ?? []).some((a) => fileNames.includes(a.name))
              : m.content === msg.content),
        );
        if (hasTempMatch) {
          continue;
        }
      }

      insertMessage(messages.value, newMessage);
      existingIds.add(msg.id);
      added++;

      // Check for closure message
      if (msg.metadata?.isClosureMessage === true) {
        isConversationClosed.value = true;
      }
    }

    return added;
  };

  // Refresh messages from server to ensure we have the complete conversation
  const refreshMessages = async () => {
    if (!conversationId.value || !keypair.value) {
      debugLog("[Webchat] Cannot refresh messages: missing conversation or keypair");
      return;
    }

    try {
      const wsUrl = `${config.baseUrl}/v1/publicConversations.getMessages`;
      const proof = await createDPoPProof(
        "POST",
        wsUrl,
        keypair.value.privateKey,
        keypair.value.publicJwk,
        nonce.value || "initial",
      );

      if (!proof) {
        console.error("[Webchat] Failed to create DPoP proof for refresh");
        return;
      }

      const messagesData = await conversation.getMessages(
        conversationId.value,
        proof,
        "POST",
        wsUrl,
      );

      if (messagesData?.nonce) {
        nonce.value = messagesData.nonce;
      }

      if (messagesData?.messages) {
        // If server returned 0 messages but we have messages locally, skip the update
        // This prevents the conversation from disappearing due to transient server issues
        if (messagesData.messages.length === 0 && messages.value.length > 0) {
          debugLog(
            "[Webchat] Server returned 0 messages but we have local messages, skipping refresh",
          );
          return;
        }

        // Merge new messages into existing ones (additive only)
        mergeMessages(messagesData.messages);
      }

      if (messagesData?.status) {
        conversationStatus.value = messagesData.status;
      }

      // Update conversation closed state
      if (messagesData?.isClosed) {
        isConversationClosed.value = true;
      }
    } catch (error) {
      console.error("[Webchat] Failed to refresh messages:", error);
      // Don't throw - this is a non-critical operation
    }
  };

  // Internal send function (used by both public sendMessage and retry loop)
  const sendMessageInternal = async (text: string, convId: string): Promise<void> => {
    if (!keypair.value) {
      throw new Error("No keypair available");
    }

    // Create DPoP proof for HTTP request
    const httpUrl = `${config.baseUrl}/v1/publicConversations.sendMessage`;
    const proof = await createDPoPProof(
      "POST",
      httpUrl,
      keypair.value.privateKey,
      keypair.value.publicJwk,
      nonce.value || "initial",
    );

    if (!proof) {
      throw new Error("Failed to create DPoP proof");
    }

    // Send via HTTP instead of WebSocket, including current context for the orchestrator
    const result = await conversation.sendMessage(
      convId,
      text.trim(),
      proof,
      "POST",
      httpUrl,
      getContext(),
    );

    if (!result) {
      throw new Error("Failed to send message");
    }

    // Handle nonce expiration
    if (result.error === "NONCE_EXPIRED" && result.nonce) {
      nonce.value = result.nonce;
      const error: any = new Error("NONCE_EXPIRED");
      error.nonce = result.nonce;
      throw error;
    }

    // Update nonce from response
    if (result.nonce) {
      nonce.value = result.nonce;
    }
  };

  // Send a message
  // Sends go out one at a time, in the order the shopper wrote them. This
  // matters most for the first message, which creates the conversation: a
  // second message must wait for it rather than race it.
  let sendChain: Promise<unknown> = Promise.resolve();
  const sendMessage = (text: string): Promise<void> => {
    const run = sendChain.then(() => sendMessageNow(text));
    sendChain = run.catch(() => {});
    return run;
  };

  const sendMessageNow = async (text: string, retryCount: number = 0): Promise<void> => {
    if (!text.trim()) return;

    // Sending a message is the ePrivacy "service explicitly requested" signal.
    // Mark interaction BEFORE any persistence runs so session/local storage
    // writes in the conversation lifecycle below are permitted.
    if (retryCount === 0) {
      markInteraction();
      sendFailure.value = null;
    }

    const tempMessageId = `temp-${Date.now()}`;
    let stage: "create" | "send" = "create";

    try {
      // A closed conversation is not reused: the message starts a new one.
      if (isConversationClosed.value && retryCount === 0) {
        debugLog("[Webchat] Conversation closed, starting a new one...");
        await clearConversation();
        pinGreeting(Date.now());
      }

      // Add message optimistically (only on first attempt), before the
      // conversation is created, so the bubble shows without waiting.
      if (retryCount === 0) {
        messages.value.push({
          id: tempMessageId,
          sender: "user",
          content: text.trim(),
          timestamp: Date.now(),
        });
      }

      // The first message is what creates the conversation.
      await initialize();
      if (!(await ensureConversation())) {
        throw lastCreateError ?? new Error("Failed to create conversation");
      }

      isSending.value = true;

      stage = "send";

      await sendMessageInternal(text.trim(), conversationId.value!);

      // Don't call refreshMessages() here — the bot hasn't responded yet so it's
      // wasted work. The 10-second polling loop and WebSocket handle new messages.

      isSending.value = false;
    } catch (error: any) {
      isSending.value = false;

      // Handle nonce expiration
      if (error.message?.includes("NONCE_EXPIRED") && error.nonce && retryCount < 1) {
        debugLog("[Webchat] Nonce expired, retrying...");
        nonce.value = error.nonce;
        // Retry once with new nonce
        return sendMessageNow(text, retryCount + 1);
      }

      console.error("[Webchat] Failed to send message:", error);

      // The server refused the message (4xx). Retrying automatically will not
      // help, so take the bubble back, return the text to the input and tell
      // the shopper. Never surface the internal reason (e.g. domain checks).
      if (error instanceof WidgetRequestError && error.isRefusal) {
        for (let i = messages.value.length - 1; i >= 0; i--) {
          const m = messages.value[i];
          if (m.id.startsWith("temp-") && m.content === text.trim()) {
            messages.value.splice(i, 1);
            break;
          }
        }

        const tooLong = stage === "send" && (error.status === 400 || error.status === 413);
        sendFailure.value = {
          reason: error.isVerificationFailure
            ? "verificationFailed"
            : tooLong
              ? "messageTooLong"
              : "sendFailed",
          text,
        };
        return;
      }

      // Queue message for retry on error (only on first attempt)
      if (retryCount === 0 && conversationId.value) {
        debugLog("[Webchat] Queueing failed message for retry");
        messageQueue.enqueue({
          id: tempMessageId,
          content: text.trim(),
          timestamp: Date.now(),
          conversationId: conversationId.value,
        });

        // Mark message as pending in UI
        const messageIndex = messages.value.findIndex((m) => m.id === tempMessageId);
        if (messageIndex !== -1) {
          messages.value[messageIndex].metadata = {
            ...messages.value[messageIndex].metadata,
            pending: true,
            error: true,
          };
        }
      } else {
        // Remove optimistic message on error if not queueing
        if (messages.value.length > 0) {
          const lastMsg = messages.value[messages.value.length - 1];
          if (lastMsg.sender === "user" && lastMsg.id === tempMessageId) {
            messages.value.pop();
          }
        }
      }

      throw error;
    }
  };

  // Send a photo or PDF (D8-9), with what the shopper had typed as its
  // caption. Queued behind text messages so the order is kept.
  const sendAttachment = (file: File, caption = ""): Promise<void> => {
    const run = sendChain.then(() => sendAttachmentNow(file, caption));
    sendChain = run.catch(() => {});
    return run;
  };

  const postAttachment = async (file: File, data: string, caption: string) => {
    const url = `${config.baseUrl}/v1/publicConversations.sendAttachment`;
    const proof = await createDPoPProof(
      "POST",
      url,
      keypair.value!.privateKey,
      keypair.value!.publicJwk,
      nonce.value || "initial",
    );
    if (!proof) throw new Error("Failed to create DPoP proof");
    const result = await conversation.sendAttachment({
      conversationId: conversationId.value!,
      data,
      mimeType: file.type,
      filename: file.name,
      caption,
      proof,
      method: "POST",
      url,
      context: getContext(),
    });
    if (result.nonce) nonce.value = result.nonce;
    return result;
  };

  const sendAttachmentNow = async (file: File, rawCaption: string): Promise<void> => {
    const caption = rawCaption.trim();
    // Sending a file is an explicit request for the chat service, like a message.
    markInteraction();
    sendFailure.value = null;

    if (!isAcceptedAttachmentType(file.type)) {
      sendFailure.value = { reason: "fileType", text: caption };
      return;
    }
    if (file.size > WIDGET_ATTACHMENT_MAX_BYTES) {
      sendFailure.value = { reason: "fileTooLarge", text: caption };
      return;
    }

    if (isConversationClosed.value) {
      await clearConversation();
      pinGreeting(Date.now());
    }

    const tempMessageId = `temp-${Date.now()}`;
    // Photos show from the shopper's own copy straight away (and keep doing
    // so: swapping in the server link would reload the image).
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    messages.value.push({
      id: tempMessageId,
      sender: "user",
      content: caption,
      timestamp: Date.now(),
      metadata: { pending: true },
      attachments: [
        { id: tempMessageId, name: file.name, url: previewUrl, type: file.type, size: file.size },
      ],
    });

    try {
      await initialize();
      if (!(await ensureConversation())) {
        throw lastCreateError ?? new Error("Failed to create conversation");
      }
      isSending.value = true;

      const data = await readFileAsBase64(file);
      let result = await postAttachment(file, data, caption);
      if (result.error === "NONCE_EXPIRED") {
        result = await postAttachment(file, data, caption);
      }
      if (result.error || !result.messageId) throw new Error("Failed to send file");

      const index = messages.value.findIndex((m) => m.id === tempMessageId);
      if (index !== -1) {
        const stored = result.attachment;
        messages.value[index] = {
          ...messages.value[index],
          metadata: { serverId: result.messageId },
          attachments: stored ? [{ ...stored, url: previewUrl || stored.url }] : [],
        };
      }
    } catch (error) {
      console.error("[Webchat] Failed to send file:", error);
      const index = messages.value.findIndex((m) => m.id === tempMessageId);
      if (index !== -1) messages.value.splice(index, 1);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const refusedFile =
        error instanceof WidgetRequestError && (error.status === 400 || error.status === 413);
      const verification = error instanceof WidgetRequestError && error.isVerificationFailure;
      sendFailure.value = {
        reason: verification ? "verificationFailed" : refusedFile ? "fileFailed" : "sendFailed",
        text: caption,
      };
    } finally {
      isSending.value = false;
    }
  };

  // Watch for new messages to detect closure
  const checkMessageForClosure = (message: any) => {
    if (message.metadata?.isClosureMessage === true) {
      isConversationClosed.value = true;
      debugLog("[Webchat] Conversation has been closed");
    }
  };

  // Start typing
  let typingTimeout: ReturnType<typeof setTimeout> | null = null;
  const startTyping = () => {
    sendTypingIndicator(true);

    if (typingTimeout) {
      clearTimeout(typingTimeout);
    }

    typingTimeout = setTimeout(() => {
      stopTyping();
    }, 3000);
  };

  // Stop typing
  const stopTyping = () => {
    sendTypingIndicator(false);
    if (typingTimeout) {
      clearTimeout(typingTimeout);
      typingTimeout = null;
    }
  };

  // Unread message count
  const unreadCount = computed(() => {
    if (isOpen.value) return 0;

    // Find the index of the last read message
    const lastReadIndex = lastReadMessageId.value
      ? messages.value.findIndex((msg) => msg.id === lastReadMessageId.value)
      : -1;

    // Count agent messages after the last read message
    return messages.value.filter((msg, index) => {
      // Skip greeting messages
      if (msg.isGreeting) return false;
      // Only count agent messages
      if (msg.sender !== "agent") return false;
      // Only count messages after the last read one
      if (lastReadIndex >= 0 && index <= lastReadIndex) return false;
      return true;
    }).length;
  });

  // Leave an email so the team's reply reaches the shopper after they leave (D5-8).
  const saveContactEmail = async (email: string, retried = false): Promise<boolean> => {
    if (!conversationId.value || !keypair.value) return false;
    const url = `${config.baseUrl}/v1/publicConversations.setContactEmail`;
    const proof = await createDPoPProof(
      "POST",
      url,
      keypair.value.privateKey,
      keypair.value.publicJwk,
      nonce.value || "initial",
    );
    if (!proof) return false;
    try {
      const result = await conversation.setContactEmail(
        conversationId.value,
        email,
        proof,
        "POST",
        url,
      );
      if (result.nonce) nonce.value = result.nonce;
      if (result.error === "NONCE_EXPIRED" && !retried) return saveContactEmail(email, true);
      contactEmailSaved.value = result.saved;
      return result.saved;
    } catch (error) {
      console.error("[Webchat] Failed to save contact email:", error);
      return false;
    }
  };

  // The shopper filled the pre-chat form: keep the answers and open the
  // conversation now, so the answers reach the team before the first message.
  const submitPreChatForm = async (response: FormResponse): Promise<boolean> => {
    preChatFormResponse.value = response;
    if (!(await ensureConversation())) {
      preChatFormResponse.value = null;
      return false;
    }
    return true;
  };

  // Submit a response to an in-conversation FORM message (ASK_FORM step).
  // Optimistically mutates the local message, then POSTs to the server. The
  // orchestrator resumes server-side; the updated message will also flow back
  // via WS in case of any server-side rendering differences.
  const submitInConversationForm = async (
    messageId: string,
    response: FormResponse,
  ): Promise<boolean> => {
    if (!keypair.value || !conversationId.value) {
      console.error("[Webchat] Cannot submit form: missing keypair or conversation");
      return false;
    }
    const httpUrl = `${config.baseUrl}/v1/publicConversations.submitForm`;
    const proof = await createDPoPProof(
      "POST",
      httpUrl,
      keypair.value.privateKey,
      keypair.value.publicJwk,
      nonce.value || "initial",
    );
    if (!proof) {
      console.error("[Webchat] Failed to create DPoP proof for form submit");
      return false;
    }

    // Optimistic UI update
    const msg = messages.value.find((m) => m.id === messageId);
    if (msg) {
      const ui =
        (msg.metadata?.ui as { schema?: unknown; status?: string } | undefined) ?? undefined;
      msg.metadata = {
        ...(msg.metadata ?? {}),
        ui: {
          ...(ui ?? {}),
          kind: "form",
          schema: ui?.schema,
          status: "SUBMITTED",
          response,
          submittedAt: new Date().toISOString(),
        },
      };
    }

    const result = await conversation.submitFormMessage(
      conversationId.value,
      messageId,
      response,
      proof,
      "POST",
      httpUrl,
    );
    if (!result) return false;
    if (result.nonce) nonce.value = result.nonce;
    return true;
  };

  // Enhanced disconnect that also stops retry loop and polling
  const disconnectAll = () => {
    disconnect();
    stopRetryLoop();
    stopPolling();
    debugLog("[Webchat] All services disconnected");
  };

  return {
    // State
    isOpen,
    isInitialized,
    isConnected,
    conversationId,
    messages,
    isTyping,
    unreadCount,
    isSending,
    sendFailure,
    challengeHost: challenge.host,
    isChallengeInteractive: challenge.isInteractive,
    isConversationClosed,
    currentAgentType,
    currentAgentName,
    conversationStatus,
    contactEmailSaved,
    pendingPreChatForm,
    preChatFormSchema,

    // Actions
    initialize,
    resumeActiveConversation,
    toggleChat,
    openChat,
    closeChat,
    sendMessage,
    sendAttachment,
    startTyping,
    stopTyping,
    disconnect: disconnectAll,
    checkMessageForClosure,
    startNewConversation,
    saveContactEmail,
    submitPreChatForm,
    submitInConversationForm,
  };
}
