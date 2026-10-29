import { describe, it, expect, jest } from "@jest/globals";

/**
 * When planning fails (provider overloaded or hung after the retry) the turn is
 * a hand-off flagged aiUnavailable, never "please try again".
 */

jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));
jest.mock("@server/services/core/confidence-guardrail.service", () => ({
  ConfidenceGuardrailService: class {},
}));
jest.mock("@server/services/core/company-interest-guardrail.service", () => ({
  CompanyInterestGuardrailService: class {},
}));
jest.mock("@server/services/core/action-claim-guardrail.service", () => ({
  ActionClaimGuardrailService: class {},
}));
jest.mock("@server/services/media-analysis/pipeline", () => ({
  waitForMediaAnalysis: async () => undefined,
}));
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { ExecutionLayer } from "../../orchestrator/execution.layer";
import type { Conversation } from "@server/database/entities/conversation.entity";

describe("ExecutionLayer when the AI is unavailable", () => {
  it("returns a hand-off instead of an error reply", async () => {
    const conversation = {
      id: "conv-1",
      organization_id: "org-1",
      getMessages: async () => {
        throw new Error("Failed to generate chat response: Error: 529 Platform overloaded.");
      },
    } as unknown as Conversation;

    const result = await new ExecutionLayer().execute(conversation, "en");

    expect(result).toEqual(
      expect.objectContaining({ step: "HANDOFF", aiUnavailable: true, handoff: expect.anything() }),
    );
    expect(result?.userMessage).toBeUndefined();
  });
});
