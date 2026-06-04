/**
 * LLM provider factory.
 *
 * Resolves which chat + embedding providers (and tier→model map) an organization
 * uses, following the config-resolver precedence: per-org DB config → env → default.
 * Mirrors the git-connection provider registry.
 *
 * - No orgId (OSS / system tasks) → the env default bundle (today's exact behavior).
 * - orgId with `settings.llm` → that org's configured chat provider; BYO keys are
 *   decrypted here and never persisted/logged.
 * - Embeddings are ALWAYS managed (env/Hay key, OpenAI-compatible) regardless of the
 *   org's chat provider — Anthropic/Grok have no embeddings, and the pgvector column
 *   is pinned to one dimension.
 *
 * Resolved bundles are cached per org and invalidated on settings update.
 *
 * @module services/llm/llm-provider.factory
 */

import { config } from "@server/config/env";
import { createLogger } from "@server/lib/logger";
import { decryptValue } from "@server/lib/auth/utils/encryption";
import { organizationRepository } from "@server/repositories/organization.repository";
import { OpenAICompatibleProvider } from "./openai-compatible.provider";
import { AnthropicChatProvider } from "./anthropic.provider";
import { PROVIDER_TIER_DEFAULTS } from "./tier-maps";
import type { ChatProvider, EmbeddingProvider, OrgLlmConfig, TierModelMap } from "./provider.types";

const logger = createLogger("llm-factory");

export interface ResolvedLlmBundle {
  chat: ChatProvider;
  embedding: EmbeddingProvider;
  tiers: TierModelMap;
}

class LLMProviderFactory {
  private defaultBundle: ResolvedLlmBundle | undefined;
  private readonly cache = new Map<string, ResolvedLlmBundle>();

  /** Resolve the provider bundle for an organization (or the env default when omitted). */
  async forOrganization(organizationId?: string): Promise<ResolvedLlmBundle> {
    if (!organizationId) return this.getDefaultBundle();

    const cached = this.cache.get(organizationId);
    if (cached) return cached;

    const bundle = await this.resolve(organizationId);
    this.cache.set(organizationId, bundle);
    return bundle;
  }

  /** Drop a cached bundle so the next call re-reads the org's settings. */
  invalidate(organizationId: string): void {
    this.cache.delete(organizationId);
  }

  /** The managed embedding provider (always env/Hay key, OpenAI-compatible). */
  private buildManagedEmbeddingProvider(): EmbeddingProvider {
    return new OpenAICompatibleProvider({
      id: "openai-compatible",
      apiKey: config.openai.apiKey,
      embeddingDimensions: config.openai.models.embedding.dimensions,
    });
  }

  private getDefaultBundle(): ResolvedLlmBundle {
    if (!this.defaultBundle) {
      const provider = new OpenAICompatibleProvider({
        id: "openai-compatible",
        apiKey: config.openai.apiKey,
        embeddingDimensions: config.openai.models.embedding.dimensions,
      });
      this.defaultBundle = {
        chat: provider,
        embedding: provider,
        tiers: PROVIDER_TIER_DEFAULTS["openai-compatible"],
      };
    }
    return this.defaultBundle;
  }

  private async resolve(organizationId: string): Promise<ResolvedLlmBundle> {
    let llm: OrgLlmConfig | undefined;
    try {
      const org = await organizationRepository.findById(organizationId);
      llm = org?.settings?.llm;
    } catch (err) {
      logger.warn({ err, organizationId }, "Failed to load org LLM config; using default bundle");
    }

    if (!llm) return this.getDefaultBundle();

    return {
      chat: this.buildChatProvider(llm),
      embedding: this.buildManagedEmbeddingProvider(),
      tiers: llm.chat.tiers ?? PROVIDER_TIER_DEFAULTS[llm.chat.provider],
    };
  }

  private buildChatProvider(llm: OrgLlmConfig): ChatProvider {
    const { provider, apiKeyEncrypted, baseUrl } = llm.chat;
    // BYO key decrypted only here; falls back to the env/Hay key (Auto/OSS).
    const apiKey = apiKeyEncrypted ? decryptValue(apiKeyEncrypted) : config.openai.apiKey;

    switch (provider) {
      case "openai-compatible":
        return new OpenAICompatibleProvider({ id: "openai-compatible", apiKey, baseURL: baseUrl });
      case "anthropic":
        return new AnthropicChatProvider({ apiKey, baseURL: baseUrl });
      case "gemini":
        throw new Error("Gemini chat provider is not wired yet (slice 8)");
      default:
        throw new Error(`Unknown chat provider: ${String(provider)}`);
    }
  }
}

export const llmProviderFactory = new LLMProviderFactory();
