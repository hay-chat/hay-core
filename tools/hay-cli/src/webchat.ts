/**
 * Talks to the public webchat endpoints exactly like the widget does, so a CLI
 * message goes through the same path (rate limits, gates, orchestrator queue).
 */
import { HayApiError, type HayApi } from "./api";
import { loadConversationKeys, saveConversationKeys, type ConversationKeys } from "./config";
import { createProof, generateKeyPair } from "./dpop";
import { normalizeMessage, sortMessages, type Msg } from "./format";

interface NonceResult {
  nonce?: string | null;
  error?: string | null;
}

export interface WidgetMessages {
  messages: Msg[];
  typing: boolean;
  status: string;
}

export class WebchatClient {
  constructor(
    private api: HayApi,
    private target: string,
  ) {}

  async createConversation(organizationId: string, language?: string): Promise<string> {
    const keys = await generateKeyPair();
    const created = await this.api.mutation<{ id: string; nonce: string }>(
      "publicConversations.create",
      {
        organizationId,
        publicJwk: keys.publicJwk,
        metadata: { source: "hay-cli", timestamp: new Date().toISOString() },
        ...(language ? { language } : {}),
      },
      { auth: false },
    );
    saveConversationKeys(created.id, {
      target: this.target,
      organizationId,
      ...keys,
      nonce: created.nonce,
      createdAt: new Date().toISOString(),
    });
    return created.id;
  }

  async sendMessage(conversationId: string, content: string): Promise<{ messageId: string }> {
    const result = await this.withProof<NonceResult & { messageId: string | null }>(
      conversationId,
      "sendMessage",
      (proof) => ({ conversationId, content, ...proof }),
    );
    return { messageId: result.messageId! };
  }

  async getMessages(conversationId: string): Promise<WidgetMessages> {
    const result = await this.withProof<
      NonceResult & { messages: Array<Record<string, unknown>>; typing?: boolean; status?: string }
    >(conversationId, "getMessages", (proof) => ({ conversationId, limit: 200, ...proof }));
    return {
      messages: sortMessages(result.messages.map(normalizeMessage)),
      typing: !!result.typing,
      status: result.status ?? "unknown",
    };
  }

  private keysFor(conversationId: string): ConversationKeys {
    const keys = loadConversationKeys(conversationId);
    if (!keys) {
      throw new Error(
        `No webchat key for conversation ${conversationId}: only conversations started by this CLI can be continued`,
      );
    }
    if (keys.target !== this.target) {
      throw new Error(`Conversation ${conversationId} belongs to target "${keys.target}"`);
    }
    return keys;
  }

  /**
   * Sign a DPoP proof for the procedure, call it, and store the rotated nonce.
   * An expired nonce comes back as a normal result with a fresh nonce: retry once.
   */
  private async withProof<T extends NonceResult>(
    conversationId: string,
    procedure: string,
    buildInput: (proof: { proof: string; method: string; url: string }) => unknown,
  ): Promise<T> {
    const keys = this.keysFor(conversationId);
    const url = `${this.api.baseUrl}/v1/publicConversations.${procedure}`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const proof = await createProof(keys, "POST", url, keys.nonce);
      const result = await this.api.mutation<T>(
        `publicConversations.${procedure}`,
        buildInput({ proof, method: "POST", url }),
        { auth: false },
      );
      if (result.nonce) {
        keys.nonce = result.nonce;
        saveConversationKeys(conversationId, keys);
      }
      if (result.error !== "NONCE_EXPIRED") return result;
    }
    throw new HayApiError(
      `publicConversations.${procedure}`,
      "NONCE_EXPIRED",
      "nonce rejected twice",
      200,
    );
  }
}
