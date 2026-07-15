import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Stage 2 grounding-context assembly inside ExecutionLayer.
 *
 * assessResponseConfidence builds the document set the fact-checker verifies
 * the response against. The active playbook must be included as an
 * authoritative source (its instructions are company policy for the
 * conversation), and failed tool calls must be excluded (error payloads are
 * not grounding evidence).
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
jest.mock("@server/repositories/document.repository", () => ({
  documentRepository: { findById: jest.fn() },
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
import type { ConfidenceContext } from "@server/services/core/confidence-guardrail.service";

type ConfidenceInvoker = {
  assessResponseConfidence: (conversation: unknown, response: string) => Promise<unknown>;
};

const playbookContent =
  "**Playbook: Refund Request Handling**\nIf the order is unfulfilled, cancel it instead of refunding.";

const messages = [
  { id: "m1", type: "Customer", content: "I'd like to return my order" },
  {
    id: "m2",
    type: "Playbook",
    content: playbookContent,
    metadata: { playbookId: "pb-1", playbookTitle: "Refund Request Handling" },
  },
  {
    id: "m3",
    type: "Tool",
    content: "Action completed: shopify:get-order",
    metadata: {
      toolName: "shopify:get-order",
      toolStatus: "SUCCESS",
      toolOutput: { order: "#1001", fulfillment_status: "unfulfilled" },
    },
  },
  {
    id: "m4",
    type: "Tool",
    content: "Action failed: shopify:get-order-status",
    metadata: {
      toolName: "shopify:get-order-status",
      toolStatus: "ERROR",
      toolOutput: { error: "Input validation error" },
    },
  },
];

const conversation = {
  id: "conv-1",
  organization_id: "org-1",
  playbook_id: "pb-1",
  document_ids: null,
  getMessages: async () => messages,
  getLastCustomerMessage: async () => ({ content: "I'd like to return my order" }),
};

describe("ExecutionLayer.assessResponseConfidence (grounding context)", () => {
  let layer: ExecutionLayer;
  let assessConfidence: jest.Mock<(...args: unknown[]) => Promise<unknown>>;

  beforeEach(() => {
    layer = new ExecutionLayer();
    assessConfidence = jest.fn(async () => ({ score: 1, tier: "high" }));

    const anyLayer = layer as unknown as Record<string, unknown>;
    anyLayer.confidenceService = { assessConfidence };
    anyLayer.getConfidenceConfig = jest.fn(async () => ({}));
  });

  const invoke = () =>
    (layer as unknown as ConfidenceInvoker).assessResponseConfidence(
      conversation,
      "Your order #1001 is unfulfilled, so we can cancel it rather than refund.",
    );

  it("includes the active playbook as an authoritative synthetic document", async () => {
    await invoke();

    const context = assessConfidence.mock.calls[0][0] as ConfidenceContext;
    const playbookDoc = context.retrievedDocuments.find((d) => d.document.id === "playbook-pb-1");

    expect(playbookDoc).toBeDefined();
    expect(playbookDoc!.document.title).toBe("Active Playbook: Refund Request Handling");
    expect(playbookDoc!.document.content).toBe(playbookContent);
    expect(playbookDoc!.similarity).toBe(0.95);
  });

  it("includes successful tool results but excludes failed tool calls", async () => {
    await invoke();

    const context = assessConfidence.mock.calls[0][0] as ConfidenceContext;
    const toolDocs = context.retrievedDocuments.filter((d) =>
      d.document.id.startsWith("tool-result-"),
    );

    expect(toolDocs.map((d) => d.document.id)).toEqual(["tool-result-m3"]);
    expect(toolDocs[0].document.content).toContain("unfulfilled");
  });

  it("adds no playbook document when the conversation has none", async () => {
    await (layer as unknown as ConfidenceInvoker).assessResponseConfidence(
      { ...conversation, playbook_id: null },
      "Hello!",
    );

    const context = assessConfidence.mock.calls[0][0] as ConfidenceContext;
    expect(context.retrievedDocuments.some((d) => d.document.id.startsWith("playbook-"))).toBe(
      false,
    );
  });
});
