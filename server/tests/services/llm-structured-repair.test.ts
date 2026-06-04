import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type {
  ChatProvider,
  ChatRequest,
  ChatResult,
  EmbeddingProvider,
  ProviderCapabilities,
} from "../../services/llm/provider.types";

/**
 * Slice 4 — validate-and-repair for providers that can't guarantee strict JSON.
 * We mock the factory to hand LLMService a non-strict provider so we can drive the
 * repair loop deterministically.
 */

const mockChat = jest.fn<(req: ChatRequest) => Promise<ChatResult>>();

const NON_STRICT_CAPS: ProviderCapabilities = {
  strictJsonSchema: false,
  jsonObjectMode: true,
  toolForcedJson: true,
  streaming: true,
  reportsUsage: true,
  systemRole: "message",
  supportedTiers: ["easy", "medium", "hard"],
};

const fakeChatProvider: ChatProvider = {
  id: "fake-nonstrict",
  capabilities: NON_STRICT_CAPS,
  chat: mockChat,
  chatStream: jest.fn() as never,
};

const fakeEmbeddingProvider: EmbeddingProvider = {
  id: "fake-nonstrict",
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

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { LLMService } from "../../services/core/llm.service";
import { StructuredOutputError } from "../../services/llm/structured-output";

const SCHEMA = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"],
  additionalProperties: false,
};

function result(content: string, finishReason: ChatResult["finishReason"] = "stop"): ChatResult {
  return {
    content,
    usage: { promptTokens: 5, completionTokens: 5, totalTokens: 10, estimated: false },
    model: "m-hard",
    provider: "fake-nonstrict",
    finishReason,
  };
}

describe("LLMService structured validate-and-repair (non-strict provider)", () => {
  let llm: LLMService;
  beforeEach(() => {
    mockChat.mockReset();
    llm = new LLMService();
  });

  it("returns verbatim when the first response is already valid", async () => {
    mockChat.mockResolvedValueOnce(result('{"ok":true}'));
    const out = await llm.invoke({ history: "q", jsonSchema: SCHEMA });
    expect(out).toBe('{"ok":true}');
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("repairs once when the first response is invalid, then succeeds", async () => {
    mockChat.mockResolvedValueOnce(result('{"ok":"nope"}')); // wrong type
    mockChat.mockResolvedValueOnce(result('{"ok":false}')); // repaired
    const meta = await llm.invokeWithMeta({ history: "q", jsonSchema: SCHEMA });
    expect(meta.content).toBe('{"ok":false}');
    expect(mockChat).toHaveBeenCalledTimes(2);
    // repair tokens are summed into the returned usage
    expect(meta.usage.totalTokens).toBe(20);
  });

  it("throws StructuredOutputError when still invalid after one repair", async () => {
    mockChat.mockResolvedValue(result("still not json"));
    await expect(llm.invoke({ history: "q", jsonSchema: SCHEMA })).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
    expect(mockChat).toHaveBeenCalledTimes(2);
  });

  it("surfaces a content_filter refusal as StructuredOutputError without repair", async () => {
    mockChat.mockResolvedValueOnce(result("", "content_filter"));
    await expect(llm.invoke({ history: "q", jsonSchema: SCHEMA })).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
    expect(mockChat).toHaveBeenCalledTimes(1);
  });

  it("surfaces a truncated (length) structured response as StructuredOutputError", async () => {
    mockChat.mockResolvedValueOnce(result('{"ok":tr', "length"));
    await expect(llm.invoke({ history: "q", jsonSchema: SCHEMA })).rejects.toBeInstanceOf(
      StructuredOutputError,
    );
    expect(mockChat).toHaveBeenCalledTimes(1);
  });
});
