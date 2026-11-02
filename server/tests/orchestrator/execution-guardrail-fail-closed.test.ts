import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Replies the guardrails could not check, and greeting/closing turns: a reply
 * that states numbers, amounts or links is never sent unchecked.
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

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import {
  ExecutionLayer,
  type ExecutionResult,
  type ExecuteOptions,
} from "../../orchestrator/execution.layer";

type GuardrailInvoker = {
  applyConfidenceGuardrails: (
    result: ExecutionResult,
    conversation: unknown,
    customerLanguage?: string,
    options?: ExecuteOptions,
  ) => Promise<ExecutionResult>;
};

const conversationWith = (intent: string) => ({
  id: "conv-1",
  organization_id: "org-1",
  getMessages: async () => [],
  getLastCustomerMessage: async () => ({ content: "thanks, bye", intent }),
});

describe("ExecutionLayer guardrails fail closed", () => {
  let layer: ExecutionLayer;
  let anyLayer: Record<string, unknown>;
  let executeSpy: jest.Mock<(...args: unknown[]) => Promise<ExecutionResult | null>>;
  let assessCompanyInterest: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

  const invoke = (userMessage: string, intent = "question") =>
    (layer as unknown as GuardrailInvoker).applyConfidenceGuardrails(
      { step: "RESPOND", userMessage },
      conversationWith(intent),
      "en",
      { turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 0, linkRetries: 0 } },
    );

  beforeEach(() => {
    layer = new ExecutionLayer();
    executeSpy = jest.fn<(...args: unknown[]) => Promise<ExecutionResult | null>>();
    assessCompanyInterest = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
      passed: true,
      violationType: "none",
      severity: "none",
      reasoning: "ok",
      shouldBlock: false,
      requiresFactCheck: false,
    }));
    anyLayer = layer as unknown as Record<string, unknown>;
    anyLayer.getActionClaimConfig = jest.fn(async () => ({ enabled: false }));
    anyLayer.applyLinkGuardrail = jest.fn(async () => null);
    anyLayer.assessCompanyInterest = assessCompanyInterest;
    anyLayer.assessUnflaggedResponseGrounding = jest.fn(async () => null);
    anyLayer.getCompanyInterestConfig = jest.fn(async () => ({ enabled: true, maxRetries: 1 }));
    anyLayer.getConfidenceConfig = jest.fn(async () => ({
      fallbackMessage: "Let me connect you with a team member.",
    }));
    anyLayer.composeContextualFallbackMessage = jest.fn(
      async (_conv: unknown, message: string) => message,
    );
    anyLayer.execute = executeSpy;
  });

  it("still skips the checks for a plain goodbye", async () => {
    const outcome = await invoke("Glad I could help, have a great day!", "close_satisfied");

    expect(assessCompanyInterest).not.toHaveBeenCalled();
    expect(outcome.step).toBe("RESPOND");
  });

  it("checks a goodbye that states an amount or a link", async () => {
    await invoke("Your refund of $50 is on its way, see https://shop.example/r", "close_satisfied");

    expect(assessCompanyInterest).toHaveBeenCalledTimes(1);
  });

  it("hands off without a re-plan when the company check could not run", async () => {
    assessCompanyInterest.mockResolvedValue({
      passed: false,
      violationType: "none",
      severity: "none",
      reasoning: "Company interest check unavailable - reply needs review",
      shouldBlock: true,
      requiresFactCheck: false,
      evaluationFailed: true,
    });

    const outcome = await invoke("Your refund of $50 was issued.");

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.step).toBe("HANDOFF");
    expect(outcome.handoff?.reason).toBe("Company interest check unavailable");
  });

  it("hands off without a re-plan when the action-claim check could not run", async () => {
    anyLayer.getActionClaimConfig = jest.fn(async () => ({
      enabled: true,
      maxRetries: 1,
      escalateOnFailure: true,
    }));
    anyLayer.actionClaimService = {
      assessActionClaim: jest.fn(async () => ({
        claimsAction: true,
        claimedActions: [],
        backedByTools: false,
        reasoning: "Action claim check unavailable - reply needs review",
        passed: false,
        evaluationFailed: true,
      })),
    };

    const outcome = await invoke("I've cancelled your order.");

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.step).toBe("HANDOFF");
    expect(outcome.handoff?.reason).toBe("Action claim check unavailable");
  });
});
