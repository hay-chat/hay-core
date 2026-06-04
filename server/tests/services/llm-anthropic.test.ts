import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { ChatRequest } from "../../services/llm/provider.types";

/** Slice 7 — Anthropic dedicated adapter. SDK mocked; assert request shaping + mapping. */

const mockCreate = jest.fn();
jest.mock("@anthropic-ai/sdk", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } })),
}));

import { AnthropicChatProvider } from "../../services/llm/anthropic.provider";

function req(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: "be helpful" },
      { role: "user", content: "hello" },
    ],
    temperature: 0.7,
    maxTokens: 2000,
    ...overrides,
  };
}

describe("AnthropicChatProvider", () => {
  let provider: AnthropicChatProvider;
  beforeEach(() => {
    mockCreate.mockReset();
    provider = new AnthropicChatProvider({ apiKey: "k" });
  });

  it("splits the system prompt to a top-level param and maps text + usage", async () => {
    mockCreate.mockResolvedValue({
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "hi there" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const res = await provider.chat(req());
    const [params] = mockCreate.mock.calls[0] as [Record<string, unknown>];
    expect(params.system).toBe("be helpful");
    expect(params.messages).toEqual([{ role: "user", content: "hello" }]);
    expect(res.content).toBe("hi there");
    expect(res.usage).toEqual({
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      estimated: false,
    });
    expect(res.finishReason).toBe("stop");
  });

  it("uses a forced tool for structured output and returns its input as JSON", async () => {
    mockCreate.mockResolvedValue({
      model: "claude-sonnet-4-6",
      content: [{ type: "tool_use", name: "structured_response", input: { ok: true } }],
      stop_reason: "tool_use",
      usage: { input_tokens: 8, output_tokens: 3 },
    });

    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    const res = await provider.chat(req({ structured: { schema } }));
    const [params] = mockCreate.mock.calls[0] as [{ tools: unknown[]; tool_choice: unknown }];
    expect(params.tool_choice).toEqual({ type: "tool", name: "structured_response" });
    expect(params.tools).toHaveLength(1);
    expect(res.content).toBe('{"ok":true}');
  });

  it("sums cache tokens into promptTokens", async () => {
    mockCreate.mockResolvedValue({
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "x" }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 10,
        output_tokens: 4,
        cache_creation_input_tokens: 3,
        cache_read_input_tokens: 2,
      },
    });
    const res = await provider.chat(req());
    expect(res.usage.promptTokens).toBe(15); // 10 + 3 + 2
    expect(res.usage.totalTokens).toBe(19);
  });

  it("strips temperature for opus (reasoning) models but keeps it otherwise", async () => {
    mockCreate.mockResolvedValue({
      model: "claude-opus-4-8",
      content: [{ type: "text", text: "x" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    await provider.chat(req({ model: "claude-opus-4-8" }));
    expect((mockCreate.mock.calls[0][0] as { temperature?: number }).temperature).toBeUndefined();

    await provider.chat(req()); // sonnet
    expect((mockCreate.mock.calls[1][0] as { temperature?: number }).temperature).toBe(0.7);
  });

  it("maps refusal and truncation stop reasons", async () => {
    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-6",
      content: [],
      stop_reason: "refusal",
      usage: { input_tokens: 1, output_tokens: 0 },
    });
    expect((await provider.chat(req())).finishReason).toBe("content_filter");

    mockCreate.mockResolvedValueOnce({
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "partial" }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 1, output_tokens: 9 },
    });
    expect((await provider.chat(req())).finishReason).toBe("length");
  });
});
