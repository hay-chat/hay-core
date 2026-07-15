import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Stage 1 conversation-history assembly inside CompanyInterestGuardrailService.
 *
 * The checker verifies the drafted response against recent conversation
 * context. Failed tool calls must be excluded (a successful retry must not be
 * "contradicted" by its own failed first attempt), and successful tool results
 * must be labelled as tool evidence — with output — not as "Assistant" lines.
 */

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));

import { CompanyInterestGuardrailService } from "@server/services/core/company-interest-guardrail.service";
import type { Message } from "@server/database/entities/message.entity";

const messages = [
  { id: "m1", type: "Customer", content: "yes, cancel it" },
  {
    id: "m2",
    type: "Tool",
    content: "Action failed: shopify_cancel_order",
    metadata: {
      toolName: "shopify_cancel_order",
      toolStatus: "ERROR",
      toolOutput: { error: "Input validation error: reason Required" },
    },
  },
  {
    id: "m3",
    type: "Tool",
    content: "Action completed: shopify_cancel_order",
    metadata: {
      toolName: "shopify_cancel_order",
      toolStatus: "SUCCESS",
      toolOutput: { status: "CANCELLATION_ACCEPTED", orderCancelUserErrors: [] },
    },
  },
] as unknown as Message[];

describe("CompanyInterestGuardrailService conversation history", () => {
  let service: CompanyInterestGuardrailService;
  let getPrompt: jest.Mock<(...args: unknown[]) => Promise<string>>;

  beforeEach(() => {
    service = new CompanyInterestGuardrailService();
    getPrompt = jest.fn(async () => "prompt");

    const anyService = service as unknown as Record<string, unknown>;
    anyService.promptService = { getPrompt };
    anyService.llmService = {
      invoke: jest.fn(async () =>
        JSON.stringify({
          violationType: "none",
          severity: "none",
          reasoning: "ok",
          requiresFactCheck: false,
        }),
      ),
    };
  });

  const historySentToChecker = async (): Promise<string> => {
    await service.assessCompanyInterest({
      response: "Your order has been cancelled.",
      customerQuery: "yes, cancel it",
      conversationHistory: messages,
      hasRetrievedDocuments: false,
      hasToolResults: true,
    });
    const vars = getPrompt.mock.calls[0][1] as { conversationHistory: string };
    return vars.conversationHistory;
  };

  it("excludes failed tool calls from the checker's context", async () => {
    const history = await historySentToChecker();

    expect(history).not.toContain("Action failed");
    expect(history).not.toContain("Input validation error");
  });

  it("labels successful tool results as tool evidence with their output", async () => {
    const history = await historySentToChecker();

    expect(history).toContain("Tool result (shopify_cancel_order): Action completed");
    expect(history).toContain("CANCELLATION_ACCEPTED");
    expect(history).not.toContain("Assistant: Action completed");
    expect(history).toContain("Customer: yes, cancel it");
  });
});
