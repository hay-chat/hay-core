import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type {
  ChatProvider,
  ChatRequest,
  ChatResult,
  EmbeddingProvider,
} from "../../services/llm/provider.types";

/**
 * Every chat call logs its duration, tier and call site at info level, so a
 * production log shows where a turn's time goes.
 */

const mockChat = jest.fn<(req: ChatRequest) => Promise<ChatResult>>();
const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const fakeChatProvider: ChatProvider = {
  id: "fake",
  capabilities: {
    strictJsonSchema: false,
    jsonObjectMode: true,
    toolForcedJson: true,
    streaming: true,
    reportsUsage: true,
    systemRole: "message",
    supportedTiers: ["easy", "medium", "hard"],
  },
  chat: mockChat,
  chatStream: jest.fn() as never,
};

const fakeEmbeddingProvider: EmbeddingProvider = {
  id: "fake",
  dimensions: 1536,
  embed: jest.fn() as never,
};

jest.mock("../../services/llm/llm-provider.factory", () => ({
  llmProviderFactory: {
    forOrganization: () => ({
      chat: fakeChatProvider,
      embedding: fakeEmbeddingProvider,
      tiers: { easy: "m-easy", medium: "m-medium", hard: "m-hard" },
    }),
  },
}));

jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { LLMService } from "../../services/core/llm.service";

const SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

function result(content: string): ChatResult {
  return {
    content,
    usage: {
      promptTokens: 10,
      cachedPromptTokens: 0,
      completionTokens: 5,
      totalTokens: 15,
      estimated: false,
    },
    model: "m-medium",
    provider: "fake",
    finishReason: "stop",
  };
}

describe("LLMService call timing log", () => {
  beforeEach(() => {
    mockChat.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
  });

  it("logs caller, tier and duration for a completed call", async () => {
    mockChat.mockResolvedValueOnce(result("hello"));

    await new LLMService().invoke({ prompt: "hi", tier: "medium", caller: "perception" });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        caller: "perception",
        tier: "medium",
        model: "m-medium",
        repaired: false,
        durationMs: expect.any(Number),
      }),
      "LLM chat completed",
    );
  });

  it("flags a call that needed a structured repair round-trip", async () => {
    mockChat.mockResolvedValueOnce(result("not json")).mockResolvedValueOnce(result('{"ok":true}'));

    await new LLMService().invoke({ prompt: "hi", jsonSchema: SCHEMA, caller: "planner" });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ caller: "planner", tier: "hard", repaired: true }),
      "LLM chat completed",
    );
  });

  it("logs the duration of a failed call", async () => {
    mockChat.mockRejectedValueOnce(new Error("bad request"));

    await expect(new LLMService().invoke({ prompt: "hi", caller: "planner" })).rejects.toThrow();

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ caller: "planner", durationMs: expect.any(Number) }),
      "LLM chat failed",
    );
  });
});
