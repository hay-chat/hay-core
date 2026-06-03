import { ref, onUnmounted } from "vue";
import {
  createAuthenticatedWebSocket,
  parseWebSocketMessage,
  type WebSocketMessage,
} from "@/utils/websocket";
import { useNotifications } from "@/composables/useNotifications";

type WebSocketEventHandler = (data: unknown) => void;

interface ConversationStatusChangedPayload {
  conversationId: string;
  status: string;
  title?: string;
  customerName?: string;
}

interface ConversationTakenOverPayload {
  conversationId: string;
  userId: string;
  userName: string;
  previousOwnerId?: string;
}

interface ConversationReleasedPayload {
  conversationId: string;
  newStatus: string;
  releasedBy: string;
  userName: string;
  returnToMode: "ai" | "queue";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isConversationStatusChangedPayload(
  value: unknown,
): value is ConversationStatusChangedPayload {
  return (
    isRecord(value) && typeof value.conversationId === "string" && typeof value.status === "string"
  );
}

function isConversationTakenOverPayload(value: unknown): value is ConversationTakenOverPayload {
  return (
    isRecord(value) &&
    typeof value.conversationId === "string" &&
    typeof value.userId === "string" &&
    typeof value.userName === "string"
  );
}

function isConversationReleasedPayload(value: unknown): value is ConversationReleasedPayload {
  return (
    isRecord(value) &&
    typeof value.conversationId === "string" &&
    typeof value.newStatus === "string" &&
    typeof value.releasedBy === "string" &&
    typeof value.userName === "string" &&
    (value.returnToMode === "ai" || value.returnToMode === "queue")
  );
}

const ws = ref<WebSocket | null>(null);
const isConnected = ref(false);
const reconnectAttempts = ref(0);
const maxReconnectAttempts = 5;
const eventHandlers = new Map<string, Set<WebSocketEventHandler>>();

let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

export function useWebSocket() {
  const notifications = useNotifications();

  /**
   * Connect to WebSocket server
   */
  const connect = () => {
    // Don't reconnect if already connected
    if (ws.value?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      ws.value = createAuthenticatedWebSocket();

      if (!ws.value) {
        scheduleReconnect();
        return;
      }

      ws.value.onopen = () => {
        isConnected.value = true;
        reconnectAttempts.value = 0;

        // Subscribe to organization-wide events
        send({
          type: "subscribe",
          events: [
            "conversation_status_changed",
            "message_received",
            "conversation_created",
            "conversation_updated",
            "conversation_deleted",
          ],
        });
      };

      ws.value.onmessage = (event) => {
        const message = parseWebSocketMessage(event.data);
        if (message) {
          handleMessage(message);
        }
      };

      ws.value.onclose = () => {
        isConnected.value = false;
        scheduleReconnect();
      };

      ws.value.onerror = () => {};
    } catch {
      scheduleReconnect();
    }
  };

  /**
   * Schedule reconnection attempt
   */
  const scheduleReconnect = () => {
    if (reconnectAttempts.value >= maxReconnectAttempts) {
      return;
    }

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.value), 30000);
    reconnectAttempts.value++;

    reconnectTimeout = setTimeout(() => {
      connect();
    }, delay);
  };

  /**
   * Handle incoming WebSocket message
   */
  const handleMessage = (message: WebSocketMessage) => {
    console.log("[Dashboard WebSocket] Received message:", message.type, message);

    // Emit to registered event handlers
    const handlers = eventHandlers.get(message.type);
    console.log(`[Dashboard WebSocket] Handlers for ${message.type}:`, handlers?.size || 0);

    if (handlers) {
      handlers.forEach((handler) => {
        try {
          console.log(`[Dashboard WebSocket] Calling handler for ${message.type}`);
          // For 'message' events, the payload is in message.data, for others it's in message.payload
          const payload = message.type === "message" ? message : message.payload;
          handler(payload);
        } catch (error) {
          console.error(`[Dashboard WebSocket] Handler error for ${message.type}:`, error);
        }
      });
    } else {
      console.log(`[Dashboard WebSocket] No handlers registered for ${message.type}`);
      // Use debug level for unknown message types to reduce noise
    }

    // Handle built-in events
    switch (message.type) {
      case "conversation_status_changed":
        if (isConversationStatusChangedPayload(message.payload)) {
          handleConversationStatusChanged(message.payload);
        }
        break;

      case "conversation_taken_over":
        if (isConversationTakenOverPayload(message.payload)) {
          handleConversationTakenOver(message.payload);
        }
        break;

      case "conversation_released":
        if (isConversationReleasedPayload(message.payload)) {
          handleConversationReleased(message.payload);
        }
        break;

      case "message_received":
        // Could handle new message notifications here
        break;

      case "connected":
        break;

      default:
        // Unknown message type, ignore or log
        break;
    }
  };

  /**
   * Handle conversation status change event
   */
  const handleConversationStatusChanged = async (payload: ConversationStatusChangedPayload) => {
    // Show notification if conversation needs human attention
    if (payload.status === "pending-human") {
      await notifications.notifyConversationNeedsAttention({
        id: payload.conversationId,
        title: payload.title,
        customerName: payload.customerName,
      });
    }
  };

  /**
   * Handle conversation taken over event
   */
  const handleConversationTakenOver = async (payload: ConversationTakenOverPayload) => {
    // Get current user from user store
    const { useUserStore } = await import("@/stores/user");
    const userStore = useUserStore();
    const currentUserId = userStore.user?.id;

    // If the previous owner was the current user, show notification
    if (payload.previousOwnerId === currentUserId) {
      const { useToast } = await import("@/composables/useToast");
      const toast = useToast();
      toast.warning(
        "Conversation Taken Over",
        `${payload.userName} has taken over the conversation you were handling`,
        10000,
      );
    }
  };

  /**
   * Handle conversation released event
   */
  const handleConversationReleased = async (payload: ConversationReleasedPayload) => {
    // If released back to queue, notify available agents
    if (payload.returnToMode === "queue" && payload.newStatus === "pending-human") {
      const { useToast } = await import("@/composables/useToast");
      const toast = useToast();
      toast.info(
        "Conversation Available",
        `${payload.userName} returned a conversation to the queue`,
        5000,
      );
    }
  };

  /**
   * Send message to WebSocket server
   */
  const send = (message: Record<string, unknown>) => {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(message));
    }
  };

  /**
   * Register event handler
   */
  const on = (eventType: string, handler: WebSocketEventHandler) => {
    console.log(`[Dashboard WebSocket] Registering handler for event: ${eventType}`);
    if (!eventHandlers.has(eventType)) {
      eventHandlers.set(eventType, new Set());
    }
    eventHandlers.get(eventType)!.add(handler);
    console.log(
      `[Dashboard WebSocket] Total handlers for ${eventType}:`,
      eventHandlers.get(eventType)!.size,
    );

    // Return unsubscribe function
    return () => {
      off(eventType, handler);
    };
  };

  /**
   * Unregister event handler
   */
  const off = (eventType: string, handler: WebSocketEventHandler) => {
    const handlers = eventHandlers.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        eventHandlers.delete(eventType);
      }
    }
  };

  /**
   * Disconnect WebSocket
   */
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
    reconnectAttempts.value = 0;
  };

  /**
   * Cleanup on unmount
   */
  onUnmounted(() => {
    disconnect();
  });

  return {
    isConnected,
    connect,
    disconnect,
    send,
    on,
    off,
  };
}
