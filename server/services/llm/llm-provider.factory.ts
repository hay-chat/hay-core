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
import {
  OpenAICompatibleProvider,
  OPENAI_COMPATIBLE_CAPABILITIES,
} from "./openai-compatible.provider";
import { AnthropicChatProvider } from "./anthropic.provider";
import { GeminiChatProvider } from "./gemini.provider";
import { PROVIDER_TIER_DEFAULTS } from "./tier-maps";
import type {
  ChatProvider,
  EmbeddingProvider,
  OpenAICompatibleVendor,
  OrgLlmConfig,
  TierModelMap,
} from "./provider.types";

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

  /**
   * The bundle served when a call has no organizationId, and the fallback for orgs
   * that have not configured a provider. Honours LLM_BASE_URL / LLM_VENDOR /
   * LLM_API_KEY so an operator can move every default call to another
   * OpenAI-compatible host without touching the database.
   *
   * Embeddings stay on the OpenAI key regardless: the pgvector column and HNSW
   * index are pinned to EMBEDDING_DIM, so a host returning a different dimension
   * would fail `assertDimensions` at write time.
   */
  private getDefaultBundle(): ResolvedLlmBundle {
    if (!this.defaultBundle) {
      const embedding = this.buildManagedEmbeddingProvider();
      const vendor = config.llm.vendor as OpenAICompatibleVendor | "";
      const capabilities = vendor
        ? OPENAI_COMPATIBLE_CAPABILITIES[vendor]
        : OPENAI_COMPATIBLE_CAPABILITIES.openai;

      if (vendor && !capabilities) {
        throw new Error(
          `LLM_VENDOR="${vendor}" is not a known OpenAI-compatible vendor. ` +
            `Expected one of: ${Object.keys(OPENAI_COMPATIBLE_CAPABILITIES).join(", ")}.`,
        );
      }

      const chat = new OpenAICompatibleProvider({
        id: "openai-compatible",
        apiKey: config.llm.apiKey || config.openai.apiKey,
        baseURL: config.llm.baseUrl || undefined,
        capabilities,
        embeddingDimensions: config.openai.models.embedding.dimensions,
      });

      this.defaultBundle = {
        chat,
        embedding,
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
    const { provider, apiKeyEncrypted, baseUrl, vendor } = llm.chat;
    // BYO key decrypted only here; falls back to the env/Hay key (Auto/OSS).
    const apiKey = apiKeyEncrypted ? decryptValue(apiKeyEncrypted) : config.openai.apiKey;

    switch (provider) {
      case "openai-compatible":
        return new OpenAICompatibleProvider({
          id: "openai-compatible",
          apiKey,
          baseURL: baseUrl,
          capabilities: OPENAI_COMPATIBLE_CAPABILITIES[vendor ?? "openai"],
        });
      case "anthropic":
        return new AnthropicChatProvider({ apiKey, baseURL: baseUrl });
      case "gemini":
        return new GeminiChatProvider({ apiKey });
      default:
        throw new Error(`Unknown chat provider: ${String(provider)}`);
    }
  }
}

export const llmProviderFactory = new LLMProviderFactory();
