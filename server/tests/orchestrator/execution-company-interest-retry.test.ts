import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Stage 1 corrective-retry flow inside ExecutionLayer.
 *
 * When the company-interest check blocks a RESPOND, the planner gets one
 * corrective re-plan with the reviewer's reasoning injected as feedback —
 * same philosophy as the Stage 0 action-claim retry. If the retry budget is
 * exhausted, the turn escalates to HANDOFF as before.
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

const blockingAssessment = {
  passed: false,
  violationType: "fabricated_policy",
  severity: "critical",
  reasoning:
    "The playbook specifies that unfulfilled orders should be treated as cancellation requests, not refund requests.",
  shouldBlock: true,
  requiresFactCheck: false,
};

const respondResult = (): ExecutionResult => ({
  step: "RESPOND",
  userMessage: "Your order is eligible for a refund of $624.95.",
});

const conversation = {
  id: "conv-1",
  organization_id: "org-1",
  getMessages: async () => [],
  getLastCustomerMessage: async () => ({ content: "i want a refund" }),
};

describe("ExecutionLayer company-interest retry (Stage 1)", () => {
  let layer: ExecutionLayer;
  let executeSpy: jest.Mock<(...args: unknown[]) => Promise<ExecutionResult | null>>;

  const invoke = (options: ExecuteOptions): Promise<ExecutionResult> =>
    (layer as unknown as GuardrailInvoker).applyConfidenceGuardrails(
      respondResult(),
      conversation,
      "en",
      options,
    );

  beforeEach(() => {
    layer = new ExecutionLayer();
    executeSpy = jest.fn<(...args: unknown[]) => Promise<ExecutionResult | null>>();

    const anyLayer = layer as unknown as Record<string, unknown>;
    anyLayer.getActionClaimConfig = jest.fn(async () => ({ enabled: false }));
    anyLayer.assessCompanyInterest = jest.fn(async () => blockingAssessment);
    anyLayer.getCompanyInterestConfig = jest.fn(async () => ({ enabled: true, maxRetries: 1 }));
    anyLayer.getConfidenceConfig = jest.fn(async () => ({
      fallbackMessage: "Let me connect you with a team member.",
    }));
    anyLayer.composeContextualFallbackMessage = jest.fn(
      async (_conv: unknown, message: string) => message,
    );
    anyLayer.execute = executeSpy;
  });

  it("re-plans once with the reviewer's reasoning as feedback", async () => {
    const retryResult: ExecutionResult = {
      step: "RESPOND",
      userMessage: "Since your order is unfulfilled, I can cancel it instead. Shall I?",
    };
    executeSpy.mockResolvedValue(retryResult);
    const turnGuardrailState = { actionClaimRetries: 0, companyInterestRetries: 0 };

    const outcome = await invoke({ turnGuardrailState });

    expect(turnGuardrailState.companyInterestRetries).toBe(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    const retryOptions = executeSpy.mock.calls[0][2] as ExecuteOptions;
    expect(retryOptions.plannerFeedback).toContain("fabricated_policy");
    expect(retryOptions.plannerFeedback).toContain("cancellation requests");
    expect(outcome.userMessage).toBe(retryResult.userMessage);
    expect(outcome.companyInterestRetryAttempted).toBe(true);
  });

  it("escalates to HANDOFF when the retry budget is exhausted", async () => {
    const outcome = await invoke({
      turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 1 },
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.step).toBe("HANDOFF");
    expect(outcome.handoff?.reason).toBe("Company interest violation: fabricated_policy");
    expect(outcome.userMessage).toBe("Let me connect you with a team member.");
    expect(outcome.companyInterestRetryAttempted).toBe(true);
  });

  it("escalates to HANDOFF when the retry returns null", async () => {
    executeSpy.mockResolvedValue(null);

    const outcome = await invoke({
      turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 0 },
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(outcome.step).toBe("HANDOFF");
  });
});
