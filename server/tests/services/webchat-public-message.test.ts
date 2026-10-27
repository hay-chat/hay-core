import { describe, it, expect, jest } from "@jest/globals";

jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

import { toPublicMessage, toPublicMessageMetadata } from "@server/services/webchat/public-message";
import type { Message } from "@server/database/entities/message.entity";

// Shape of what the orchestrator stores on a bot message (orchestrator/run.ts buildMessageMetadata).
const internalMetadata = {
  companyInterest: { reasoning: "internal reasoning" },
  confidence: 0.41,
  confidenceTier: "low",
  confidenceBreakdown: { retrieval: 0.2 },
  documentsUsed: [{ id: "doc-1", title: "Refund policy (internal)" }],
  originalMessage: "The replaced low-confidence answer",
  executionRationale: "why the agent did this",
  isClosureMessage: true,
  productRecommendation: { query: "red shoes", filtersApplied: {}, products: [{ id: "p1" }] },
};

describe("toPublicMessageMetadata", () => {
  it("keeps only the fields the widget renders", () => {
    expect(toPublicMessageMetadata(internalMetadata)).toEqual({
      isClosureMessage: true,
      productRecommendation: { products: [{ id: "p1" }] },
    });
  });

  it("keeps the greeting marker the widget uses to replace its placeholder", () => {
    expect(toPublicMessageMetadata({ isGreeting: true, confidence: 0.9 })).toEqual({ isGreeting: true });
  });

  it("returns an empty object for missing or malformed metadata", () => {
    expect(toPublicMessageMetadata(null)).toEqual({});
    expect(toPublicMessageMetadata("x")).toEqual({});
    expect(toPublicMessageMetadata({ isClosureMessage: "yes" })).toEqual({});
  });
});

describe("toPublicMessage", () => {
  const message = {
    id: "m1",
    content: "Hi",
    type: "BotAgent",
    sender: "Hay.chat",
    direction: "out",
    created_at: new Date("2026-10-27T00:00:00Z"),
    metadata: internalMetadata,
    sentiment: "negative",
    intent: "refund",
  } as unknown as Message;

  it("never sends reasoning or replaced answers to the widget", () => {
    const result = toPublicMessage(message, { isPlayground: false });
    expect(result).toEqual({
      id: "m1",
      content: "Hi",
      type: "BotAgent",
      sender: "Hay.chat",
      direction: "out",
      createdAt: message.created_at,
      metadata: { isClosureMessage: true, productRecommendation: { products: [{ id: "p1" }] } },
    });
    expect(JSON.stringify(result)).not.toContain("replaced low-confidence");
  });

  it("keeps full metadata for playground (staff demo) conversations", () => {
    expect(toPublicMessage(message, { isPlayground: true }).metadata).toBe(internalMetadata);
  });
});
