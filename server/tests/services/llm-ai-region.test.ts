import { describe, it, expect, beforeEach, afterAll, jest } from "@jest/globals";

/**
 * D14-2 / D14-4 — AI processing region.
 *
 * An org with `settings.aiRegion = "eu"` must have every chat, embedding and
 * transcription call served by the EU endpoint (OPENAI_EU_BASE_URL), and must
 * never fall back to the default endpoint when EU is missing. OPENAI_BASE_URL
 * moves the managed OpenAI calls (embeddings, default chat) for everyone else.
 *
 * The OpenAI SDK is mocked; every client records the base URL it was built with,
 * so each call can be traced to the endpoint that served it.
 */

type Call = { baseURL: string | undefined; apiKey: string; body: Record<string, unknown> };
const chatCalls: Call[] = [];
const embeddingCalls: Call[] = [];
const transcriptionCalls: Call[] = [];

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: unknown) => {
    const { baseURL, apiKey } = opts as { baseURL?: string; apiKey: string };
    return {
      chat: {
        completions: {
          create: async (body: Record<string, unknown>) => {
            chatCalls.push({ baseURL, apiKey, body });
            return {
              model: String(body.model),
              choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
              usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
            };
          },
        },
      },
      embeddings: {
        create: async (body: Record<string, unknown>) => {
          embeddingCalls.push({ baseURL, apiKey, body });
          const inputs = Array.isArray(body.input) ? body.input : [body.input];
          return {
            model: String(body.model),
            data: inputs.map((_, index) => ({ index, embedding: new Array(1536).fill(0.01) })),
            usage: { prompt_tokens: 1, total_tokens: 1 },
          };
        },
      },
      audio: {
        transcriptions: {
          create: async (body: Record<string, unknown>) => {
            transcriptionCalls.push({ baseURL, apiKey, body });
            return { text: "hallo" };
          },
        },
      },
    };
  }),
  toFile: async (_buffer: Buffer, name: string) => ({ name }),
}));

const findById = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: (id: string) => findById(id) },
}));

jest.mock("@server/lib/auth/utils/encryption", () => ({
  decryptValue: (v: string) => `decrypted:${v}`,
}));

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

const mockDbQuery = jest.fn(async () => [{ id: "row-1", metadata: {} }] as unknown[]);
jest.mock("@server/database/data-source", () => ({
  AppDataSource: { isInitialized: true, query: () => mockDbQuery() },
}));

import { config as frozenConfig } from "@server/config/env";
import { llmProviderFactory } from "@server/services/llm/llm-provider.factory";
import { AiRegionUnavailableError } from "@server/services/llm/ai-region";
import { EU_TIERS } from "@server/services/llm/tier-maps";
import { LLMService } from "@server/services/core/llm.service";
import { setUsageSink, type UsageEvent } from "@server/services/llm/usage-sink";
import { ActionClaimGuardrailService } from "@server/services/core/action-claim-guardrail.service";
import { VectorStoreService } from "@server/services/vector-store.service";
import { ProductVectorStoreService } from "@server/services/product-vector-store.service";
import { TranscriptionService } from "@server/services/transcription.service";

// env.ts exports `as const`; the object itself is mutable, which lets tests toggle EU.
type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };
const config = frozenConfig as Mutable<typeof frozenConfig>;

const EU_URL = "https://eu.api.openai.com/v1";
const EU_KEY = "sk-eu-project";
const DEFAULT_URL = "https://managed.example.com/v1";

const EU_ORG = "11111111-1111-4111-8111-111111111111";
const DEFAULT_ORG = "22222222-2222-4222-8222-222222222222";

const orgs: Record<string, unknown> = {
  [EU_ORG]: {
    settings: {
      aiRegion: "eu",
      // A custom provider left over from before EU was enabled must be ignored.
      llm: {
        chat: {
          provider: "anthropic",
          apiKeyEncrypted: "enc",
          tiers: { easy: "a", medium: "b", hard: "c" },
        },
        embedding: { provider: "openai-compatible", model: "text-embedding-3-small" },
      },
    },
  },
  [DEFAULT_ORG]: { settings: {} },
};

const original = {
  euBaseUrl: config.aiRegion.eu.baseUrl,
  euApiKey: config.aiRegion.eu.apiKey,
  openaiBaseUrl: config.openai.baseUrl,
  openaiApiKey: config.openai.apiKey,
  llmBaseUrl: config.llm.baseUrl,
};

function configureEu(on: boolean) {
  config.aiRegion.eu.baseUrl = on ? EU_URL : "";
  config.aiRegion.eu.apiKey = on ? EU_KEY : "";
}

describe("AI processing region", () => {
  beforeEach(() => {
    chatCalls.length = 0;
    embeddingCalls.length = 0;
    transcriptionCalls.length = 0;
    findById.mockReset();
    findById.mockImplementation(async (id) => orgs[id] ?? null);
    mockDbQuery.mockClear();
    llmProviderFactory.invalidate(EU_ORG);
    llmProviderFactory.invalidate(DEFAULT_ORG);
    configureEu(true);
    config.openai.apiKey = "sk-managed";
    config.openai.baseUrl = original.openaiBaseUrl;
    config.llm.baseUrl = original.llmBaseUrl;
  });

  afterAll(() => {
    config.aiRegion.eu.baseUrl = original.euBaseUrl;
    config.aiRegion.eu.apiKey = original.euApiKey;
    config.openai.baseUrl = original.openaiBaseUrl;
    config.openai.apiKey = original.openaiApiKey;
    setUsageSink(undefined);
  });

  describe("factory", () => {
    it("serves an EU org's chat and embeddings from the EU endpoint with OpenAI tiers", async () => {
      const bundle = await llmProviderFactory.forOrganization(EU_ORG);

      expect(bundle.region).toBe("eu");
      expect(bundle.tiers).toEqual(EU_TIERS);
      // The leftover Anthropic config is ignored.
      expect(bundle.chat.id).toBe("openai-compatible");
      expect(bundle.chat.capabilities.strictJsonSchema).toBe(true);

      await bundle.chat.chat({ model: "m", messages: [{ role: "user", content: "hi" }] });
      await bundle.embedding.embed({ model: "text-embedding-3-small", input: "hi" });
      expect(chatCalls[0]).toMatchObject({ baseURL: EU_URL, apiKey: EU_KEY });
      expect(embeddingCalls[0]).toMatchObject({ baseURL: EU_URL, apiKey: EU_KEY });
    });

    it("refuses to resolve an EU org when the EU endpoint is not configured (no fallback)", async () => {
      configureEu(false);

      await expect(llmProviderFactory.forOrganization(EU_ORG)).rejects.toBeInstanceOf(
        AiRegionUnavailableError,
      );
      // Not cached as a success: configuring EU later makes the org work again.
      configureEu(true);
      await expect(llmProviderFactory.forOrganization(EU_ORG)).resolves.toMatchObject({
        region: "eu",
      });
    });

    it("throws instead of falling back when the org's settings cannot be read", async () => {
      findById.mockRejectedValueOnce(new Error("db down"));
      await expect(llmProviderFactory.forOrganization(EU_ORG)).rejects.toThrow("db down");
    });

    it("keeps default orgs on the default region, with OPENAI_BASE_URL for embeddings", async () => {
      config.openai.baseUrl = DEFAULT_URL;
      // The env default bundle is cached for the process, so assert through an org
      // with a managed-key (no BYO) config, whose providers are built per resolve.
      orgs["33333333-3333-4333-8333-333333333333"] = {
        settings: {
          llm: {
            chat: { provider: "openai-compatible", tiers: { easy: "e", medium: "m", hard: "h" } },
            embedding: { provider: "openai-compatible", model: "text-embedding-3-small" },
          },
        },
      };
      const bundle = await llmProviderFactory.forOrganization(
        "33333333-3333-4333-8333-333333333333",
      );
      expect(bundle.region).toBe("default");

      await bundle.embedding.embed({ model: "text-embedding-3-small", input: "x" });
      await bundle.chat.chat({ model: "h", messages: [{ role: "user", content: "x" }] });
      // Managed key → managed base URL for both chat and embeddings.
      expect(embeddingCalls[0]).toMatchObject({ baseURL: DEFAULT_URL, apiKey: "sk-managed" });
      expect(chatCalls[0]).toMatchObject({ baseURL: DEFAULT_URL, apiKey: "sk-managed" });
    });

    it("returns the region's managed OpenAI endpoint for SDK calls outside the bundle", async () => {
      await expect(llmProviderFactory.managedOpenAIEndpoint(EU_ORG)).resolves.toEqual({
        apiKey: EU_KEY,
        baseURL: EU_URL,
        region: "eu",
      });
      config.openai.baseUrl = DEFAULT_URL;
      await expect(llmProviderFactory.managedOpenAIEndpoint(DEFAULT_ORG)).resolves.toEqual({
        apiKey: "sk-managed",
        baseURL: DEFAULT_URL,
        region: "default",
      });
    });
  });

  describe("LLMService", () => {
    it("routes chat for an EU org to the EU endpoint and tags usage with the region", async () => {
      const events: UsageEvent[] = [];
      setUsageSink((e) => events.push(e));

      await new LLMService().invoke({ history: "hi", tier: "easy", organizationId: EU_ORG });

      expect(chatCalls).toHaveLength(1);
      expect(chatCalls[0]).toMatchObject({ baseURL: EU_URL, body: { model: EU_TIERS.easy } });
      expect(events[0]).toMatchObject({ kind: "chat", organizationId: EU_ORG, region: "eu" });
      setUsageSink(undefined);
    });

    it("routes the background-job path (invokeWithMeta, as the close classifier calls it)", async () => {
      await new LLMService().invokeWithMeta({
        history: "transcript",
        jsonSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
        tier: "medium",
        organizationId: EU_ORG,
      });
      expect(chatCalls[0].baseURL).toBe(EU_URL);
    });

    it("fails the call rather than using another region when EU is not configured", async () => {
      configureEu(false);
      await expect(
        new LLMService().invoke({ history: "hi", organizationId: EU_ORG }),
      ).rejects.toBeInstanceOf(AiRegionUnavailableError);
      expect(chatCalls).toHaveLength(0);
    });

    it("routes embeddings for an EU org to the EU endpoint", async () => {
      await new LLMService().embedding({ text: "hi", organizationId: EU_ORG });
      expect(embeddingCalls[0].baseURL).toBe(EU_URL);
    });

    it("guardrails pass the conversation's org, so their evaluation stays in the EU", async () => {
      chatCalls.length = 0;
      await new ActionClaimGuardrailService().assessActionClaim({
        response: "I have refunded your order.",
        customerQuery: "refund please",
        conversationHistory: [],
        toolsCalledThisTurn: [],
        organizationId: EU_ORG,
      });
      expect(chatCalls.length).toBeGreaterThan(0);
      expect(chatCalls.every((c) => c.baseURL === EU_URL)).toBe(true);
    });
  });

  describe("vector stores", () => {
    it("embeds an EU org's documents and queries on the EU endpoint", async () => {
      const store = new VectorStoreService();
      await store.initialize();
      await store.addChunks(EU_ORG, null, [{ content: "returns policy" }]);
      await store.search(EU_ORG, "returns", 3);

      expect(embeddingCalls).toHaveLength(2);
      expect(embeddingCalls.every((c) => c.baseURL === EU_URL)).toBe(true);
    });

    it("embeds an EU org's product catalog and product searches on the EU endpoint", async () => {
      const store = new ProductVectorStoreService();
      await store.initialize();
      await store.upsertProductEmbeddings(EU_ORG, [
        { productId: "44444444-4444-4444-8444-444444444444", content: "red shoes" },
      ]);
      await store.search(EU_ORG, "shoes", 3);

      expect(embeddingCalls).toHaveLength(2);
      expect(embeddingCalls.every((c) => c.baseURL === EU_URL)).toBe(true);
    });

    it("does not embed an EU org's text anywhere when EU is not configured", async () => {
      configureEu(false);
      const store = new VectorStoreService();
      await store.initialize();
      await expect(store.search(EU_ORG, "returns", 3)).rejects.toBeInstanceOf(
        AiRegionUnavailableError,
      );
      expect(embeddingCalls).toHaveLength(0);
    });
  });

  describe("transcription", () => {
    const audio = {
      buffer: Buffer.from("OggS"),
      mimeType: "audio/ogg",
      filename: "voice",
    };

    it("transcribes an EU org's voice notes on the EU endpoint", async () => {
      const text = await new TranscriptionService().transcribe({
        ...audio,
        organizationId: EU_ORG,
      });
      expect(text).toBe("hallo");
      expect(transcriptionCalls[0]).toMatchObject({ baseURL: EU_URL, apiKey: EU_KEY });
    });

    it("skips the transcript for an EU org when EU is not configured", async () => {
      configureEu(false);
      const text = await new TranscriptionService().transcribe({
        ...audio,
        organizationId: EU_ORG,
      });
      expect(text).toBeNull();
      expect(transcriptionCalls).toHaveLength(0);
    });

    it("uses OPENAI_BASE_URL for default orgs", async () => {
      config.openai.baseUrl = DEFAULT_URL;
      await new TranscriptionService().transcribe({ ...audio, organizationId: DEFAULT_ORG });
      expect(transcriptionCalls[0]).toMatchObject({ baseURL: DEFAULT_URL, apiKey: "sk-managed" });
    });
  });
});
