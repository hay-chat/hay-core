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
 * - orgId with `settings.aiRegion = "eu"` → the managed EU bundle (chat + embeddings
 *   on OPENAI_EU_BASE_URL), ignoring `settings.llm`. If the EU endpoint is not
 *   configured, or the org's settings cannot be read, resolution throws: an EU org's
 *   data is never sent to the default endpoint.
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
import { EU_TIERS, PROVIDER_TIER_DEFAULTS } from "./tier-maps";
import {
  AiRegionUnavailableError,
  isEuRegionConfigured,
  regionFromSettings,
  type AiRegion,
} from "./ai-region";
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
  /** Where this bundle's calls are processed. Emitted on every usage event. */
  region: AiRegion;
}

/** A managed OpenAI endpoint (key + base URL) for SDK calls outside the bundle, e.g. audio. */
export interface ManagedOpenAIEndpoint {
  apiKey: string;
  baseURL?: string;
  region: AiRegion;
}

class LLMProviderFactory {
  private defaultBundle: ResolvedLlmBundle | undefined;
  private euBundle: ResolvedLlmBundle | undefined;
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

  /**
   * The managed OpenAI endpoint for an org's region, for calls the bundle does not
   * cover (voice-note transcription). Throws `AiRegionUnavailableError` like
   * `forOrganization` when the org is EU-only and EU is not configured.
   */
  async managedOpenAIEndpoint(organizationId: string): Promise<ManagedOpenAIEndpoint> {
    const { region } = await this.forOrganization(organizationId);
    if (region === "eu") {
      return {
        apiKey: config.aiRegion.eu.apiKey,
        baseURL: config.aiRegion.eu.baseUrl,
        region,
      };
    }
    return {
      apiKey: config.openai.apiKey,
      baseURL: config.openai.baseUrl || undefined,
      region,
    };
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
      baseURL: config.openai.baseUrl || undefined,
      embeddingDimensions: config.openai.models.embedding.dimensions,
    });
  }

  /**
   * The bundle served when a call has no organizationId, and the fallback for orgs
   * that have not configured a provider. Honours LLM_BASE_URL / LLM_VENDOR /
   * LLM_API_KEY so an operator can move every default call to another
   * OpenAI-compatible host without touching the database.
   *
   * Embeddings stay on the OpenAI key (and OPENAI_BASE_URL) regardless: the pgvector
   * column and HNSW index are pinned to EMBEDDING_DIM, so a host returning a
   * different dimension would fail `assertDimensions` at write time.
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
        baseURL: config.llm.baseUrl || config.openai.baseUrl || undefined,
        capabilities,
        embeddingDimensions: config.openai.models.embedding.dimensions,
      });

      this.defaultBundle = {
        chat,
        embedding,
        tiers: PROVIDER_TIER_DEFAULTS["openai-compatible"],
        region: "default",
      };
    }
    return this.defaultBundle;
  }

  /**
   * The managed EU bundle: chat and embeddings both on the OpenAI EU data residency
   * endpoint, with OpenAI tiers (never LLM_TIER_*, which name default-host models).
   */
  private getEuBundle(organizationId: string): ResolvedLlmBundle {
    if (!isEuRegionConfigured()) {
      throw new AiRegionUnavailableError(organizationId, "eu");
    }
    if (!this.euBundle) {
      const provider = new OpenAICompatibleProvider({
        id: "openai-compatible",
        apiKey: config.aiRegion.eu.apiKey,
        baseURL: config.aiRegion.eu.baseUrl,
        capabilities: OPENAI_COMPATIBLE_CAPABILITIES.openai,
        embeddingDimensions: config.openai.models.embedding.dimensions,
      });
      this.euBundle = { chat: provider, embedding: provider, tiers: EU_TIERS, region: "eu" };
    }
    return this.euBundle;
  }

  private async resolve(organizationId: string): Promise<ResolvedLlmBundle> {
    // No silent fallback when the settings cannot be read: the org may be EU-only,
    // and the default bundle is not an EU endpoint. Let the error reach the caller.
    const org = await organizationRepository.findById(organizationId);
    const region = regionFromSettings(org?.settings);

    if (region === "eu") {
      const bundle = this.getEuBundle(organizationId);
      logger.info(
        { organizationId, region, host: hostOf(config.aiRegion.eu.baseUrl) },
        "Resolved LLM bundle",
      );
      if (org?.settings?.llm) {
        logger.warn(
          { organizationId },
          "Org has its own AI provider configured but is EU-only; using the managed EU endpoint",
        );
      }
      return bundle;
    }

    const llm: OrgLlmConfig | undefined = org?.settings?.llm;
    if (!llm) return this.getDefaultBundle();

    return {
      chat: this.buildChatProvider(llm),
      embedding: this.buildManagedEmbeddingProvider(),
      tiers: llm.chat.tiers ?? PROVIDER_TIER_DEFAULTS[llm.chat.provider],
      region: "default",
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
          // The managed key belongs to OPENAI_BASE_URL's project; a BYO key without a
          // base URL talks to api.openai.com.
          baseURL: baseUrl || (apiKeyEncrypted ? undefined : config.openai.baseUrl || undefined),
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

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "invalid-url";
  }
}

export const llmProviderFactory = new LLMProviderFactory();
