import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Stage 0 guardrail: detects RESPOND messages claiming a state-changing action
 * ("I've initiated the cancellation") with no backing tool call this turn.
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
  ActionClaimGuardrailService,
  type ActionClaimContext,
} from "@server/services/core/action-claim-guardrail.service";
import type { Message } from "@server/database/entities/message.entity";

const baseContext = (overrides: Partial<ActionClaimContext> = {}): ActionClaimContext => ({
  response: "I've initiated the cancellation process for your order #1001.",
  customerQuery: "sure",
  conversationHistory: [] as Message[],
  toolsCalledThisTurn: [],
  ...overrides,
});

const llmVerdict = (verdict: {
  claimsAction: boolean;
  claimedActions?: string[];
  backedByTools: boolean;
  reasoning?: string;
}) =>
  invoke.mockResolvedValue(
    JSON.stringify({
      claimedActions: [],
      reasoning: "test",
      ...verdict,
    }),
  );

describe("ActionClaimGuardrailService.assessActionClaim", () => {
  let service: ActionClaimGuardrailService;

  beforeEach(() => {
    invoke.mockReset();
    getPrompt.mockReset();
    getPrompt.mockResolvedValue("evaluation prompt");
    service = new ActionClaimGuardrailService();
  });

  it("passes when the response makes no action claim", async () => {
    llmVerdict({ claimsAction: false, backedByTools: true });

    const assessment = await service.assessActionClaim(baseContext());

    expect(assessment.passed).toBe(true);
    expect(assessment.claimsAction).toBe(false);
  });

  it("fails when an action is claimed and no tool was called this turn", async () => {
    llmVerdict({
      claimsAction: true,
      claimedActions: ["initiated order cancellation"],
      backedByTools: false,
    });

    const assessment = await service.assessActionClaim(baseContext());

    expect(assessment.passed).toBe(false);
    expect(assessment.claimedActions).toEqual(["initiated order cancellation"]);
  });

  it("passes when the claim is backed by a successful tool call", async () => {
    llmVerdict({
      claimsAction: true,
      claimedActions: ["cancelled order"],
      backedByTools: true,
    });

    const assessment = await service.assessActionClaim(
      baseContext({ toolsCalledThisTurn: [{ name: "shopify_cancel_order", success: true }] }),
    );

    expect(assessment.passed).toBe(true);
  });

  it("formats the tool ledger with success/failure status into the prompt", async () => {
    llmVerdict({ claimsAction: false, backedByTools: true });

    await service.assessActionClaim(
      baseContext({
        toolsCalledThisTurn: [
          { name: "shopify_cancel_order", success: false },
          { name: "shopify_get_order_by_name", success: true },
        ],
      }),
    );

    const vars = getPrompt.mock.calls[0][1];
    expect(vars.toolLedger).toContain("shopify_cancel_order — FAILED");
    expect(vars.toolLedger).toContain("shopify_get_order_by_name — SUCCESS");
  });

  it("reports an empty ledger explicitly in the prompt", async () => {
    llmVerdict({ claimsAction: false, backedByTools: true });

    await service.assessActionClaim(baseContext());

    const vars = getPrompt.mock.calls[0][1];
    expect(vars.toolLedger).toContain("none");
  });

  it("fails open when the LLM call errors", async () => {
    invoke.mockRejectedValue(new Error("provider down"));

    const assessment = await service.assessActionClaim(baseContext());

    expect(assessment.passed).toBe(true);
  });

  it("short-circuits without an LLM call when disabled", async () => {
    const assessment = await service.assessActionClaim(baseContext(), { enabled: false });

    expect(assessment.passed).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(getPrompt).not.toHaveBeenCalled();
  });
});

describe("ActionClaimGuardrailService.mergeConfig", () => {
  it("returns defaults when no settings are provided", () => {
    const config = ActionClaimGuardrailService.mergeConfig(undefined, undefined);

    expect(config).toEqual({ enabled: true, maxRetries: 1, escalateOnFailure: true });
  });

  it("applies organization-level overrides", () => {
    const config = ActionClaimGuardrailService.mergeConfig(
      { actionClaimGuardrail: { maxRetries: 2, escalateOnFailure: false } },
      undefined,
    );

    expect(config.enabled).toBe(true);
    expect(config.maxRetries).toBe(2);
    expect(config.escalateOnFailure).toBe(false);
  });

  it("lets agent-level overrides win over organization settings", () => {
    const config = ActionClaimGuardrailService.mergeConfig(
      { actionClaimGuardrail: { enabled: false } },
      { actionClaimGuardrail: { enabled: true } },
    );

    expect(config.enabled).toBe(true);
  });
});
