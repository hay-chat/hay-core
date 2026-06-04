import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { OrgLlmConfig } from "../../services/llm/provider.types";

/**
 * Slice 5 — factory resolves the per-org bundle (DB → env → default), decrypts BYO
 * keys only inside the factory, and caches/invalidates per org.
 */

// Capture every `new OpenAI({ apiKey, baseURL })` so we can assert what the BYO key
// and baseURL resolve to without touching the network.
const openaiCtor = jest.fn();
jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: unknown) => {
    openaiCtor(opts);
    return { chat: { completions: { create: jest.fn() } }, embeddings: { create: jest.fn() } };
  }),
}));

const findById = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: (id: string) => findById(id) },
}));

const decryptValue = jest.fn((v: string) => `decrypted:${v}`);
jest.mock("@server/lib/auth/utils/encryption", () => ({
  decryptValue: (v: string) => decryptValue(v),
}));

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { llmProviderFactory } from "../../services/llm/llm-provider.factory";

function orgWithLlm(llm: OrgLlmConfig) {
  return { settings: { llm } };
}

describe("LLMProviderFactory.forOrganization", () => {
  beforeEach(() => {
    openaiCtor.mockClear();
    findById.mockReset();
    decryptValue.mockClear();
  });

  it("returns the default openai-compatible bundle when no orgId is given", async () => {
    const bundle = await llmProviderFactory.forOrganization();
    expect(bundle.chat.id).toBe("openai-compatible");
    expect(bundle.tiers.hard).toBe("gpt-4o");
    expect(findById).not.toHaveBeenCalled();
  });

  it("falls back to the default bundle when the org has no llm config", async () => {
    findById.mockResolvedValue({ settings: {} });
    const bundle = await llmProviderFactory.forOrganization("org-nodll");
    expect(bundle.tiers.hard).toBe("gpt-4o");
  });

  it("builds a BYO openai-compatible provider, decrypting the key inside the factory", async () => {
    findById.mockResolvedValue(
      orgWithLlm({
        chat: {
          provider: "openai-compatible",
          apiKeyEncrypted: "enc-key",
          baseUrl: "https://api.mistral.ai/v1",
          tiers: { easy: "ministral-3b", medium: "mistral-small", hard: "mistral-large" },
        },
        embedding: { provider: "openai-compatible", model: "text-embedding-3-small" },
      }),
    );

    const bundle = await llmProviderFactory.forOrganization("org-byo");
    expect(bundle.tiers.hard).toBe("mistral-large");
    expect(decryptValue).toHaveBeenCalledWith("enc-key");
    // The decrypted key + custom baseURL reach the OpenAI client constructor.
    expect(openaiCtor).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: "decrypted:enc-key",
        baseURL: "https://api.mistral.ai/v1",
      }),
    );
  });

  it("caches per org and re-reads after invalidate", async () => {
    findById.mockResolvedValue({ settings: {} });
    await llmProviderFactory.forOrganization("org-cache");
    await llmProviderFactory.forOrganization("org-cache");
    expect(findById).toHaveBeenCalledTimes(1);

    llmProviderFactory.invalidate("org-cache");
    await llmProviderFactory.forOrganization("org-cache");
    expect(findById).toHaveBeenCalledTimes(2);
  });

  it("throws a clear error for not-yet-wired providers", async () => {
    findById.mockResolvedValue(
      orgWithLlm({
        chat: {
          provider: "anthropic",
          tiers: { easy: "claude-haiku-4-5", medium: "claude-sonnet-4-6", hard: "claude-opus-4-8" },
        },
        embedding: { provider: "openai-compatible", model: "text-embedding-3-small" },
      }),
    );
    await expect(llmProviderFactory.forOrganization("org-anthropic")).rejects.toThrow(/slice 7/);
  });
});
