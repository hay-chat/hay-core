/**
 * @hay/server-sdk — Server-side SDK for attaching context and secrets to Hay conversations.
 *
 * Usage:
 *   import { Hay } from "@hay/server-sdk";
 *   const hay = new Hay({ apiKey: "hay_sk_...", organizationId: "...", baseUrl: "https://..." });
 *   await hay.conversations.addSecrets(conversationId, { auth: "user-token" });
 *   await hay.conversations.addContext(conversationId, { plan: "pro" });
 *   await hay.customers.addContext("ext_user_123", { name: "Alice", plan: "enterprise" });
 */

export interface HayConfig {
  apiKey: string;
  organizationId: string;
  baseUrl?: string;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

async function callEndpoint(
  baseUrl: string,
  apiKey: string,
  organizationId: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(`${baseUrl}/v1/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Organization-Id": organizationId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "(no body)");
    throw new Error(`[Hay SDK] ${path} failed (${res.status}): ${text}`);
  }
}

export class Hay {
  private baseUrl: string;
  private apiKey: string;
  private organizationId: string;

  constructor({ apiKey, organizationId, baseUrl = "https://app.hay.so" }: HayConfig) {
    this.apiKey = apiKey;
    this.organizationId = organizationId;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  conversations = {
    /**
     * Attach secrets to a conversation. Secrets are stored ephemerally in Redis
     * and are never sent to the LLM — they are injected into MCP tool calls only.
     */
    addSecrets: (conversationId: string, secrets: Record<string, string>): Promise<void> => {
      return callEndpoint(
        this.baseUrl,
        this.apiKey,
        this.organizationId,
        "conversations.addSecrets",
        {
          id: conversationId,
          secrets,
        },
      );
    },

    /**
     * Merge public context into a conversation. Context is stored in the database
     * and injected into the AI prompt on every turn.
     */
    addContext: (conversationId: string, context: Record<string, JsonValue>): Promise<void> => {
      return callEndpoint(
        this.baseUrl,
        this.apiKey,
        this.organizationId,
        "conversations.addContext",
        {
          id: conversationId,
          context,
        },
      );
    },
  };

  customers = {
    /**
     * Merge persistent public context into a customer by their external ID.
     * Context is loaded automatically on every new conversation for that customer.
     */
    addContext: (externalId: string, context: Record<string, JsonValue>): Promise<void> => {
      return callEndpoint(this.baseUrl, this.apiKey, this.organizationId, "customers.addContext", {
        externalId,
        context,
      });
    },
  };
}
