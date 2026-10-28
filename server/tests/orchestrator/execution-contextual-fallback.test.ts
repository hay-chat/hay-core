import { describe, it, expect, jest } from "@jest/globals";

/**
 * The contextual fallback reply is an LLM call in a conversation, so it must
 * carry the organization: that is what keeps it on the org's provider and in
 * its AI region (EU-only orgs).
 */

const mockInvoke = jest.fn(async (_options: Record<string, unknown>) => "Composed reply");
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: class {
    invoke = mockInvoke;
  },
}));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({ getPrompt: async () => "prompt" }) },
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
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { ExecutionLayer } from "../../orchestrator/execution.layer";

type FallbackComposer = {
  composeContextualFallbackMessage: (
    conversation: unknown,
    fallbackMessage: string,
    customerLanguage?: string,
  ) => Promise<string>;
};

describe("ExecutionLayer contextual fallback", () => {
  it("passes the organization to the LLM call", async () => {
    const layer = new ExecutionLayer() as unknown as FallbackComposer;
    const reply = await layer.composeContextualFallbackMessage(
      { id: "conv-1", organization_id: "org-eu", getMessages: async () => [] },
      "Let me connect you with a team member.",
    );

    expect(reply).toBe("Composed reply");
    expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-eu" }));
  });
});
