import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Limits on one turn: planner calls, the organization's daily token budget and
 * how deep confidence rechecks may go. Each ends in a hand-off or a stop rather
 * than more LLM calls.
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

const mockOverBudget = jest.fn(async () => false);
jest.mock("@server/services/llm/org-usage-budget", () => ({
  isOrgOverBudget: () => mockOverBudget(),
}));

import { ExecutionLayer, type ExecuteOptions } from "../../orchestrator/execution.layer";
import type { Conversation } from "@server/database/entities/conversation.entity";

const getMessages = jest.fn(async () => []);
const conversation = {
  id: "conv-1",
  organization_id: "org-1",
  playbook_id: null,
  document_ids: null,
  getMessages,
  getPublicMessages: async () => [],
  getLastCustomerMessage: async () => ({ content: "hello" }),
} as unknown as Conversation;

const state = (plannerCalls: number) => ({
  actionClaimRetries: 0,
  companyInterestRetries: 0,
  linkRetries: 0,
  plannerCalls,
});

const stageOne = {
  passed: true,
  violationType: "none",
  severity: "none",
  reasoning: "",
  shouldBlock: false,
  requiresFactCheck: true,
};
const medium = {
  score: 0.6,
  breakdown: { grounding: 0.6, retrieval: 0.6, certainty: 0.6 },
  tier: "medium" as const,
  shouldRecheck: true,
  shouldEscalate: false,
  documentsUsed: [],
  details: "medium",
};

describe("ExecutionLayer turn limits", () => {
  let layer: ExecutionLayer;
  let anyLayer: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockOverBudget.mockResolvedValue(false);
    layer = new ExecutionLayer();
    anyLayer = layer as unknown as Record<string, unknown>;
  });

  it("hands off without planning once the turn used its planner calls", async () => {
    const options = { turnGuardrailState: state(20) };
    const result = await layer.execute(conversation, "en", options);

    expect(result).toMatchObject({ step: "HANDOFF", planningExhausted: true });
    expect(options.turnGuardrailState.plannerCalls).toBe(21);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("hands off without planning once the organization used its token budget", async () => {
    mockOverBudget.mockResolvedValue(true);
    const result = await layer.execute(conversation, "en", { turnGuardrailState: state(0) });

    expect(result).toMatchObject({ step: "HANDOFF", aiUnavailable: true });
    expect(getMessages).not.toHaveBeenCalled();
  });

  describe("confidence recheck", () => {
    const invoke = (options: ExecuteOptions) =>
      (
        layer as unknown as {
          applyConfidenceGuardrails: (...args: unknown[]) => Promise<unknown>;
        }
      ).applyConfidenceGuardrails(
        { step: "RESPOND", userMessage: "An answer" },
        conversation,
        "en",
        options,
      );
    let performRecheck: jest.Mock<(...args: unknown[]) => Promise<null>>;

    beforeEach(() => {
      performRecheck = jest.fn<(...args: unknown[]) => Promise<null>>(async () => null);
      anyLayer.performRecheck = performRecheck;
      anyLayer.confidenceService = {
        assessGrounding: jest.fn(async () => 0.6),
        assessConfidence: jest.fn(async () => medium),
      };
      anyLayer.getActionClaimConfig = jest.fn(async () => ({ enabled: false }));
      anyLayer.assessCompanyInterest = jest.fn(async () => stageOne);
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

    it("rechecks a first answer", async () => {
      await invoke({});
      expect(performRecheck).toHaveBeenCalledTimes(1);
    });

    it("does not recheck an answer that came from a recheck", async () => {
      await invoke({ recheckDepth: 1 });
      expect(performRecheck).not.toHaveBeenCalled();
    });
  });
});
