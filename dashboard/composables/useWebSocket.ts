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
        console.error("Failed to create WebSocket connection");
        scheduleReconnect();
        return;
      }

      ws.value.onopen = () => {
        console.log("WebSocket connected");
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
        console.log("WebSocket disconnected");
        isConnected.value = false;
        scheduleReconnect();
      };

      ws.value.onerror = (error) => {
        console.error("WebSocket error:", error);
      };
    } catch (error) {
      console.error("WebSocket connection error:", error);
      scheduleReconnect();
    }
  };

  /**
   * Schedule reconnection attempt
   */
  const scheduleReconnect = () => {
    if (reconnectAttempts.value >= maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      return;
    }

    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.value), 30000);
    reconnectAttempts.value++;

    console.log(`Scheduling reconnect attempt ${reconnectAttempts.value} in ${delay}ms`);

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
        } catch (error) {
          console.error(`Error in WebSocket event handler for ${message.type}:`, error);
        }
      });
    }

    // Handle built-in events
    switch (message.type) {
      case "conversation_status_changed":
        handleConversationStatusChanged(message.payload as any);
        break;

      case "message_received":
        // Could handle new message notifications here
        break;

      case "connected":
        console.log("WebSocket connection confirmed:", message);
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
    console.log("Conversation status changed:", payload);

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
   * Send message to WebSocket server
   */
  const send = (message: Record<string, unknown>) => {
    if (ws.value?.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket not connected, cannot send message");
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
