import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * Date check inside ExecutionLayer: replies without a date do no work; a reply
 * with an impossible or wrong-weekday date gets one re-plan, then a hand-off.
 * Unsourced dates are only logged until DATE_GUARD_UNSOURCED=enforce.
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
import { MessageType } from "../../database/entities/message.entity";

type GuardrailInvoker = {
  applyConfidenceGuardrails: (
    result: ExecutionResult,
    conversation: unknown,
    customerLanguage?: string,
    options?: ExecuteOptions,
  ) => Promise<ExecutionResult>;
};

const respond = (userMessage: string): ExecutionResult => ({ step: "RESPOND", userMessage });
const freshState = () => ({ actionClaimRetries: 0, companyInterestRetries: 0, linkRetries: 0 });

// 21 November 2026 is a Saturday.
const WRONG_WEEKDAY = "You should receive it by Friday 21 November.";

describe("ExecutionLayer date check", () => {
  let layer: ExecutionLayer;
  let executeSpy: jest.Mock<(...args: unknown[]) => Promise<ExecutionResult | null>>;
  let getMessages: jest.Mock<() => Promise<unknown[]>>;
  let conversation: Record<string, unknown>;

  const invoke = (result: ExecutionResult, options: ExecuteOptions) =>
    (layer as unknown as GuardrailInvoker).applyConfidenceGuardrails(
      result,
      conversation,
      "en",
      options,
    );

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date("2026-11-09T21:50:00Z"), doNotFake: ["nextTick"] });
    mockLogger.warn.mockClear();
    layer = new ExecutionLayer();
    executeSpy = jest.fn<(...args: unknown[]) => Promise<ExecutionResult | null>>();
    getMessages = jest.fn<() => Promise<unknown[]>>(async () => []);
    conversation = {
      id: "conv-1",
      organization_id: "org-1",
      organization: { timezone: "UTC" },
      document_ids: [],
      getMessages,
      getLastCustomerMessage: async () => ({ content: "bye", intent: "greet" }),
    };

    const anyLayer = layer as unknown as Record<string, unknown>;
    anyLayer.getActionClaimConfig = jest.fn(async () => ({ enabled: false }));
    anyLayer.assessCompanyInterest = jest.fn(async () => ({
      passed: true,
      violationType: "none",
      severity: "none",
      reasoning: "ok",
      shouldBlock: false,
      requiresFactCheck: false,
    }));
    anyLayer.assessUnflaggedResponseGrounding = jest.fn(async () => null);
    anyLayer.checkGrounding = jest.fn(async () => ({ context: {}, grounding: 1 }));
    anyLayer.getConfidenceConfig = jest.fn(async () => ({
      fallbackMessage: "Let me connect you with a team member.",
    }));
    anyLayer.composeContextualFallbackMessage = jest.fn(
      async (_conv: unknown, message: string) => message,
    );
    anyLayer.execute = executeSpy;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.DATE_GUARD_UNSOURCED;
  });

  it("does no work for a reply without a date", async () => {
    const outcome = await invoke(respond("It takes 3–7 business days."), {
      turnGuardrailState: freshState(),
    });
    expect(getMessages).not.toHaveBeenCalled();
    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.step).toBe("RESPOND");
  });

  it("re-plans once with the real weekday as feedback", async () => {
    const retry = respond("It usually takes 3–7 business days.");
    executeSpy.mockResolvedValue(retry);
    const state = freshState();

    const outcome = await invoke(respond(WRONG_WEEKDAY), { turnGuardrailState: state });

    expect(executeSpy).toHaveBeenCalledTimes(1);
    const feedback = (executeSpy.mock.calls[0][2] as ExecuteOptions).plannerFeedback;
    expect(feedback).toContain("that date is a Saturday");
    expect(feedback).toContain("calculate_date");
    expect(outcome).toBe(retry);
  });

  it("hands off when the retry budget is spent", async () => {
    const outcome = await invoke(respond(WRONG_WEEKDAY), {
      turnGuardrailState: { ...freshState(), dateRetries: 1 },
    });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.step).toBe("HANDOFF");
    expect(outcome.originalMessage).toBe(WRONG_WEEKDAY);
  });

  it("only logs an unsourced date by default", async () => {
    const outcome = await invoke(respond("It arrives on 17 November."), {
      turnGuardrailState: freshState(),
    });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.userMessage).toBe("It arrives on 17 November.");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining("log only"),
    );
  });

  it("re-plans on an unsourced date when enforced", async () => {
    process.env.DATE_GUARD_UNSOURCED = "enforce";
    executeSpy.mockResolvedValue(respond("It takes 3–7 business days."));
    await invoke(respond("It arrives on 17 November."), { turnGuardrailState: freshState() });
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not let the AI's own earlier reply vouch for a date", async () => {
    process.env.DATE_GUARD_UNSOURCED = "enforce";
    getMessages.mockResolvedValue([
      { type: MessageType.BOT_AGENT, content: "It arrives on 17 November.", metadata: {} },
    ]);
    executeSpy.mockResolvedValue(respond("It takes 3–7 business days."));
    await invoke(respond("As I said, 17 November."), { turnGuardrailState: freshState() });
    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts a date from a tool result when enforced", async () => {
    process.env.DATE_GUARD_UNSOURCED = "enforce";
    getMessages.mockResolvedValue([
      {
        type: MessageType.TOOL,
        content: "",
        metadata: { toolOutput: { results: [{ date: "2026-11-17" }] } },
      },
    ]);
    const outcome = await invoke(respond("It arrives by Tuesday 17 November."), {
      turnGuardrailState: freshState(),
    });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.userMessage).toBe("It arrives by Tuesday 17 November.");
  });

  it("sends the reply unchecked if loading the sources fails", async () => {
    getMessages.mockRejectedValue(new Error("db down"));
    const outcome = await invoke(respond(WRONG_WEEKDAY), { turnGuardrailState: freshState() });
    expect(outcome.userMessage).toBe(WRONG_WEEKDAY);
  });
});
