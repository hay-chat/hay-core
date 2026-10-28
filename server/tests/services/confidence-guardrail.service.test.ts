import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Stage 2 grounding score. With no retrieved documents the LLM is still asked
 * (with an explicit "nothing was retrieved" placeholder) instead of the score
 * being short-circuited to 0 — otherwise every greeting in an org with no
 * documents would escalate once Stage 2 runs on every reply.
 */

const invoke = jest.fn<(args: unknown) => Promise<string>>();
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: class {
    invoke = (args: unknown) => invoke(args);
  },
}));

const getPrompt = jest.fn<(id: string, vars: Record<string, unknown>) => Promise<string>>();
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({ getPrompt }) },
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import {
  ConfidenceGuardrailService,
  NO_DOCUMENTS_PLACEHOLDER,
  type ConfidenceContext,
} from "@server/services/core/confidence-guardrail.service";
import type { Document } from "@server/entities/document.entity";
import type { Message } from "@server/database/entities/message.entity";

const context = (overrides: Partial<ConfidenceContext> = {}): ConfidenceContext => ({
  response: "Hi! How can I help you today?",
  retrievedDocuments: [],
  conversationHistory: [] as Message[],
  customerQuery: "hello",
  organizationId: "org-1",
  ...overrides,
});

describe("ConfidenceGuardrailService grounding", () => {
  let service: ConfidenceGuardrailService;

  beforeEach(() => {
    invoke.mockReset();
    getPrompt.mockReset();
    getPrompt.mockResolvedValue("rendered prompt");
    service = new ConfidenceGuardrailService();
  });

  it("asks the LLM with the no-documents placeholder instead of returning 0", async () => {
    invoke.mockResolvedValue(JSON.stringify({ score: 1, reasoning: "greeting, no claims" }));

    const score = await service.assessGrounding(context());

    expect(score).toBe(1);
    expect(getPrompt).toHaveBeenCalledWith(
      "execution/confidence-grounding",
      expect.objectContaining({ retrievedDocuments: NO_DOCUMENTS_PLACEHOLDER }),
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("returns the LLM's low score for a company claim with no documents", async () => {
    invoke.mockResolvedValue(JSON.stringify({ score: 0.1, reasoning: "unverified shipping" }));

    const score = await service.assessGrounding(
      context({ response: "We absolutely do ship to Portugal!" }),
    );

    expect(score).toBe(0.1);
  });

  it("formats retrieved documents when there are some", async () => {
    invoke.mockResolvedValue(JSON.stringify({ score: 0.9, reasoning: "matches" }));

    await service.assessGrounding(
      context({
        retrievedDocuments: [
          {
            document: { id: "d1", title: "Shipping", content: "We ship to EU." } as Document,
            similarity: 0.8,
          },
        ],
      }),
    );

    const vars = getPrompt.mock.calls[0][1];
    expect(vars.retrievedDocuments).toContain("[Document 1: Shipping]");
    expect(vars.retrievedDocuments).not.toContain(NO_DOCUMENTS_PLACEHOLDER);
  });

  it("reuses a precomputed grounding score in the full assessment", async () => {
    // Only the certainty call should reach the LLM.
    invoke.mockResolvedValue(JSON.stringify({ score: 0.5, reasoning: "certainty" }));

    const assessment = await service.assessConfidence(context(), undefined, { grounding: 0.1 });

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(getPrompt).toHaveBeenCalledWith("execution/confidence-certainty", expect.anything());
    expect(assessment.breakdown.grounding).toBe(0.1);
    expect(assessment.tier).toBe("low");
    expect(assessment.shouldEscalate).toBe(true);
  });
});
