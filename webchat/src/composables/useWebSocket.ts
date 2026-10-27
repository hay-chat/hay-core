import { ref, onUnmounted } from "vue";
import { safeStorage } from "./useConsent";
import { debugLog } from "@/utils/debug";
import type { Message } from "@/types";
import { insertMessage, parseServerTime } from "@/utils/messageOrder";

export function useWebSocket(baseUrl: string, organizationId: string) {
  const ws = ref<WebSocket | null>(null);
  const isConnected = ref(false);
  const conversationId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const isTyping = ref(false);

  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  let statusChangeCallback: ((status: string, payload: any) => void) | null = null;

  const connect = (token?: string) => {
    const wsUrl = new URL("/ws", baseUrl.replace("http", "ws"));
    wsUrl.searchParams.set("org", organizationId);
    if (token) {
      wsUrl.searchParams.set("token", token);
    }

    ws.value = new WebSocket(wsUrl.toString());

    ws.value.onopen = () => {
      isConnected.value = true;
      reconnectAttempts = 0;
    };

    ws.value.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleMessage(data);
      } catch (error) {
        console.error("[Webchat] Failed to parse WebSocket message:", error);
      }
    };

    ws.value.onclose = () => {
      isConnected.value = false;
      attemptReconnect();
    };

    ws.value.onerror = (error) => {
      console.error("[Webchat] WebSocket error:", error);
    };
  };

  const attemptReconnect = () => {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error("[Webchat] Max reconnection attempts reached");
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;

    reconnectTimeout = setTimeout(() => {
      connect();
    }, delay);
  };

  const handleMessage = (data: any) => {
    switch (data.type) {
      case "connected":
        break;

      case "identified":
        conversationId.value = data.conversationId;
        safeStorage.session.setItem("hay-conversation-id", data.conversationId);
        break;

      case "message":
        if (data.data) {
          // Check if message already exists (prevent duplicates)
          // This handles both optimistically added messages and any other duplicates
          const messageExists = messages.value.some((m) => m.id === data.data.id);
          if (messageExists) {
            break;
          }

          // Only add messages from agents (BotAgent, HumanAgent, System)
          // Customer messages are already added optimistically when sent
          if (data.data.type === "Customer") {
            break;
          }

          addMessage({
            id: data.data.id || `msg_${Date.now()}`,
            sender: "agent",
            content: data.data.content || data.data.text || "",
            timestamp: parseServerTime(data.data.timestamp),
            metadata: data.data.metadata,
            agentType: data.data.type,
            senderName: data.data.sender || undefined,
          });

          // Clear typing indicator when agent message is received
          isTyping.value = false;
        }
        break;

      case "typing":
        isTyping.value = data.isTyping;
        break;

      case "conversation_status_changed":
        // Handle conversation status changes (closed, resolved, etc.)
        // Update typing indicator based on processing phase
        if (data.payload?.processingPhase) {
          isTyping.value = data.payload.processingPhase !== "idle";
        }

        if (data.payload && statusChangeCallback) {
          statusChangeCallback(data.payload.status, data.payload);
        }
        break;

      case "error":
        console.error("[Webchat] Server error:", data.error);
        break;

      default:
        debugLog("[Webchat] Unknown message type:", data.type);
    }
  };

  const addMessage = (message: Message) => {
    insertMessage(messages.value, message);
  };

  const identify = (customerId: string, existingConversationId?: string) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      console.error("[Webchat] WebSocket not connected");
      return;
    }

    ws.value.send(
      JSON.stringify({
        type: "identify",
        customerId,
        conversationId: existingConversationId,
        metadata: {
          userAgent: navigator.userAgent,
          timestamp: Date.now(),
        },
      }),
    );
  };

  const sendTypingIndicator = (isTypingValue: boolean) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.value.send(
      JSON.stringify({
        type: "typing",
        isTyping: isTypingValue,
      }),
    );
  };

  const setStatusChangeCallback = (callback: (status: string, payload: any) => void) => {
    statusChangeCallback = callback;
  };

  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (ws.value) {
      ws.value.close();
      ws.value = null;
    }

    isConnected.value = false;
  };

  // Clean up on unmount
  onUnmounted(() => {
    disconnect();
  });

  return {
    isConnected,
    conversationId,
    messages,
    isTyping,
    connect,
    identify,
    sendTypingIndicator,
    setStatusChangeCallback,
    disconnect,
  };
}
