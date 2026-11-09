/**
 * Rules for an organization's own chat endpoint, shared by the settings route
 * (at save time) and the provider factory (for whatever is already stored).
 *
 * The managed key belongs to the managed endpoint: it is only ever used by an
 * OpenAI-compatible provider with no custom base URL. A custom base URL must be
 * https; `validateUrlForSSRF` and `ssrfPinnedFetch` cover where it resolves.
 *
 * @module services/llm/org-chat-endpoint
 */

import type { ChatProviderId } from "./provider.types";

export class OrgChatEndpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrgChatEndpointError";
  }
}

export function assertOrgChatEndpoint(chat: {
  provider: ChatProviderId;
  baseUrl?: string;
  hasOwnKey: boolean;
}): void {
  if (!chat.hasOwnKey && (chat.baseUrl || chat.provider !== "openai-compatible")) {
    throw new OrgChatEndpointError(
      chat.baseUrl
        ? "A custom base URL needs your own API key"
        : "This AI provider needs your own API key",
    );
  }
  if (chat.baseUrl && new URL(chat.baseUrl).protocol !== "https:") {
    throw new OrgChatEndpointError("The base URL must use https");
  }
}
