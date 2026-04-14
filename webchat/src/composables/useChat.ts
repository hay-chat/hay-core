import { ref, computed, watch } from "vue";
import { useWebSocket } from "./useWebSocket";
import { useConversation } from "./useConversation";
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
import type { HayChatConfig, Message } from "@/types";

interface Keypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export function useChat(config: HayChatConfig) {
  const { canUseSession, canUseLocal, markInteraction } = useConsent();

  const isOpen = ref(false);
  const isInitialized = ref(false);
  const customerId = ref<string>("");
  const keypair = ref<Keypair | null>(null);
  const nonce = ref<string>("");
  const isConversationClosed = ref(false);
  const isSending = ref(false);
  // These start as null and are populated inside initialize() via safeStorage.
  // This matters because consent state may change between useChat() being
  // called (at widget mount) and initialize() running (on first open), e.g.
  // when the host site calls grantConsent() from its cookie banner.
  const lastReadMessageId = ref<string | null>(null);
  const currentAgentType = ref<"BotAgent" | "HumanAgent">("BotAgent");
  const currentAgentName = ref<string | null>(null);

  // Populated inside initialize() via safeStorage — see comment above.
  const existingConversationId = ref<string | null>(null);

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
    setNonceUpdateCallback,
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
    if (customerId.value) {
      safeStorage.local.setItem("hay-customer-id", customerId.value);
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

  // Create new conversation
  const createNewConversation = async (): Promise<boolean> => {
    try {
      console.log("[Webchat] Creating new conversation...");

      // Generate new keypair
      const newKeypair = await generateKeypair();
      if (!newKeypair) {
        throw new Error("Failed to generate keypair");
      }

      // Create conversation via HTTP, passing current context and customerExternalId
      const conversationData = await conversation.createConversation(
        newKeypair.publicJwk,
        getContext(),
        config.customerExternalId,
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

      console.log("[Webchat] Conversation created:", conversationData.id);

      // Show greeting if configured
      if (config.showGreeting && config.greetingMessage) {
        messages.value.push({
          id: "greeting",
          sender: "agent",
          content: config.greetingMessage,
          timestamp: Date.now(),
          isGreeting: true,
        });
      }

      // Don't identify yet - will be done after WebSocket connects in initialize()
      return true;
    } catch (error) {
      console.error("[Webchat] Failed to create conversation:", error);
      return false;
    }
  };

  // Load existing conversation
  const loadExistingConversation = async (convId: string): Promise<boolean> => {
    try {
      console.log("[Webchat] Loading existing conversation:", convId);

      // Get keypair from IndexedDB. Only attempted when the persistent-storage
      // gate is open — otherwise we can't have stored it, so treat as missing.
      const storedKeypair = canUseLocal.value ? await getKeypair(convId) : null;
      if (!storedKeypair) {
        console.log("[Webchat] No keypair found, clearing conversation");
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
        console.log("[Webchat] Nonce expired, retrying...");
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

        // Check if conversation is closed
        if (messagesData.isClosed) {
          isConversationClosed.value = true;
        }
      }

      console.log("[Webchat] Conversation loaded successfully");

      // Don't identify yet - will be done after WebSocket connects in initialize()
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
    messages.value = [];
    msgs.forEach((msg) => {
      const sender = msg.type === "Customer" ? "user" : "agent";
      messages.value.push({
        id: msg.id,
        sender,
        content: msg.content,
        timestamp: new Date(msg.createdAt).getTime(),
        metadata: msg.metadata,
        agentType: msg.type,
        senderName: msg.sender || undefined,
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
  };

  // Initialize chat
  const initialize = async () => {
    if (isInitialized.value) return;

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
      existingConversationId.value = safeStorage.session.getItem("hay-conversation-id");

      // Generate or retrieve customer ID. When the persistent-storage gate is
      // closed, the ID lives only in memory and the canUseLocal watcher will
      // flush it to localStorage once the gate opens.
      let storedCustomerId = safeStorage.local.getItem("hay-customer-id");
      if (!storedCustomerId) {
        storedCustomerId = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        safeStorage.local.setItem("hay-customer-id", storedCustomerId);
      }
      customerId.value = storedCustomerId;

      // Check for existing conversation (HTTP operations don't need WebSocket)
      const existingConvId = existingConversationId.value;
      if (existingConvId) {
        const loaded = await loadExistingConversation(existingConvId);
        if (!loaded) {
          // Failed to load, create new
          await createNewConversation();
        }
      } else {
        // No existing conversation, create new
        await createNewConversation();
      }

      // Connect WebSocket for real-time updates
      connect();

      // Wait for WebSocket connection
      await new Promise<void>((resolve) => {
        if (isConnected.value) {
          resolve();
          return;
        }

        const checkConnection = setInterval(() => {
          if (isConnected.value) {
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);

        // Timeout after 5 seconds
        setTimeout(() => {
          clearInterval(checkConnection);
          resolve();
        }, 5000);
      });

      // Now identify with the WebSocket (conversation is already loaded)
      if (conversationId.value && isConnected.value) {
        console.log("[Webchat] Identifying with WebSocket after connection...");
        identify(customerId.value, conversationId.value);
      }

      // Start retry loop for queued messages
      startRetryLoop();

      // Start periodic polling as fallback to ensure messages appear even if WebSocket fails
      startPolling();

      isInitialized.value = true;
      console.log("[Webchat] Chat initialized successfully");
    } catch (error) {
      console.error("[Webchat] Failed to initialize chat:", error);
    }
  };

  // Set nonce update callback for WebSocket responses
  setNonceUpdateCallback((newNonce: string) => {
    nonce.value = newNonce;
    console.log("[Webchat] Nonce updated from WebSocket");
  });

  // Set status change callback for conversation status updates
  setStatusChangeCallback((status: string, _payload: any) => {
    // Handle conversation closure
    if (status === "closed" || status === "resolved") {
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
  };

  // Start a new conversation (used when current one is closed)
  const startNewConversation = async () => {
    await clearConversation();
    const created = await createNewConversation();
    if (created) {
    }
    return created;
  };

  // Merge server messages into existing messages (additive only - never removes messages)
  const mergeMessages = (serverMessages: any[]) => {
    const existingIds = new Set(messages.value.map((m) => m.id));
    let added = 0;

    for (const msg of serverMessages) {
      // Skip messages we already have (including optimistic temp messages matched by content)
      if (existingIds.has(msg.id)) continue;

      const sender = msg.type === "Customer" ? "user" : "agent";
      const newMessage: Message = {
        id: msg.id,
        sender,
        content: msg.content,
        timestamp: new Date(msg.createdAt).getTime(),
        metadata: msg.metadata,
        agentType: msg.type,
        senderName: msg.sender || undefined,
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
        const hasTempMatch = messages.value.some(
          (m) => m.id.startsWith("temp-") && m.sender === "user" && m.content === msg.content,
        );
        if (hasTempMatch) {
          continue;
        }
      }

      // If there's a greeting placeholder and the incoming message is from the agent,
      // replace the greeting with the real server-generated message
      const greetingIndex = messages.value.findIndex((m) => m.isGreeting);
      if (greetingIndex !== -1 && sender === "agent") {
        messages.value.splice(greetingIndex, 1, newMessage);
        existingIds.add(msg.id);
        added++;
        continue;
      }

      messages.value.push(newMessage);
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
      console.log("[Webchat] Cannot refresh messages: missing conversation or keypair");
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
          console.log(
            "[Webchat] Server returned 0 messages but we have local messages, skipping refresh",
          );
          return;
        }

        // Merge new messages into existing ones (additive only)
        mergeMessages(messagesData.messages);
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
  const sendMessage = async (text: string, retryCount: number = 0) => {
    if (!text.trim() || isSending.value) return;

    // Sending a message is the ePrivacy "service explicitly requested" signal.
    // Mark interaction BEFORE any persistence runs so session/local storage
    // writes in the conversation lifecycle below are permitted.
    if (retryCount === 0) {
      markInteraction();
    }

    const tempMessageId = `temp-${Date.now()}`;

    try {
      // Check if conversation is closed
      if (isConversationClosed.value && retryCount === 0) {
        console.log("[Webchat] Conversation closed, creating new one...");
        await clearConversation();
        await createNewConversation();
      }

      // Ensure we have a conversation
      if (!conversationId.value || !keypair.value) {
        const created = await createNewConversation();
        if (!created) {
          throw new Error("Failed to create conversation");
        }
      }

      // Add message optimistically (only on first attempt)
      if (retryCount === 0) {
        messages.value.push({
          id: tempMessageId,
          sender: "user",
          content: text.trim(),
          timestamp: Date.now(),
        });
      }

      isSending.value = true;

      await sendMessageInternal(text.trim(), conversationId.value!);

      // Don't call refreshMessages() here — the bot hasn't responded yet so it's
      // wasted work. The 10-second polling loop and WebSocket handle new messages.

      isSending.value = false;
    } catch (error: any) {
      console.error("[Webchat] Failed to send message:", error);
      isSending.value = false;

      // Handle nonce expiration
      if (error.message?.includes("NONCE_EXPIRED") && error.nonce && retryCount < 1) {
        console.log("[Webchat] Nonce expired, retrying...");
        nonce.value = error.nonce;
        // Retry once with new nonce
        return sendMessage(text, retryCount + 1);
      }

      // Queue message for retry on error (only on first attempt)
      if (retryCount === 0 && conversationId.value) {
        console.log("[Webchat] Queueing failed message for retry");
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

  // Watch for new messages to detect closure
  const checkMessageForClosure = (message: any) => {
    if (message.metadata?.isClosureMessage === true) {
      isConversationClosed.value = true;
      console.log("[Webchat] Conversation has been closed");
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

  // Enhanced disconnect that also stops retry loop and polling
  const disconnectAll = () => {
    disconnect();
    stopRetryLoop();
    stopPolling();
    console.log("[Webchat] All services disconnected");
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
    isConversationClosed,
    currentAgentType,
    currentAgentName,

    // Actions
    initialize,
    toggleChat,
    openChat,
    closeChat,
    sendMessage,
    startTyping,
    stopTyping,
    disconnect: disconnectAll,
    checkMessageForClosure,
    startNewConversation,
  };
}
