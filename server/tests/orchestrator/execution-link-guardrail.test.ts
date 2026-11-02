import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Link check inside ExecutionLayer: a reply with a bad link gets one re-plan
 * (the planner fixes the link, drops it, or hands off). A dead link that
 * survives the re-plan hands off; an unlisted one is kept.
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
import type { BadLink } from "../../services/core/link-guardrail.service";

type GuardrailInvoker = {
  applyConfidenceGuardrails: (
    result: ExecutionResult,
    conversation: unknown,
    customerLanguage?: string,
    options?: ExecuteOptions,
  ) => Promise<ExecutionResult>;
};

const conversation = {
  id: "conv-1",
  organization_id: "org-1",
  getMessages: async () => [{ content: "Doc text", metadata: {} }],
  // GREET is exempt from Stages 1/2, so a passing reply returns untouched.
  getLastCustomerMessage: async () => ({ content: "where do I buy?", intent: "greet" }),
};

const respond = (userMessage: string): ExecutionResult => ({ step: "RESPOND", userMessage });
const freshState = () => ({ actionClaimRetries: 0, companyInterestRetries: 0, linkRetries: 0 });

describe("ExecutionLayer link check", () => {
  let layer: ExecutionLayer;
  let executeSpy: jest.Mock<(...args: unknown[]) => Promise<ExecutionResult | null>>;
  let assessLinks: jest.Mock<(input: unknown) => Promise<BadLink[]>>;

  const invoke = (result: ExecutionResult, options: ExecuteOptions) =>
    (layer as unknown as GuardrailInvoker).applyConfidenceGuardrails(
      result,
      conversation,
      "en",
      options,
    );

  beforeEach(() => {
    layer = new ExecutionLayer();
    executeSpy = jest.fn<(...args: unknown[]) => Promise<ExecutionResult | null>>();
    assessLinks = jest.fn<(input: unknown) => Promise<BadLink[]>>();

    const anyLayer = layer as unknown as Record<string, unknown>;
    anyLayer.getActionClaimConfig = jest.fn(async () => ({ enabled: false }));
    anyLayer.getLinkContext = jest.fn(async () => ({ website: "shop.com", siteUrls: [] }));
    anyLayer.linkService = { assessLinks };
    anyLayer.getConfidenceConfig = jest.fn(async () => ({
      fallbackMessage: "Let me connect you with a team member.",
    }));
    anyLayer.composeContextualFallbackMessage = jest.fn(
      async (_conv: unknown, message: string) => message,
    );
    anyLayer.execute = executeSpy;
  });

  it("skips the check for replies without links", async () => {
    const outcome = await invoke(respond("Hello! How can I help?"), {
      turnGuardrailState: freshState(),
    });
    expect(assessLinks).not.toHaveBeenCalled();
    expect(outcome.step).toBe("RESPOND");
  });

  it("passes a reply whose links are fine", async () => {
    assessLinks.mockResolvedValue([]);
    const outcome = await invoke(respond("See https://shop.com/faq"), {
      turnGuardrailState: freshState(),
    });
    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.userMessage).toBe("See https://shop.com/faq");
  });

  it("re-plans once with the bad links as feedback", async () => {
    assessLinks.mockResolvedValue([{ url: "https://shop.com/sales", reason: "dead" }]);
    const retry = respond("Our sales are listed on the home page under Offers.");
    executeSpy.mockResolvedValue(retry);
    const state = freshState();

    const outcome = await invoke(respond("Go to https://shop.com/sales"), {
      turnGuardrailState: state,
    });

    expect(state.linkRetries).toBe(1);
    const feedback = (executeSpy.mock.calls[0][2] as ExecuteOptions).plannerFeedback;
    expect(feedback).toContain("https://shop.com/sales (does not exist)");
    expect(feedback).toContain("HANDOFF");
    expect(outcome.userMessage).toBe(retry.userMessage);
    expect(outcome.linkRetryAttempted).toBe(true);
  });

  it("hands off when a dead link survives the re-plan", async () => {
    assessLinks.mockResolvedValue([{ url: "https://shop.com/sales", reason: "dead" }]);
    const state = { ...freshState(), linkRetries: 1 }; // budget already spent

    const outcome = await invoke(respond("Go to https://shop.com/sales"), {
      turnGuardrailState: state,
    });

    expect(executeSpy).not.toHaveBeenCalled();
    expect(outcome.step).toBe("HANDOFF");
    expect(outcome.handoff?.fields).toEqual({ deadLinks: ["https://shop.com/sales"] });
    expect(outcome.originalMessage).toBe("Go to https://shop.com/sales");
  });

  it("keeps an unlisted link the planner kept after the re-plan", async () => {
    assessLinks.mockResolvedValue([{ url: "https://shop.com/cart", reason: "unlisted" }]);
    const state = { ...freshState(), linkRetries: 1 };

    const outcome = await invoke(respond("Check out at https://shop.com/cart"), {
      turnGuardrailState: state,
    });

    expect(outcome.step).toBe("RESPOND");
    expect(outcome.userMessage).toBe("Check out at https://shop.com/cart");
  });

  it("sends the reply unchecked when the check itself fails", async () => {
    assessLinks.mockRejectedValue(new Error("db down"));
    const outcome = await invoke(respond("See https://shop.com/x"), {
      turnGuardrailState: freshState(),
    });
    expect(outcome.step).toBe("RESPOND");
  });
});
