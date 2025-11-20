import { ref, onUnmounted } from 'vue';
import type { Message } from '@/types';

export function useWebSocket(baseUrl: string, organizationId: string) {
  const ws = ref<WebSocket | null>(null);
  const isConnected = ref(false);
  const conversationId = ref<string | null>(null);
  const messages = ref<Message[]>([]);
  const isTyping = ref(false);

  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  let nonceUpdateCallback: ((nonce: string) => void) | null = null;
  let statusChangeCallback: ((status: string, payload: any) => void) | null = null;
  let pendingMessageResolver: {
    resolve: (value: boolean) => void;
    reject: (error: any) => void;
    timeout: ReturnType<typeof setTimeout>;
  } | null = null;

  const connect = (token?: string) => {
    const wsUrl = new URL('/ws', baseUrl.replace('http', 'ws'));
    wsUrl.searchParams.set('org', organizationId);
    if (token) {
      wsUrl.searchParams.set('token', token);
    }

    ws.value = new WebSocket(wsUrl.toString());

    ws.value.onopen = () => {
      console.log('[Webchat] WebSocket connected');
      isConnected.value = true;
      reconnectAttempts = 0;
    };

    ws.value.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[Webchat] Received WebSocket message:', data.type, data);
        handleMessage(data);
      } catch (error) {
        console.error('[Webchat] Failed to parse WebSocket message:', error);
      }
    };

    ws.value.onclose = () => {
      console.log('[Webchat] WebSocket disconnected');
      isConnected.value = false;
      attemptReconnect();
    };

    ws.value.onerror = (error) => {
      console.error('[Webchat] WebSocket error:', error);
    };
  };

  const attemptReconnect = () => {
    if (reconnectAttempts >= maxReconnectAttempts) {
      console.error('[Webchat] Max reconnection attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
    reconnectAttempts++;

    console.log(`[Webchat] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
    reconnectTimeout = setTimeout(() => {
      connect();
    }, delay);
  };

  const handleMessage = (data: any) => {
    switch (data.type) {
      case 'connected':
        console.log('[Webchat] Connected with client ID:', data.clientId);
        break;

      case 'identified':
        conversationId.value = data.conversationId;
        sessionStorage.setItem('hay-conversation-id', data.conversationId);
        console.log('[Webchat] Identified with conversation:', data.conversationId);
        break;

      case 'message':
        if (data.data) {
          // Check if message already exists (prevent duplicates)
          // This handles both optimistically added messages and any other duplicates
          const messageExists = messages.value.some((m) => m.id === data.data.id);
          if (messageExists) {
            console.log('[Webchat] Skipping duplicate message:', data.data.id);
            break;
          }

          // Only add messages from agents (BotAgent, HumanAgent, System)
          // Customer messages are already added optimistically when sent
          if (data.data.type === 'Customer') {
            console.log('[Webchat] Skipping customer message (already shown optimistically)');
            break;
          }

          addMessage({
            id: data.data.id || `msg_${Date.now()}`,
            sender: 'agent',
            content: data.data.content || data.data.text,
            timestamp: new Date(data.data.timestamp || Date.now()).getTime(),
            metadata: data.data.metadata,
          });
        }
        break;

      case 'message_sent':
        // Message was successfully sent, handle nonce update
        console.log('[Webchat] Message sent successfully');
        if (data.nonce && nonceUpdateCallback) {
          nonceUpdateCallback(data.nonce);
        }

        // Resolve pending message promise
        if (pendingMessageResolver) {
          clearTimeout(pendingMessageResolver.timeout);
          pendingMessageResolver.resolve(true);
          pendingMessageResolver = null;
        }
        break;

      case 'typing':
        isTyping.value = data.isTyping;
        break;

      case 'conversation_status_changed':
        // Handle conversation status changes (closed, resolved, etc.)
        console.log('[Webchat] Conversation status changed:', data.payload);
        if (data.payload && statusChangeCallback) {
          statusChangeCallback(data.payload.status, data.payload);
        }
        break;

      case 'history':
        if (Array.isArray(data.messages)) {
          messages.value = data.messages.map((msg: any) => ({
            id: msg.id || `msg_${Date.now()}`,
            sender: msg.sender,
            content: msg.content || msg.text,
            timestamp: new Date(msg.timestamp).getTime(),
            metadata: msg.metadata,
          }));
        }
        break;

      case 'error':
        console.error('[Webchat] Server error:', data.error);

        // Reject pending message if any
        if (pendingMessageResolver) {
          clearTimeout(pendingMessageResolver.timeout);

          // Handle NONCE_EXPIRED error
          if (data.error === 'NONCE_EXPIRED' && data.nonce && nonceUpdateCallback) {
            nonceUpdateCallback(data.nonce);
            pendingMessageResolver.reject({
              message: 'NONCE_EXPIRED',
              nonce: data.nonce,
            });
          } else {
            // Other errors
            pendingMessageResolver.reject(new Error(data.error));
          }

          pendingMessageResolver = null;
        }
        break;

      default:
        console.log('[Webchat] Unknown message type:', data.type);
    }
  };

  const addMessage = (message: Message) => {
    messages.value.push(message);
  };

  const identify = (customerId: string, existingConversationId?: string) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      console.error('[Webchat] WebSocket not connected');
      return;
    }

    ws.value.send(
      JSON.stringify({
        type: 'identify',
        customerId,
        conversationId: existingConversationId,
        metadata: {
          userAgent: navigator.userAgent,
          timestamp: Date.now(),
        },
      })
    );
  };

  const sendMessage = (
    text: string,
    proof: string,
    method: string,
    url: string,
    convId: string,
  ): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
        console.error('[Webchat] WebSocket not connected');
        reject(new Error('WebSocket not connected'));
        return;
      }

      // Clear any existing pending resolver
      if (pendingMessageResolver) {
        clearTimeout(pendingMessageResolver.timeout);
        pendingMessageResolver.reject(new Error('Message superseded by new message'));
      }

      // Create timeout
      const timeout = setTimeout(() => {
        if (pendingMessageResolver) {
          pendingMessageResolver = null;
          reject(new Error('Message send timeout'));
        }
      }, 10000);

      // Store resolver
      pendingMessageResolver = { resolve, reject, timeout };

      // Send to server with DPoP proof
      const payload = {
        type: 'message',
        content: text,
        proof,
        method,
        url,
        conversationId: convId,
        timestamp: Date.now(),
      };

      console.log('[Webchat] Sending message with payload:', {
        type: payload.type,
        content: payload.content,
        method: payload.method,
        url: payload.url,
        conversationId: payload.conversationId,
        proofLength: payload.proof.length,
      });

      ws.value.send(JSON.stringify(payload));
    });
  };

  const sendTypingIndicator = (isTypingValue: boolean) => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.value.send(
      JSON.stringify({
        type: 'typing',
        isTyping: isTypingValue,
      })
    );
  };

  const loadHistory = () => {
    if (!ws.value || ws.value.readyState !== WebSocket.OPEN || !conversationId.value) {
      return;
    }

    ws.value.send(
      JSON.stringify({
        type: 'load_history',
        conversationId: conversationId.value,
      })
    );
  };

  const setNonceUpdateCallback = (callback: (nonce: string) => void) => {
    nonceUpdateCallback = callback;
  };

  const setStatusChangeCallback = (callback: (status: string, payload: any) => void) => {
    statusChangeCallback = callback;
  };

  const disconnect = () => {
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout);
      reconnectTimeout = null;
    }

    if (pendingMessageResolver) {
      clearTimeout(pendingMessageResolver.timeout);
      pendingMessageResolver.reject(new Error('WebSocket disconnected'));
      pendingMessageResolver = null;
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
    sendMessage,
    sendTypingIndicator,
    loadHistory,
    setNonceUpdateCallback,
    setStatusChangeCallback,
    disconnect,
  };
}
