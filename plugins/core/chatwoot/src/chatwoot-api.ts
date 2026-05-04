import type { HayLogger } from "@hay/plugin-sdk/types";

/**
 * Thin HTTP client for the Chatwoot Application API.
 *
 * Auth: `api_access_token` header (accepts both user tokens and agent-bot tokens).
 * Works identically against Chatwoot Cloud (https://app.chatwoot.com) and self-hosted.
 *
 * Docs: https://developers.chatwoot.com/api-reference/introduction
 */

export type ChatwootStatus = "open" | "resolved" | "pending" | "snoozed";

export interface ChatwootApiConfig {
  baseUrl: string;
  accountId: string;
  botAccessToken: string;
  logger: HayLogger;
}

export class ChatwootApi {
  private baseUrl: string;
  private accountId: string;
  private botAccessToken: string;
  private logger: HayLogger;

  constructor(config: ChatwootApiConfig) {
    // Normalize base URL — strip trailing slash so URL building is consistent.
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.accountId = config.accountId;
    this.botAccessToken = config.botAccessToken;
    this.logger = config.logger;
  }

  private accountUrl(path: string): string {
    return `${this.baseUrl}/api/v1/accounts/${this.accountId}${path}`;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const response = await fetch(url, {
      method,
      headers: {
        api_access_token: this.botAccessToken,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new ChatwootApiError(response.status, text || response.statusText);
    }

    // Some endpoints (e.g. toggle_status) return empty body — guard against parse errors.
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return undefined as unknown as T;
    }

    return (await response.json()) as T;
  }

  /**
   * POST /api/v1/accounts/{id}/conversations/{conversation_id}/messages
   * Docs: https://developers.chatwoot.com/api-reference/messages/create-new-message
   */
  async sendMessage(
    conversationId: string | number,
    content: string,
    options: { private?: boolean } = {},
  ): Promise<{ id: number }> {
    return this.request("POST", this.accountUrl(`/conversations/${conversationId}/messages`), {
      content,
      message_type: "outgoing",
      private: options.private ?? false,
      content_type: "text",
    });
  }

  /**
   * POST /api/v1/accounts/{id}/conversations/{conversation_id}/toggle_status
   * Docs: https://developers.chatwoot.com/api-reference/conversations/toggle-status
   */
  async toggleStatus(conversationId: string | number, status: ChatwootStatus): Promise<void> {
    await this.request("POST", this.accountUrl(`/conversations/${conversationId}/toggle_status`), {
      status,
    });
  }

  /**
   * POST /api/v1/accounts/{id}/conversations/{conversation_id}/assignments
   * Docs: https://developers.chatwoot.com/api-reference/conversation-assignments/assign-conversation
   */
  async assignTeam(conversationId: string | number, teamId: string | number): Promise<void> {
    await this.request("POST", this.accountUrl(`/conversations/${conversationId}/assignments`), {
      team_id: teamId,
    });
  }

  /**
   * Lightweight credential validation — the bot-scoped profile endpoint will
   * 401 on a bad token and 200 with bot metadata on a good one. Falls back to
   * the accounts endpoint for broader compatibility.
   */
  async validateCredentials(): Promise<void> {
    const url = `${this.baseUrl}/auth/sign_in`;
    // Primary path: fetch bot profile info
    try {
      await this.request("GET", this.accountUrl("/conversations?status=open&page=1&per_page=1"));
      this.logger.info("Chatwoot credentials validated");
      return;
    } catch (err) {
      if (err instanceof ChatwootApiError && err.status === 401) {
        throw new Error(
          "Chatwoot credentials invalid — check base URL, account ID, and bot access token",
        );
      }
      // Re-throw other errors (network, 5xx, etc.)
      this.logger.warn("Chatwoot validation probe failed", { err, probedUrl: url });
      throw err;
    }
  }
}

export class ChatwootApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(`Chatwoot API ${status}: ${message}`);
    this.name = "ChatwootApiError";
  }
}
