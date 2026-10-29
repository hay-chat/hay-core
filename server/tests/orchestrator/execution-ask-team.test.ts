import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D19-1: the planner's ASK_TEAM step. Offered (schema enum, teamQuestion
 * field, prompt section) only when the organization turned quick checks on;
 * an ASK_TEAM without it is a hand-off; a blank question falls back to the
 * shopper's own words.
 */

const mockInvoke = jest.fn<(options: Record<string, unknown>) => Promise<string>>();
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: class {
    invoke = mockInvoke;
  },
}));
const mockGetPrompt = jest.fn(async (_id: string, _vars: Record<string, unknown>) => "planner");
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({ getPrompt: mockGetPrompt }) },
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
jest.mock("@server/services/core/core-tools", () => ({
  coreToolRegistry: { list: () => [], has: () => false },
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

const conversation = {
  id: "conv-1",
  organization_id: "org-1",
  enabled_tools: [],
  organization: { timezone: "Europe/Lisbon" },
  getMessages: async () => [
    { type: "Customer", content: "Does the 40 cm vase ship in a gift box?" },
  ],
} as unknown as Conversation;

function plan(result: Record<string, unknown>): string {
  return JSON.stringify({
    rationale: "r",
    userMessage: null,
    toolName: null,
    toolArgs: null,
    handoffReason: null,
    closeReason: null,
    playbookFits: null,
    ...result,
  });
}

function layerWith(quickCheck: boolean): ExecutionLayer {
  const layer = new ExecutionLayer();
  const anyLayer = layer as unknown as Record<string, unknown>;
  anyLayer.isQuickCheckEnabled = jest.fn(async () => quickCheck);
  anyLayer.buildContextPrompt = jest.fn(async () => "");
  anyLayer.buildKnowledgePrompt = jest.fn(async () => "");
  return layer;
}

type Schema = {
  properties: { step: { enum: string[] } } & Record<string, unknown>;
  required: string[];
};

describe("ExecutionLayer ASK_TEAM", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockGetPrompt.mockClear();
  });

  it("offers ASK_TEAM and teamQuestion only when quick checks are on", async () => {
    mockInvoke.mockResolvedValue(plan({ step: "ASK", userMessage: "Which size?" }));

    await layerWith(false).execute(conversation, "en");
    const off = mockInvoke.mock.calls[0][0].jsonSchema as Schema;
    expect(off.properties.step.enum).not.toContain("ASK_TEAM");
    expect(off.properties.teamQuestion).toBeUndefined();
    expect(off.required).not.toContain("teamQuestion");
    expect(mockGetPrompt.mock.calls[0][1]).toMatchObject({ quickCheck: false });

    await layerWith(true).execute(conversation, "en");
    const on = mockInvoke.mock.calls[1][0].jsonSchema as Schema;
    expect(on.properties.step.enum).toContain("ASK_TEAM");
    expect(on.properties.teamQuestion).toBeDefined();
    expect(on.required).toContain("teamQuestion");
    expect(mockGetPrompt.mock.calls[1][1]).toMatchObject({ quickCheck: true });
  });

  it("returns the team question", async () => {
    mockInvoke.mockResolvedValue(
      plan({ step: "ASK_TEAM", teamQuestion: "Does the 40 cm vase come gift-boxed?" }),
    );
    const result = await layerWith(true).execute(conversation, "en");
    expect(result).toMatchObject({
      step: "ASK_TEAM",
      teamQuestion: "Does the 40 cm vase come gift-boxed?",
      handoff: { reason: "Checking a fact with the team" },
    });
  });

  it("uses the shopper's words when the planner left the question blank", async () => {
    mockInvoke.mockResolvedValue(plan({ step: "ASK_TEAM", teamQuestion: " " }));
    const result = await layerWith(true).execute(conversation, "en");
    expect(result?.teamQuestion).toBe("Does the 40 cm vase ship in a gift box?");
  });

  it("treats ASK_TEAM as a hand-off when quick checks are off", async () => {
    mockInvoke.mockResolvedValue(plan({ step: "ASK_TEAM", teamQuestion: "Gift box?" }));
    const result = await layerWith(false).execute(conversation, "en");
    expect(result?.step).toBe("HANDOFF");
    expect(result?.handoff?.reason).toBeTruthy();
  });
});
