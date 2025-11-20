import type { HayChatConfig } from '@/types';

interface ConversationMetadata {
  source: string;
  url: string;
  referrer: string;
  userAgent: string;
  timestamp: string;
}

interface CreateConversationResponse {
  id: string;
  nonce: string;
  createdAt: string;
}

interface Message {
  id: string;
  content: string;
  type: string;
  createdAt: string;
  metadata?: {
    isClosureMessage?: boolean;
    [key: string]: unknown;
  };
}

interface GetMessagesResponse {
  messages: Message[];
  nonce: string;
  typing?: boolean;
  status?: string;
  isClosed?: boolean;
  error?: string;
}

interface SendMessageResponse {
  messageId: string | null;
  nonce: string;
  createdAt: string | null;
  error?: string;
  errorMessage?: string;
}

/**
 * Composable for HTTP communication with publicConversations endpoints
 */
export function useConversation(config: HayChatConfig) {
  const baseUrl = config.baseUrl;

  /**
   * Create a new conversation
   */
  const createConversation = async (
    publicJwk: JsonWebKey,
  ): Promise<CreateConversationResponse | null> => {
    try {
      const metadata: ConversationMetadata = {
        source: 'web-embed',
        url: window.location.href,
        referrer: document.referrer,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      };

      const response = await fetch(`${baseUrl}/v1/publicConversations.create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: config.organizationId,
          publicJwk,
          metadata,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.message || 'Failed to create conversation');
      }

      const data = await response.json();
      return data.result.data;
    } catch (error) {
      console.error('[Conversation] Failed to create conversation:', error);
      return null;
    }
  };

  /**
   * Load conversation message history
   */
  const getMessages = async (
    conversationId: string,
    proof: string,
    method: string,
    url: string,
    limit: number = 50,
  ): Promise<GetMessagesResponse | null> => {
    try {
      const response = await fetch(`${baseUrl}/v1/publicConversations.getMessages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId,
          proof,
          method,
          url,
          limit,
        }),
      });

      const data = await response.json();

      // Check if response is OK but contains nonce expiration error
      if (response.ok && data.result?.data?.error === 'NONCE_EXPIRED') {
        return {
          messages: [],
          nonce: data.result.data.nonce,
          error: 'NONCE_EXPIRED',
        };
      }

      if (!response.ok) {
        throw new Error('Failed to load messages');
      }

      return data.result.data;
    } catch (error) {
      console.error('[Conversation] Failed to load messages:', error);
      return null;
    }
  };

  /**
   * Send a message to a conversation
   */
  const sendMessage = async (
    conversationId: string,
    content: string,
    proof: string,
    method: string,
    url: string,
  ): Promise<SendMessageResponse | null> => {
    try {
      const response = await fetch(`${baseUrl}/v1/publicConversations.sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId,
          content,
          proof,
          method,
          url,
        }),
      });

      const data = await response.json();

      // Check if response is OK but contains nonce expiration error
      if (response.ok && data.result?.data?.error === 'NONCE_EXPIRED') {
        return {
          messageId: null,
          nonce: data.result.data.nonce,
          createdAt: null,
          error: 'NONCE_EXPIRED',
          errorMessage: data.result.data.errorMessage,
        };
      }

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      return data.result.data;
    } catch (error) {
      console.error('[Conversation] Failed to send message:', error);
      return null;
    }
  };

  return {
    createConversation,
    getMessages,
    sendMessage,
  };
}
