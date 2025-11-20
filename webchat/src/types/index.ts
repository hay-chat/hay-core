export interface HayChatConfig {
  organizationId: string;
  baseUrl: string;
  widgetTitle?: string;
  widgetSubtitle?: string;
  position?: 'left' | 'right';
  theme?: 'blue' | 'green' | 'purple' | 'black';
  showGreeting?: boolean;
  greetingMessage?: string;
}

export interface Message {
  id: string;
  content: string;
  sender: 'user' | 'agent';
  timestamp: number;
  metadata?: Record<string, unknown>;
  isGreeting?: boolean;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: unknown;
}

export interface IdentifyMessage extends WebSocketMessage {
  type: 'identify';
  customerId: string;
  conversationId?: string;
  metadata?: Record<string, unknown>;
}

export interface ChatMessage extends WebSocketMessage {
  type: 'message';
  text: string;
  attachments?: unknown[];
  timestamp?: number;
}

export interface TypingMessage extends WebSocketMessage {
  type: 'typing';
  isTyping: boolean;
}

export interface LoadHistoryMessage extends WebSocketMessage {
  type: 'load_history';
  conversationId: string;
  limit?: number;
  offset?: number;
}

declare global {
  interface Window {
    HayChat?: {
      config?: HayChatConfig;
    };
  }
}
