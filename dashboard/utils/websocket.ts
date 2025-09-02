import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

/**
 * Get the WebSocket URL based on the environment
 */
export function getWebSocketUrl(): string {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    return 'wss://ws.hay.chat/ws';
  } else {
    // In development, use localhost with the WebSocket port
    return 'ws://localhost:3002/ws';
  }
}

/**
 * Create a WebSocket connection with authentication
 */
export function createAuthenticatedWebSocket(): WebSocket | null {
  const authStore = useAuthStore();
  const userStore = useUserStore();
  
  if (!authStore.isAuthenticated) {
    console.error('Cannot create WebSocket: User not authenticated');
    return null;
  }
  
  const wsUrl = getWebSocketUrl();
  const token = authStore.tokens?.accessToken;
  const organizationId = userStore.activeOrganization?.id;
  
  // Add authentication parameters to the WebSocket URL
  const url = new URL(wsUrl);
  if (token) {
    url.searchParams.append('token', token);
  }
  if (organizationId) {
    url.searchParams.append('org', organizationId);
  }
  
  return new WebSocket(url.toString());
}

/**
 * WebSocket message types
 */
export interface WebSocketMessage {
  type: string;
  payload?: unknown;
  error?: string;
  conversationId?: string;
  clientId?: string;
}

/**
 * Parse WebSocket message
 */
export function parseWebSocketMessage(data: string): WebSocketMessage | null {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error('Failed to parse WebSocket message:', error);
    return null;
  }
}