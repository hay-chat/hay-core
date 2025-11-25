import { ref, computed, watch } from "vue";
import { useWebSocket } from "./useWebSocket";
import { useConversation } from "./useConversation";
import { useMessageQueue } from "./useMessageQueue";
import {
  generateKeypair,
  storeKeypair,
  getKeypair,
  createDPoPProof,
  clearKeypair,
} from "./useDPoP";
import type { HayChatConfig, Message } from "@/types";

interface Keypair {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  publicJwk: JsonWebKey;
}

export function useChat(config: HayChatConfig) {
  const isOpen = ref(false);
  const isInitialized = ref(false);
  const customerId = ref<string>("");
  const keypair = ref<Keypair | null>(null);
  const nonce = ref<string>("");
  const isConversationClosed = ref(false);
  const isSending = ref(false);
  const lastReadMessageId = ref<string | null>(sessionStorage.getItem("hay-last-read-message-id"));

  // Get existing conversation ID from session storage
  const existingConversationId = ref<string | null>(sessionStorage.getItem("hay-conversation-id"));

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
    sendMessage: wsSendMessage, // Note: No longer used - we send via HTTP instead
    sendTypingIndicator,
    loadHistory: wsLoadHistory,
    disconnect,
    setNonceUpdateCallback,
    setStatusChangeCallback,
  } = useWebSocket(config.baseUrl, config.organizationId);

  // Initialize message queue for offline/retry handling
  const messageQueue = useMessageQueue();

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

      // Create conversation via HTTP
      const conversationData = await conversation.createConversation(newKeypair.publicJwk);
      if (!conversationData) {
        throw new Error("Failed to create conversation");
      }

      // Store keypair and conversation data
      await storeKeypair(
        conversationData.id,
        newKeypair.privateKey,
        newKeypair.publicKey,
        newKeypair.publicJwk,
      );
      sessionStorage.setItem("hay-conversation-id", conversationData.id);

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

      // Get keypair from IndexedDB
      const storedKeypair = await getKeypair(convId);
      if (!storedKeypair) {
        console.log("[Webchat] No keypair found, clearing conversation");
        sessionStorage.removeItem("hay-conversation-id");
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
      sessionStorage.removeItem("hay-conversation-id");
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
      });

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

      // Generate or retrieve customer ID
      let storedCustomerId = localStorage.getItem("hay-customer-id");
      if (!storedCustomerId) {
        storedCustomerId = `anon_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        localStorage.setItem("hay-customer-id", storedCustomerId);
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
  setStatusChangeCallback((status: string, payload: any) => {
    console.log("[Webchat] Conversation status changed to:", status, payload);

    // Handle conversation closure
    if (status === "closed" || status === "resolved") {
      isConversationClosed.value = true;
      console.log("[Webchat] Conversation has been closed/resolved");
    }

    // Handle conversation reopening
    if (status === "open" && isConversationClosed.value) {
      isConversationClosed.value = false;
      console.log("[Webchat] Conversation has been reopened");
    }
  });

  // Retry loop for queued messages
  let retryTimer: ReturnType<typeof setInterval> | null = null;

  const startRetryLoop = () => {
    if (retryTimer) return;

    console.log("[MessageQueue] Starting retry loop");
    retryTimer = setInterval(async () => {
      // Skip if not initialized (we don't need WebSocket for HTTP sending)
      if (!isInitialized.value) return;

      const nextMessage = messageQueue.getNextRetry();
      if (nextMessage) {
        console.log("[MessageQueue] Retrying message:", nextMessage.id);

        try {
          // Try to send the message again via HTTP
          await sendMessageInternal(
            nextMessage.content,
            nextMessage.conversationId,
            0, // Don't increment retry count in sendMessage itself
          );

          // Success - remove from queue
          messageQueue.dequeue(nextMessage.id);
          console.log("[MessageQueue] Message sent successfully:", nextMessage.id);
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
      console.log("[MessageQueue] Retry loop stopped");
    }
  };

  // Periodic polling for new messages (fallback if WebSocket fails)
  let pollingTimer: ReturnType<typeof setInterval> | null = null;

  const startPolling = () => {
    if (pollingTimer) return;

    console.log("[Webchat] Starting message polling every 10 seconds");
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
      console.log("[Webchat] Message polling stopped");
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
      sessionStorage.setItem("hay-last-read-message-id", lastAgentMessage.id);
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
    sessionStorage.removeItem("hay-conversation-id");
    sessionStorage.removeItem("hay-last-read-message-id");
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
      console.log("[Webchat] New conversation started successfully");
    }
    return created;
  };

  // Refresh messages from server to ensure we have the complete conversation
  const refreshMessages = async () => {
    if (!conversationId.value || !keypair.value) {
      console.log("[Webchat] Cannot refresh messages: missing conversation or keypair");
      return;
    }

    try {
      console.log("[Webchat] Refreshing messages from server...");
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
        // Replace messages with fresh data from server
        loadMessagesIntoUI(messagesData.messages);
        console.log("[Webchat] Messages refreshed successfully:", messagesData.messages.length);
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
  const sendMessageInternal = async (
    text: string,
    convId: string,
    retryCount: number = 0,
  ): Promise<void> => {
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

    // Send via HTTP instead of WebSocket
    const result = await conversation.sendMessage(convId, text.trim(), proof, "POST", httpUrl);

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

      await sendMessageInternal(text.trim(), conversationId.value!, retryCount);

      // After successfully sending, refresh the conversation to get the complete message list
      // This ensures we have all messages including bot responses
      await refreshMessages();

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
