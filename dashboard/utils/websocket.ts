import { useAuthStore } from "@/stores/auth";
import { useUserStore } from "@/stores/user";

/**
 * Get the WebSocket URL based on the environment
 */
export function getWebSocketUrl(): string {
  if (typeof window !== "undefined") {
    // Client-side: use runtime config
    const config = useRuntimeConfig();
    // apiDomain is resolved from API_DOMAIN at BUILD time and comes out empty in a
    // Docker build. The WS server shares the API's origin, which in production is
    // the dashboard's own origin, so fall back to the page host and protocol.
    const apiDomain = config.public.apiDomain;
    if (!apiDomain) {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${window.location.host}/ws`;
    }
    const protocol = config.public.useSSL ? "wss" : "ws";
    return `${protocol}://${apiDomain}/ws`;
  }
  // Server-side fallback (shouldn't be used since SSR is disabled)
  return "ws://localhost:3001/ws";
}

/**
 * Create a WebSocket connection with authentication
 */
export function createAuthenticatedWebSocket(): WebSocket | null {
  const authStore = useAuthStore();
  const userStore = useUserStore();

  if (!authStore.isAuthenticated) {
    console.error("Cannot create WebSocket: User not authenticated");
    return null;
  }

  const wsUrl = getWebSocketUrl();
  const token = authStore.tokens?.accessToken;
  const organizationId = userStore.activeOrganization?.id;

  // Add authentication parameters to the WebSocket URL
  const url = new URL(wsUrl);
  if (token) {
    url.searchParams.append("token", token);
  }
  if (organizationId) {
    url.searchParams.append("org", organizationId);
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
  // Job-related fields
  jobId?: string;
  status?: string;
  progress?: Record<string, unknown>;
  result?: Record<string, unknown>;
}

/**
 * Parse WebSocket message
 */
export function parseWebSocketMessage(data: string): WebSocketMessage | null {
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error("Failed to parse WebSocket message:", error);
    return null;
  }
}
