import { describe, it, expect, beforeEach, jest } from "@jest/globals";

/**
 * Slice 1 characterization test — the "provably unchanged" gate.
 *
 * Proves that routing through the new provider adapter + factory builds the EXACT
 * same OpenAI request the old inline LLMService built (default bundle: gpt-4o,
 * temperature 0.7, max_tokens 2000, identical response_format branches) and that
 * prepareMessages/serializeMessages still produce the same messages. The `openai`
 * SDK is mocked so no network is touched.
 */

// Capture the args every chat/embedding call is built with.
const mockChatCreate = jest.fn();
const mockEmbeddingsCreate = jest.fn();

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { LLMService } from "../../services/core/llm.service";

const CHAT_RESPONSE = {
  model: "gpt-4o",
  choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe("LLM provider adapter — Slice 1 characterization", () => {
  let llm: LLMService;

  beforeEach(() => {
    mockChatCreate.mockReset();
    mockEmbeddingsCreate.mockReset();
    mockChatCreate.mockResolvedValue(CHAT_RESPONSE as never);
    llm = new LLMService();
  });

  it("builds the legacy strict json_schema request for the default bundle", async () => {
    const schema = { type: "object", properties: { ok: { type: "boolean" } } };
    await llm.invoke({ prompt: "system text", history: "hello", jsonSchema: schema });

    const [body] = mockChatCreate.mock.calls[0] as [Record<string, unknown>];
    expect(body).toEqual({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "system text" },
        { role: "user", content: "hello" },
      ],
      max_tokens: 2000,
      temperature: 0.7,
      response_format: {
        type: "json_schema",
        json_schema: { name: "structured_response", schema, strict: true },
      },
    });
  });

  it("uses json_object mode when strictSchema is false", async () => {
    await llm.invoke({
      history: "hi",
      jsonSchema: { type: "object" },
      strictSchema: false,
    });
    const [body] = mockChatCreate.mock.calls[0] as [Record<string, unknown>];
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("omits response_format when no schema is given", async () => {
    await llm.invoke({ history: "hi" });
    const [body] = mockChatCreate.mock.calls[0] as [Record<string, unknown>];
    expect(body.response_format).toBeUndefined();
    expect(body.model).toBe("gpt-4o");
  });

  it("resolves tier → model (default hard=gpt-4o, easy=gpt-4.1-nano) and honors model override", async () => {
    await llm.invoke({ history: "a" });
    expect((mockChatCreate.mock.calls[0][0] as { model: string }).model).toBe("gpt-4o");

    await llm.invoke({ history: "b", tier: "easy" });
    expect((mockChatCreate.mock.calls[1][0] as { model: string }).model).toBe("gpt-4.1-nano");

    await llm.invoke({ history: "c", model: "custom-model-x" });
    expect((mockChatCreate.mock.calls[2][0] as { model: string }).model).toBe("custom-model-x");
  });

  it("returns the raw string content (callers JSON.parse it)", async () => {
    const out = await llm.invoke({ history: "hi" });
    expect(out).toBe('{"ok":true}');
  });

  it("embeds via the default text-embedding-3-small model and returns the vector", async () => {
    mockEmbeddingsCreate.mockResolvedValue({
      model: "text-embedding-3-small",
      data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    } as never);

    const vec = await llm.embedding({ text: "embed me" });
    expect(vec).toEqual([0.1, 0.2, 0.3]);
    const [body] = mockEmbeddingsCreate.mock.calls[0] as [Record<string, unknown>];
    expect(body).toEqual({ model: "text-embedding-3-small", input: "embed me" });
  });
});
