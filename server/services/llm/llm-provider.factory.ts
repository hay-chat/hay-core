/**
 * LLM provider factory.
 *
 * Resolves which chat + embedding providers (and tier→model map) an organization
 * uses. Mirrors the git-connection provider registry and the config-resolver
 * precedence (DB → env → default).
 *
 * Slice 1 scope: org resolution is a stub — `forOrganization` ignores the orgId and
 * always returns the default env bundle, which reproduces today's exact behavior
 * (OpenAI, gpt-4o/gpt-4o-mini/gpt-4.1-nano, text-embedding-3-small @ 1536). Per-org
 * DB config + BYO key decryption + caching land in Slice 5.
 *
 * @module services/llm/llm-provider.factory
 */

import { config } from "@server/config/env";
import { OpenAICompatibleProvider } from "./openai-compatible.provider";
import type { ChatProvider, EmbeddingProvider, TierModelMap } from "./provider.types";

export interface ResolvedLlmBundle {
  chat: ChatProvider;
  embedding: EmbeddingProvider;
  tiers: TierModelMap;
}

/** Today's hardcoded models, now overridable by env. gpt-4o stays the `hard` default. */
const DEFAULT_TIERS: TierModelMap = {
  hard: process.env.LLM_TIER_HARD || process.env.OPENAI_CHAT_MODEL || "gpt-4o",
  medium: process.env.LLM_TIER_MEDIUM || "gpt-4o-mini",
  easy: process.env.LLM_TIER_EASY || "gpt-4.1-nano",
};

class LLMProviderFactory {
  private defaultBundle: ResolvedLlmBundle | undefined;

  /**
   * Resolve the provider bundle for an organization.
   * @param _organizationId - resolved per-org in Slice 5; ignored for now.
   */
  forOrganization(_organizationId?: string): ResolvedLlmBundle {
    if (!this.defaultBundle) {
      // A single OpenAI-compatible provider serves both chat and managed embeddings
      // on the default bundle (same key, same endpoint) — exactly as today.
      const provider = new OpenAICompatibleProvider({
        id: "openai-compatible",
        apiKey: config.openai.apiKey,
        embeddingDimensions: config.openai.models.embedding.dimensions,
      });
      this.defaultBundle = {
        chat: provider,
        embedding: provider,
        tiers: DEFAULT_TIERS,
      };
    }
    return this.defaultBundle;
  }
}

export const llmProviderFactory = new LLMProviderFactory();
