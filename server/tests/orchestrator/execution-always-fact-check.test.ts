import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Stage 2 (fact grounding) runs on EVERY reply, not only when the Stage 1
 * classifier sets requiresFactCheck. Incident: an org with zero documents,
 * the AI said "We absolutely do ship to Portugal", Stage 1 reported no
 * specific claims, Stage 2 was skipped and the reply went out.
 *
 * Unflagged replies get a grounding-only check: a high score passes them
 * untouched (low retrieval quality alone never escalates a claim-free reply);
 * a low score falls into the full assessment → escalate/fallback path.
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

import { ExecutionLayer, type ExecutionResult } from "../../orchestrator/execution.layer";
import type { ConfidenceContext } from "@server/services/core/confidence-guardrail.service";

type GuardrailInvoker = {
  applyConfidenceGuardrails: (
    result: ExecutionResult,
    conversation: unknown,
    customerLanguage?: string,
  ) => Promise<ExecutionResult>;
};

const stageOne = (requiresFactCheck: boolean) => ({
  passed: true,
  violationType: "none",
  severity: "none",
  reasoning: "No specific claims",
  shouldBlock: false,
  requiresFactCheck,
});

const lowAssessment = {
  score: 0.07,
  breakdown: { grounding: 0.1, retrieval: 0, certainty: 0.1 },
  tier: "low" as const,
  shouldRecheck: false,
  shouldEscalate: true,
  documentsUsed: [],
  details: "low",
};

// No documents, no playbook, no tool results.
const conversation = {
  id: "conv-1",
  organization_id: "org-1",
  playbook_id: null,
  document_ids: null,
  getMessages: async () => [],
  getLastCustomerMessage: async () => ({ content: "do you ship to Portugal?" }),
};

describe("ExecutionLayer Stage 2 runs on every reply", () => {
  let layer: ExecutionLayer;
  let assessGrounding: jest.Mock<(ctx: ConfidenceContext) => Promise<number>>;
  let assessConfidence: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  let anyLayer: Record<string, unknown>;

  const invoke = (userMessage: string): Promise<ExecutionResult> =>
    (layer as unknown as GuardrailInvoker).applyConfidenceGuardrails(
      { step: "RESPOND", userMessage },
      conversation,
      "en",
    );

  beforeEach(() => {
    layer = new ExecutionLayer();
    assessGrounding = jest.fn<(ctx: ConfidenceContext) => Promise<number>>();
    assessConfidence = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => lowAssessment);

    anyLayer = layer as unknown as Record<string, unknown>;
    anyLayer.confidenceService = { assessGrounding, assessConfidence };
    anyLayer.getActionClaimConfig = jest.fn(async () => ({ enabled: false }));
    anyLayer.assessCompanyInterest = jest.fn(async () => stageOne(false));
    anyLayer.getConfidenceConfig = jest.fn(async () => ({
      highThreshold: 0.8,
      mediumThreshold: 0.5,
      enableRecheck: true,
      enableEscalation: true,
      fallbackMessage: "Let me connect you with a team member.",
    }));
    anyLayer.composeContextualFallbackMessage = jest.fn(
      async (_conv: unknown, message: string) => message,
    );
    anyLayer.isQuickCheckEnabled = jest.fn(async () => false);
  });

  it("asks the team instead of handing off when quick checks are on (D19)", async () => {
    assessGrounding.mockResolvedValue(0.1);
    anyLayer.isQuickCheckEnabled = jest.fn(async () => true);

    const outcome = await invoke("We absolutely do ship to Portugal!");

    expect(outcome.step).toBe("ASK_TEAM");
    expect(outcome.teamQuestion).toBe("do you ship to Portugal?");
    // Kept so run.ts can hand off as before when the check isn't allowed.
    expect(outcome.userMessage).toBe("Let me connect you with a team member.");
    expect(outcome.handoff?.reason).toMatch(/Low confidence/);
  });

  it("hands off when Stage 1 saw no claims but grounding is low", async () => {
    assessGrounding.mockResolvedValue(0.1);

    const outcome = await invoke("We absolutely do ship to Portugal!");

    expect(assessGrounding).toHaveBeenCalledTimes(1);
    // The full assessment reuses the grounding score instead of re-asking.
    expect(assessConfidence).toHaveBeenCalledTimes(1);
    expect(assessConfidence.mock.calls[0][2]).toEqual({ grounding: 0.1 });
    expect(outcome.step).toBe("HANDOFF");
    expect(outcome.userMessage).toBe("Let me connect you with a team member.");
    expect(outcome.originalMessage).toBe("We absolutely do ship to Portugal!");
    expect(outcome.confidence).toEqual(lowAssessment);
    expect(outcome.companyInterest).toEqual(stageOne(false));
  });

  it("swaps in the fallback message when escalation is disabled and the recheck stays low", async () => {
    assessGrounding.mockResolvedValue(0.1);
    assessConfidence.mockResolvedValue({
      ...lowAssessment,
      tier: "medium",
      shouldRecheck: true,
      shouldEscalate: false,
    });
    anyLayer.getConfidenceConfig = jest.fn(async () => ({
      mediumThreshold: 0.5,
      enableEscalation: false,
      fallbackMessage: "Let me connect you with a team member.",
    }));
    anyLayer.performRecheck = jest.fn(async () => ({
      userMessage: "Yes, Portugal is covered.",
      confidence: { ...lowAssessment, shouldEscalate: false },
    }));

    const outcome = await invoke("We absolutely do ship to Portugal!");

    expect(outcome.step).toBe("RESPOND");
    expect(outcome.userMessage).toBe("Let me connect you with a team member.");
    expect(outcome.recheckAttempted).toBe(true);
  });

  it("passes a grounded reply without the full assessment", async () => {
    assessGrounding.mockResolvedValue(0.95);

    const outcome = await invoke("Let me check that for you.");

    expect(assessGrounding).toHaveBeenCalledTimes(1);
    expect(assessConfidence).not.toHaveBeenCalled();
    expect(outcome.step).toBe("RESPOND");
    expect(outcome.userMessage).toBe("Let me check that for you.");
    expect(outcome.confidence).toBeUndefined();
  });

  it("does not escalate a greeting when no documents were retrieved", async () => {
    assessGrounding.mockResolvedValue(1);

    const outcome = await invoke("Hi! How can I help you today?");

    const context = assessGrounding.mock.calls[0][0];
    expect(context.retrievedDocuments).toEqual([]);
    expect(context.response).toBe("Hi! How can I help you today?");
    expect(assessConfidence).not.toHaveBeenCalled();
    expect(outcome.step).toBe("RESPOND");
    expect(outcome.userMessage).toBe("Hi! How can I help you today?");
  });

  it("keeps the full assessment for replies Stage 1 flags", async () => {
    anyLayer.assessCompanyInterest = jest.fn(async () => stageOne(true));

    const outcome = await invoke("Our return window is 90 days.");

    expect(assessGrounding).not.toHaveBeenCalled();
    expect(assessConfidence).toHaveBeenCalledTimes(1);
    expect(assessConfidence.mock.calls[0][2]).toBeUndefined();
    expect(outcome.step).toBe("HANDOFF");
  });
});
