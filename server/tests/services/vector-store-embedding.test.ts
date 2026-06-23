import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { EmbeddingRequest, EmbeddingResult } from "../../services/llm/provider.types";

/**
 * Slice 6 — VectorStoreService embeds via the managed EmbeddingProvider, keeps its
 * batching, and asserts the returned dimension matches the pgvector column before insert.
 */

const mockEmbed = jest.fn<(req: EmbeddingRequest) => Promise<EmbeddingResult>>();
jest.mock("../../services/llm/llm-provider.factory", () => ({
  llmProviderFactory: {
    forOrganization: async () => ({
      embedding: { id: "openai-compatible", dimensions: 1536, embed: mockEmbed },
    }),
  },
}));

const mockQuery = jest.fn();
jest.mock("../../database/data-source", () => ({
  AppDataSource: { isInitialized: true, query: (...args: unknown[]) => mockQuery(...args) },
}));

const usageEvents: unknown[] = [];
jest.mock("../../services/llm/usage-sink", () => ({
  emitUsage: (e: unknown) => usageEvents.push(e),
}));

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { VectorStoreService } from "../../services/vector-store.service";

function embeddingResult(dimensions: number): EmbeddingResult {
  return {
    embeddings: [[0.1, 0.2, 0.3]],
    usage: { promptTokens: 4, completionTokens: 0, totalTokens: 4, estimated: false },
    model: "text-embedding-3-small",
    provider: "openai-compatible",
    dimensions,
  };
}

describe("VectorStoreService embedding via provider", () => {
  let store: VectorStoreService;
  beforeEach(() => {
    mockEmbed.mockReset();
    mockQuery.mockReset();
    usageEvents.length = 0;
    store = new VectorStoreService();
  });

  it("embeds chunks via the provider, inserts, and meters usage", async () => {
    mockEmbed.mockResolvedValue(embeddingResult(1536));
    mockQuery.mockResolvedValue([{ id: "emb-1" }]);

    const ids = await store.addChunks("org-1", "doc-1", [{ content: "hello world" }]);

    expect(ids).toEqual(["emb-1"]);
    expect(mockEmbed).toHaveBeenCalledWith(
      expect.objectContaining({ input: ["hello world"], dimensions: 1536 }),
    );
    expect(usageEvents).toHaveLength(1);
    expect(usageEvents[0]).toMatchObject({ kind: "embedding", model: "text-embedding-3-small" });
  });

  it("throws on a dimension mismatch BEFORE inserting", async () => {
    mockEmbed.mockResolvedValue(embeddingResult(1024));

    await expect(store.addChunks("org-1", "doc-1", [{ content: "x" }])).rejects.toThrow(
      /dimension mismatch/i,
    );
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
