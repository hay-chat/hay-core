import { describe, it, expect, beforeEach, jest } from "@jest/globals";

/**
 * A planner call that hits an overloaded vendor (DigitalOcean "529 Platform
 * overloaded") or hangs gets one more attempt; anything else fails at once.
 */

const mockChatCreate = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("openai", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: { completions: { create: mockChatCreate } },
    embeddings: { create: jest.fn() },
  })),
}));

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

import { LLMService, isTransientLlmError } from "../../services/core/llm.service";

const OK = {
  model: "m",
  choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const withStatus = (status: number, message = `${status} error`) =>
  Object.assign(new Error(message), { status });

describe("LLM transient retry", () => {
  beforeEach(() => mockChatCreate.mockReset());

  it("retries once after an overloaded vendor and returns the second answer", async () => {
    mockChatCreate
      .mockRejectedValueOnce(withStatus(529, "529 Platform overloaded. Please try again later."))
      .mockResolvedValueOnce(OK);

    await expect(new LLMService().invoke({ prompt: "p", history: "h" })).resolves.toBe("hello");
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it("gives up after the second failure", async () => {
    mockChatCreate.mockRejectedValue(withStatus(503));

    await expect(new LLMService().invoke({ prompt: "p", history: "h" })).rejects.toThrow(/503/);
    expect(mockChatCreate).toHaveBeenCalledTimes(2);
  });

  it("does not retry a bad request", async () => {
    mockChatCreate.mockRejectedValue(withStatus(400));

    await expect(new LLMService().invoke({ prompt: "p", history: "h" })).rejects.toThrow(/400/);
    expect(mockChatCreate).toHaveBeenCalledTimes(1);
  });

  it("classifies provider errors", () => {
    expect(isTransientLlmError(withStatus(429))).toBe(true);
    expect(isTransientLlmError(withStatus(529))).toBe(true);
    expect(isTransientLlmError(new Error("Operation timeout after 30000ms"))).toBe(true);
    expect(isTransientLlmError(withStatus(401))).toBe(false);
    expect(isTransientLlmError(new Error("No content received"))).toBe(false);
    expect(isTransientLlmError("timeout")).toBe(false);
  });
});
