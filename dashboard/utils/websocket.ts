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
 * Create a WebSocket connection with authentication.
 *
 * The access token goes in the first frame rather than the URL, so it never
 * lands in proxy or server access logs. The listener is added before callers
 * set `onopen`, so the auth frame always goes out first.
 */
export function createAuthenticatedWebSocket(): WebSocket | null {
  const authStore = useAuthStore();
  const userStore = useUserStore();

  const token = authStore.tokens?.accessToken;
  if (!authStore.isAuthenticated || !token) {
    return null;
  }

  const url = new URL(getWebSocketUrl());
  const organizationId = userStore.activeOrganization?.id;
  if (organizationId) {
    url.searchParams.append("org", organizationId);
  }

  const socket = new WebSocket(url.toString());
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "auth", token }));
  });
  return socket;
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
