import { ref, onUnmounted } from "vue";
import {
  createAuthenticatedWebSocket,
  parseWebSocketMessage,
  type WebSocketMessage,
} from "@/utils/websocket";
import { useNotifications } from "@/composables/useNotifications";

type WebSocketEventHandler = (data: any) => void;

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
          events: ["conversation_status_changed", "message_received"],
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

      ws.value.onerror = (error) => {};
    } catch (error) {
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
    // Emit to registered event handlers
    const handlers = eventHandlers.get(message.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(message.payload);
        } catch (error) {}
      });
    } else {
      // Use debug level for unknown message types to reduce noise
    }

    // Handle built-in events
    switch (message.type) {
      case "conversation_status_changed":
        handleConversationStatusChanged(message.payload as any);
        break;

      case "conversation_taken_over":
        handleConversationTakenOver(message.payload as any);
        break;

      case "conversation_released":
        handleConversationReleased(message.payload as any);
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
  const handleConversationStatusChanged = async (payload: {
    conversationId: string;
    status: string;
    title?: string;
    customerName?: string;
  }) => {
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
  const handleConversationTakenOver = async (payload: {
    conversationId: string;
    userId: string;
    userName: string;
    previousOwnerId?: string;
  }) => {
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
  const handleConversationReleased = async (payload: {
    conversationId: string;
    newStatus: string;
    releasedBy: string;
    userName: string;
    returnToMode: "ai" | "queue";
  }) => {
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
    } else {
    }
  };

  /**
   * Register event handler
   */
  const on = (eventType: string, handler: WebSocketEventHandler) => {
    if (!eventHandlers.has(eventType)) {
      eventHandlers.set(eventType, new Set());
    }
    eventHandlers.get(eventType)!.add(handler);

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
