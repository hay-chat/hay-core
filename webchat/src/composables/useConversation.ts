import type { Attachment, HayChatConfig } from "@/types";
import { resolveLocale } from "@/i18n/resolve";
import type { FormResponse, FormSchema } from "@hay/form-schema";

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
  attachments?: Attachment[];
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

interface SendAttachmentResponse {
  messageId: string | null;
  nonce: string;
  createdAt: string | null;
  attachment: Attachment | null;
  error?: string | null;
}

interface SendMessageResponse {
  messageId: string | null;
  nonce: string;
  createdAt: string | null;
  error?: string;
  errorMessage?: string;
}

/**
 * The server answered with an HTTP error. A 4xx means the request was refused
 * (rate limited, website not allowed, message too long, ...) and retrying the
 * same request automatically will not help.
 */
export class WidgetRequestError extends Error {
  constructor(
    public readonly status: number,
    /** Machine-readable refusal code from the server, when it sent one. */
    public readonly code: string | null = null,
  ) {
    super(`Request refused with HTTP ${status}`);
    this.name = "WidgetRequestError";
  }

  /** A bot check (challenge) refused the request. */
  get isVerificationFailure(): boolean {
    return this.status === 403 && this.code === "VERIFICATION_FAILED";
  }

  get isRefusal(): boolean {
    return this.status >= 400 && this.status < 500;
  }
}

/** The tRPC error message of a refused request, used as a machine-readable code. */
async function refusalCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } };
    return typeof body?.error?.message === "string" ? body.error.message : null;
  } catch {
    return null;
  }
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
    context?: Record<string, unknown>,
    customer?: { externalId?: string; signature?: string },
    challenge?: { token?: string; error?: string },
    preChatForm?: { schema: FormSchema; response: FormResponse },
  ): Promise<CreateConversationResponse> => {
    const metadata: ConversationMetadata = {
      source: "web-embed",
      url: window.location.href,
      referrer: document.referrer,
      userAgent: navigator.userAgent,
      timestamp: new Date().toISOString(),
    };

    const response = await fetch(`${baseUrl}/v1/publicConversations.create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        organizationId: config.organizationId,
        publicJwk,
        metadata,
        // Same locale the widget UI uses, so the server greeting matches it.
        language: resolveLocale(config.locale),
        ...(context && Object.keys(context).length > 0 ? { context } : {}),
        ...(customer?.externalId ? { customerExternalId: customer.externalId } : {}),
        ...(customer?.externalId && customer.signature
          ? { customerExternalIdSignature: customer.signature }
          : {}),
        ...(challenge?.token ? { challengeToken: challenge.token } : {}),
        ...(challenge?.error ? { challengeError: challenge.error } : {}),
        ...(preChatForm ? { preChatForm } : {}),
      }),
    });

    if (!response.ok) {
      throw new WidgetRequestError(response.status, await refusalCode(response));
    }

    const data = await response.json();
    return data.result.data;
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
        method: "POST",
        headers: {
          "Content-Type": "application/json",
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
      if (response.ok && data.result?.data?.error === "NONCE_EXPIRED") {
        return {
          messages: [],
          nonce: data.result.data.nonce,
          error: "NONCE_EXPIRED",
        };
      }

      if (!response.ok) {
        throw new Error("Failed to load messages");
      }

      return data.result.data;
    } catch (error) {
      console.error("[Conversation] Failed to load messages:", error);
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
    context?: Record<string, unknown>,
  ): Promise<SendMessageResponse> => {
    const response = await fetch(`${baseUrl}/v1/publicConversations.sendMessage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        conversationId,
        content,
        proof,
        method,
        url,
        ...(context && Object.keys(context).length > 0 ? { context } : {}),
      }),
    });

    if (!response.ok) {
      throw new WidgetRequestError(response.status, await refusalCode(response));
    }

    const data = await response.json();

    // OK response that carries a nonce expiration error
    if (data.result?.data?.error === "NONCE_EXPIRED") {
      return {
        messageId: null,
        nonce: data.result.data.nonce,
        createdAt: null,
        error: "NONCE_EXPIRED",
        errorMessage: data.result.data.errorMessage,
      };
    }

    return data.result.data;
  };

  /**
   * Send a photo or PDF, with an optional caption (D8-9). The file goes as
   * base64 in the JSON body, like every other public call.
   */
  const sendAttachment = async (params: {
    conversationId: string;
    data: string;
    mimeType: string;
    filename: string;
    caption?: string;
    proof: string;
    method: string;
    url: string;
    context?: Record<string, unknown>;
  }): Promise<SendAttachmentResponse> => {
    const { context, caption, ...rest } = params;
    const response = await fetch(`${baseUrl}/v1/publicConversations.sendAttachment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...rest,
        ...(caption ? { caption } : {}),
        ...(context && Object.keys(context).length > 0 ? { context } : {}),
      }),
    });
    if (!response.ok) {
      throw new WidgetRequestError(response.status);
    }
    const data = await response.json();
    return data.result.data;
  };

  /**
   * Leave an email for the team's reply (D5-8). Resolves to the server answer,
   * which may carry NONCE_EXPIRED with a fresh nonce.
   */
  const setContactEmail = async (
    conversationId: string,
    email: string,
    proof: string,
    method: string,
    url: string,
  ): Promise<{ saved: boolean; nonce?: string; error: string | null }> => {
    const response = await fetch(`${baseUrl}/v1/publicConversations.setContactEmail`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, email, proof, method, url }),
    });
    if (!response.ok) {
      throw new WidgetRequestError(response.status);
    }
    const data = await response.json();
    return data.result.data;
  };

  /**
   * Submit a response to an in-conversation FORM message
   */
  const submitFormMessage = async (
    conversationId: string,
    messageId: string,
    response: FormResponse,
    proof: string,
    method: string,
    url: string,
  ): Promise<{ messageId: string; nonce: string; submittedAt: string } | null> => {
    try {
      const res = await fetch(`${baseUrl}/v1/publicConversations.submitForm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          messageId,
          response,
          proof,
          method,
          url,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error?.message || "Failed to submit form");
      }
      return data.result.data;
    } catch (error) {
      console.error("[Conversation] Failed to submit form:", error);
      return null;
    }
  };

  return {
    createConversation,
    getMessages,
    sendMessage,
    sendAttachment,
    setContactEmail,
    submitFormMessage,
  };
}
