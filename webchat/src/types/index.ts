export interface HayChatConfig {
  organizationId: string;
  baseUrl: string;
  /**
   * ePrivacy / consent mode.
   * - "strict": do not read/write cookies or web storage before the first user interaction.
   * - undefined: current default behavior.
   */
  consent?: "strict";
  widgetTitle?: string;
  widgetSubtitle?: string;
  position?: "left" | "right";
  theme?: "blue" | "green" | "purple" | "black";
  showGreeting?: boolean;
  greetingMessage?: string;
  /** Public context passed to the AI prompt. Safe for non-sensitive data only. */
  context?: Record<string, unknown>;
  /** External ID of the logged-in user in your system. Loads their stored customer context. */
  customerExternalId?: string;
  /** Locale for widget UI strings (e.g. "en-us", "pt-br", "fr-fr"). Auto-detected from browser if omitted. */
  locale?: string;
  /**
   * Called after a conversation is created. Use this to attach server-side secrets.
   * If it returns a Promise, the widget input waits until it resolves.
   */
  onConversationStarted?: (conversation: { id: string }) => void | Promise<void>;
  /** Agent name displayed in the header. Populated from public config. */
  agentName?: string;
  /** Agent avatar image URL (relative path). Falls back to organizationLogoUrl. */
  agentAvatarUrl?: string;
  /** Organization logo URL (relative path). Used as fallback for agent avatar. */
  organizationLogoUrl?: string;
}

export interface Message {
  id: string;
  content: string;
  sender: "user" | "agent";
  timestamp: number;
  metadata?: Record<string, unknown>;
  isGreeting?: boolean;
  /** Original message type from server (BotAgent, HumanAgent, Customer, etc.) */
  agentType?: string;
  /** Human agent name when message is from a HumanAgent */
  senderName?: string;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface IdentifyMessage extends WebSocketMessage {
  type: "identify";
  customerId: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage extends WebSocketMessage {
  type: "message";
  text: string;
  attachments?: unknown[];
  timestamp?: number;
}

export interface TypingMessage extends WebSocketMessage {
  type: "typing";
  isTyping: boolean;
}

export interface LoadHistoryMessage extends WebSocketMessage {
  type: "load_history";
  conversationId: string;
  limit?: number;
  offset?: number;
}

declare global {
  interface Window {
    HayChat?: {
      config?: HayChatConfig;
      addContext?: (key: string, value: unknown) => void;
    };
  }
}
