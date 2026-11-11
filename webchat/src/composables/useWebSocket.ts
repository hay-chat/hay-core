import { ref, onUnmounted } from "vue";
import { safeStorage } from "./useConsent";
import { debugLog } from "@/utils/debug";
import type { Message } from "@/types";
import type { PageToolDescriptor } from "./usePageTools";
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
  let toolCallCallback: ((call: PageToolCall) => void) | null = null;

  // The identify proof is signed for the socket endpoint itself (no query).
  const socketUrl = new URL("/ws", baseUrl.replace("http", "ws")).toString();
  // The last identify, replayed with a fresh proof when the socket reconnects.
  let identity: {
    conversationId: string;
    createProof: IdentifyProofFactory;
    tools?: PageToolDescriptor[];
    storeCart?: boolean;
  } | null = null;

  const connect = () => {
    const wsUrl = new URL(socketUrl);
    wsUrl.searchParams.set("org", organizationId);

    ws.value = new WebSocket(wsUrl.toString());

    ws.value.onopen = () => {
      isConnected.value = true;
      reconnectAttempts = 0;
      if (identity) void sendIdentify();
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
            attachments: Array.isArray(data.data.attachments) ? data.data.attachments : [],
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

      case "tool_call":
        // The AI wants a page tool run here; useChat executes it and answers.
        if (typeof data.callId === "string" && typeof data.name === "string" && toolCallCallback) {
          toolCallCallback({
            callId: data.callId,
            name: data.name,
            args: data.args && typeof data.args === "object" ? data.args : {},
            ...(data.builtin === true ? { builtin: true } : {}),
          });
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

  /**
   * Attach the socket to a conversation. The server only streams a
   * conversation to a socket that proves it holds the conversation's DPoP key,
   * so `createProof` signs a proof for the socket URL.
   */
  const identify = async (
    existingConversationId: string,
    createProof: IdentifyProofFactory,
    tools?: PageToolDescriptor[],
    storeCart = false,
  ) => {
    identity = { conversationId: existingConversationId, createProof, tools, storeCart };
    await sendIdentify();
  };

  const sendIdentify = async () => {
    if (!identity) return;
    const socket = ws.value;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.error("[Webchat] WebSocket not connected");
      return;
    }

    const { conversationId: convId, createProof, tools, storeCart } = identity;
    let proof: string;
    try {
      proof = await createProof(socketUrl);
    } catch (error) {
      console.error("[Webchat] Could not sign the socket identify:", error);
      return;
    }
    if (socket.readyState !== WebSocket.OPEN) return;

    socket.send(
      JSON.stringify({
        type: "identify",
        conversationId: convId,
        proof,
        // Page tools (WebMCP) the host page registered, if any.
        ...(tools && tools.length > 0 ? { tools } : {}),
        // This build can run the store's cart requests (cart@1) on this page.
        ...(storeCart ? { storeCart: true } : {}),
      }),
    );
  };

  /** The page's tool list changed after identify: send the whole list again. */
  const sendTools = (tools: PageToolDescriptor[]) => {
    if (identity) identity.tools = tools;
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return;
    ws.value.send(JSON.stringify({ type: "register_tools", tools }));
  };

  const sendToolResult = (callId: string, outcome: { result?: unknown; error?: string }) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) return;
    ws.value.send(JSON.stringify({ type: "tool_result", callId, ...outcome }));
  };

  const setToolCallHandler = (callback: (call: PageToolCall) => void) => {
    toolCallCallback = callback;
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
    identity = null;
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
    sendTools,
    sendToolResult,
    setStatusChangeCallback,
    setToolCallHandler,
    disconnect,
  };
}

/** Signs a DPoP proof (method GET) for the given socket URL. */
export type IdentifyProofFactory = (url: string) => Promise<string>;

/** A `tool_call` frame: the AI asked for page tool `name` with `args`. */
export interface PageToolCall {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /** A store action the widget runs itself (add to cart), not a tool the page registered. */
  builtin?: boolean;
}
