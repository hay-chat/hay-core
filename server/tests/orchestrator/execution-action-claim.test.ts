import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Stage 0 action-claim guardrail flow inside ExecutionLayer.
 *
 * When a RESPOND claims a state-changing action with no backing tool call this
 * turn, the planner gets one corrective retry (with feedback injected into the
 * prompt); if the retry still can't back its claim, the turn escalates to
 * HANDOFF instead of sending the false claim.
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
import type { ActionClaimAssessment } from "@server/services/core/action-claim-guardrail.service";

type GuardrailInvoker = {
  applyActionClaimGuardrail: (
    result: ExecutionResult,
    conversation: unknown,
    customerLanguage?: string,
    options?: ExecuteOptions,
  ) => Promise<ExecutionResult | null>;
};

const failingAssessment: ActionClaimAssessment = {
  claimsAction: true,
  claimedActions: ["initiated order cancellation"],
  backedByTools: false,
  reasoning: "no tool call this turn",
  passed: false,
};

const passingAssessment: ActionClaimAssessment = {
  claimsAction: false,
  claimedActions: [],
  backedByTools: true,
  reasoning: "no action claimed",
  passed: true,
};

const respondResult = (): ExecutionResult => ({
  step: "RESPOND",
  userMessage: "I've initiated the cancellation process for your order #1001.",
});

const conversation = {
  id: "conv-1",
  organization_id: "org-1",
  getMessages: async () => [],
  getLastCustomerMessage: async () => ({ content: "sure" }),
};

describe("ExecutionLayer action-claim guardrail (Stage 0)", () => {
  let layer: ExecutionLayer;
  let assessActionClaim: jest.Mock<(...args: unknown[]) => Promise<ActionClaimAssessment>>;
  let executeSpy: jest.Mock<(...args: unknown[]) => Promise<ExecutionResult | null>>;

  const invokeStageZero = (
    result: ExecutionResult,
    options: ExecuteOptions,
  ): Promise<ExecutionResult | null> =>
    (layer as unknown as GuardrailInvoker).applyActionClaimGuardrail(
      result,
      conversation,
      "en",
      options,
    );

  beforeEach(() => {
    layer = new ExecutionLayer();

    assessActionClaim = jest.fn<(...args: unknown[]) => Promise<ActionClaimAssessment>>();
    executeSpy = jest.fn<(...args: unknown[]) => Promise<ExecutionResult | null>>();

    const anyLayer = layer as unknown as Record<string, unknown>;
    anyLayer.actionClaimService = { assessActionClaim };
    anyLayer.getActionClaimConfig = jest.fn(async () => ({
      enabled: true,
      maxRetries: 1,
      escalateOnFailure: true,
    }));
    anyLayer.getConfidenceConfig = jest.fn(async () => ({
      fallbackMessage: "Let me connect you with a team member.",
    }));
    anyLayer.composeContextualFallbackMessage = jest.fn(
      async (_conv: unknown, message: string) => message,
    );
    anyLayer.execute = executeSpy;
  });

  it("returns null (pass-through) when no unbacked claim is detected", async () => {
    assessActionClaim.mockResolvedValue(passingAssessment);
    const result = respondResult();

    const outcome = await invokeStageZero(result, {
      toolsCalledThisTurn: [],
      turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 0 },
    });

    expect(outcome).toBeNull();
    expect(result.actionClaim).toEqual(passingAssessment);
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it("skips assessment entirely when the guardrail is disabled", async () => {
    (layer as unknown as Record<string, unknown>).getActionClaimConfig = jest.fn(async () => ({
      enabled: false,
      maxRetries: 1,
      escalateOnFailure: true,
    }));

    const outcome = await invokeStageZero(respondResult(), {
      turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 0 },
    });

    expect(outcome).toBeNull();
    expect(assessActionClaim).not.toHaveBeenCalled();
  });

  it("re-plans once with corrective feedback and returns the retry's CALL_TOOL unmodified", async () => {
    assessActionClaim.mockResolvedValue(failingAssessment);
    const retryResult: ExecutionResult = {
      step: "CALL_TOOL",
      tool: { name: "shopify_cancel_order", args: { orderId: "1001" } },
    };
    executeSpy.mockResolvedValue(retryResult);
    const turnGuardrailState = { actionClaimRetries: 0, companyInterestRetries: 0 };

    const outcome = await invokeStageZero(respondResult(), {
      toolsCalledThisTurn: [],
      turnGuardrailState,
    });

    expect(turnGuardrailState.actionClaimRetries).toBe(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    const retryOptions = executeSpy.mock.calls[0][2] as ExecuteOptions;
    expect(retryOptions.plannerFeedback).toContain("initiated order cancellation");
    expect(retryOptions.plannerFeedback).toContain("CALL_TOOL");
    expect(outcome?.step).toBe("CALL_TOOL");
    expect(outcome?.tool?.name).toBe("shopify_cancel_order");
    expect(outcome?.actionClaimRetryAttempted).toBe(true);
  });

  it("escalates to HANDOFF when the retry budget is exhausted", async () => {
    assessActionClaim.mockResolvedValue(failingAssessment);
    const original = respondResult();

    const outcome = await invokeStageZero(original, {
      toolsCalledThisTurn: [],
      turnGuardrailState: { actionClaimRetries: 1, companyInterestRetries: 0 }, // budget already spent
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome?.step).toBe("HANDOFF");
    expect(outcome?.handoff?.reason).toBe("Claimed action without tool execution");
    expect(outcome?.handoff?.fields?.claimedActions).toEqual(["initiated order cancellation"]);
    expect(outcome?.userMessage).toBe("Let me connect you with a team member.");
    expect(outcome?.originalMessage).toBe(original.userMessage);
  });

  it("escalates to HANDOFF when the retry returns null instead of propagating it", async () => {
    assessActionClaim.mockResolvedValue(failingAssessment);
    executeSpy.mockResolvedValue(null);

    const outcome = await invokeStageZero(respondResult(), {
      toolsCalledThisTurn: [],
      turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 0 },
    });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(outcome?.step).toBe("HANDOFF");
    expect(outcome?.handoff?.reason).toBe("Claimed action without tool execution");
  });

  it("replaces the message with the fallback when escalation is disabled", async () => {
    assessActionClaim.mockResolvedValue(failingAssessment);
    (layer as unknown as Record<string, unknown>).getActionClaimConfig = jest.fn(async () => ({
      enabled: true,
      maxRetries: 0,
      escalateOnFailure: false,
    }));
    const original = respondResult();
    const originalText = original.userMessage;

    const outcome = await invokeStageZero(original, {
      toolsCalledThisTurn: [],
      turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 0 },
    });

    expect(outcome?.step).toBe("RESPOND");
    expect(outcome?.userMessage).toBe("Let me connect you with a team member.");
    expect(outcome?.originalMessage).toBe(originalText);
  });

  it("passes the turn's tool ledger to the assessment", async () => {
    assessActionClaim.mockResolvedValue(passingAssessment);
    const ledger = [{ name: "shopify_cancel_order", success: true }];

    await invokeStageZero(respondResult(), {
      toolsCalledThisTurn: ledger,
      turnGuardrailState: { actionClaimRetries: 0, companyInterestRetries: 0 },
    });

    const context = assessActionClaim.mock.calls[0][0] as { toolsCalledThisTurn: unknown };
    expect(context.toolsCalledThisTurn).toBe(ledger);
  });
});
