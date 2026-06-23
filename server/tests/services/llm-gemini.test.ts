import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import type { ChatRequest } from "../../services/llm/provider.types";

/** Slice 8 — Gemini dedicated adapter. SDK mocked; assert request shaping + mapping. */

const mockGenerate = jest.fn();
const mockGenerateStream = jest.fn();
jest.mock("@google/genai", () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerate, generateContentStream: mockGenerateStream },
  })),
}));

async function* chunks(items: unknown[]) {
  for (const i of items) yield i;
}

import { GeminiChatProvider } from "../../services/llm/gemini.provider";

function req(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: "gemini-2.5-flash",
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hello" },
    ],
    temperature: 0.5,
    maxTokens: 1000,
    ...overrides,
  };
}

describe("GeminiChatProvider", () => {
  let provider: GeminiChatProvider;
  beforeEach(() => {
    mockGenerate.mockReset();
    mockGenerateStream.mockReset();
    provider = new GeminiChatProvider({ apiKey: "k" });
  });

  it("streams text chunks and resolves completion usage from the final chunk", async () => {
    mockGenerateStream.mockResolvedValue(
      chunks([
        { text: "Hel" },
        {
          text: "lo",
          candidates: [{ finishReason: "STOP" }],
          usageMetadata: { promptTokenCount: 6, candidatesTokenCount: 3, totalTokenCount: 9 },
        },
      ]),
    );

    const { stream, completion } = await provider.chatStream(req());
    let text = "";
    for await (const chunk of stream) text += chunk;
    expect(text).toBe("Hello");

    const meta = await completion;
    expect(meta.usage.totalTokens).toBe(9);
    expect(meta.finishReason).toBe("stop");
    expect(meta.provider).toBe("gemini");
  });

  it("maps system→systemInstruction, roles, maxOutputTokens, and usage", async () => {
    mockGenerate.mockResolvedValue({
      text: "hi",
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4, totalTokenCount: 16 },
    });

    const res = await provider.chat(req());
    const [params] = mockGenerate.mock.calls[0] as [
      { model: string; contents: unknown; config: Record<string, unknown> },
    ];
    expect(params.model).toBe("gemini-2.5-flash");
    expect(params.config.systemInstruction).toBe("be brief");
    expect(params.config.maxOutputTokens).toBe(1000);
    expect(params.config.temperature).toBe(0.5);
    expect(params.contents).toEqual([{ role: "user", parts: [{ text: "hello" }] }]);
    expect(res.content).toBe("hi");
    expect(res.usage).toEqual({
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
      estimated: false,
    });
    expect(res.finishReason).toBe("stop");
  });

  it("sets responseJsonSchema for structured output", async () => {
    mockGenerate.mockResolvedValue({
      text: '{"ok":true}',
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2, totalTokenCount: 7 },
    });
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    await provider.chat(req({ structured: { schema } }));
    const [params] = mockGenerate.mock.calls[0] as [{ config: Record<string, unknown> }];
    expect(params.config.responseMimeType).toBe("application/json");
    expect(params.config.responseJsonSchema).toEqual(schema);
  });

  it("counts thinking tokens as output and maps MAX_TOKENS / SAFETY finish reasons", async () => {
    mockGenerate.mockResolvedValueOnce({
      text: "partial",
      candidates: [{ finishReason: "MAX_TOKENS" }],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 5,
        thoughtsTokenCount: 3,
        totalTokenCount: 18,
      },
    });
    const res = await provider.chat(req());
    expect(res.usage.completionTokens).toBe(8); // 5 + 3
    expect(res.finishReason).toBe("length");

    mockGenerate.mockResolvedValueOnce({
      text: "",
      candidates: [{ finishReason: "SAFETY" }],
      usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 0, totalTokenCount: 1 },
    });
    expect((await provider.chat(req())).finishReason).toBe("content_filter");
  });
});
