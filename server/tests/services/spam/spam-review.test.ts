import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockFindById = jest.fn<(...args: unknown[]) => Promise<unknown>>();
const mockUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
const mockUnanswered = jest.fn<(...args: unknown[]) => Promise<boolean>>(async () => true);
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: {
    findById: mockFindById,
    update: mockUpdate,
    hasUnansweredCustomerMessage: mockUnanswered,
  },
}));
const mockQuery = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
jest.mock("@server/database/data-source", () => ({ AppDataSource: { query: mockQuery } }));
const mockEnqueue = jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined);
jest.mock("@server/services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: mockEnqueue },
}));

const mockMarkOutcomes = jest.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
const mockClearOutcomes = jest.fn<(...args: unknown[]) => Promise<number>>(async () => 1);
jest.mock("@server/services/resolution-ledger.service", () => ({
  resolutionLedgerService: {
    markConversationSpam: mockMarkOutcomes,
    clearConversationSpam: mockClearOutcomes,
  },
}));

import { listSpam, markNotSpam, markSpam } from "@server/services/spam/spam-review.service";

const conversation = (overrides: Record<string, unknown> = {}) => ({
  id: "c1",
  organization_id: "o1",
  status: "open",
  assigned_user_id: null,
  spam_flagged_at: new Date(),
  metadata: { spamCheck: { score: 0.9, signals: ["links"], screened: 1 } },
  ...overrides,
});

describe("spam review", () => {
  beforeEach(() => jest.clearAllMocks());

  it("lists held conversations with the detector's reasons", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: "c1",
        title: null,
        channel: "web",
        status: "open",
        spam_flagged_at: new Date("2026-10-28T00:00:00Z"),
        spam_reason: "detector:links",
        spam_check: { signals: ["links"], classifier: { isSpam: true, reason: "promo" } },
        customer_name: null,
        preview: "buy",
      },
      {
        id: "c2",
        title: null,
        channel: "email",
        status: "closed",
        spam_flagged_at: new Date("2026-10-27T00:00:00Z"),
        spam_reason: "staff",
        spam_check: null,
        customer_name: "Ana",
        preview: null,
      },
    ]);
    const items = await listSpam("o1", 50);
    expect(mockQuery.mock.calls[0][1]).toEqual(["o1", 50]);
    expect(items[0]).toMatchObject({ source: "detector", signals: ["links"], classifierReason: "promo" });
    expect(items[1]).toMatchObject({ source: "staff", signals: [], customerName: "Ana" });
  });

  it("Not spam clears the flag, stops screening and re-engages the AI for a waiting shopper", async () => {
    mockFindById.mockResolvedValueOnce(conversation());
    await expect(markNotSpam("o1", "c1", "u1")).resolves.toEqual({ reengaged: true });
    const update = mockUpdate.mock.calls[0][2] as Record<string, any>;
    expect(update).toMatchObject({ spam_flagged_at: null, spam_reason: null, needs_processing: true });
    expect(update.metadata.spamCheck).toMatchObject({ clearedBy: "u1", signals: ["links"] });
    expect(mockEnqueue).toHaveBeenCalledWith("c1", "o1", "ai_return");
    expect(mockClearOutcomes).toHaveBeenCalledWith({ organizationId: "o1", conversationId: "c1", userId: "u1" });
  });

  it("Not spam leaves closed or human-handled conversations alone", async () => {
    mockFindById.mockResolvedValueOnce(conversation({ status: "closed" }));
    await expect(markNotSpam("o1", "c1", "u1")).resolves.toEqual({ reengaged: false });
    mockFindById.mockResolvedValueOnce(conversation({ assigned_user_id: "u2", status: "human-took-over" }));
    await expect(markNotSpam("o1", "c1", "u1")).resolves.toEqual({ reengaged: false });
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockUpdate.mock.calls[0][2]).not.toHaveProperty("needs_processing");
  });

  it("Mark as spam flags and holds it, and re-arms screening", async () => {
    mockFindById.mockResolvedValueOnce(
      conversation({ spam_flagged_at: null, metadata: { spamCheck: { clearedAt: "x", clearedBy: "u1" } } }),
    );
    await markSpam("o1", "c1", "u1");
    const update = mockUpdate.mock.calls[0][2] as Record<string, any>;
    expect(update).toMatchObject({ spam_reason: "staff", needs_processing: false });
    expect(update.spam_flagged_at).toBeInstanceOf(Date);
    expect(update.metadata.spamCheck).toEqual({});
    expect(mockMarkOutcomes).toHaveBeenCalledWith({ organizationId: "o1", conversationId: "c1", userId: "u1" });
  });

  it("refuses conversations from another organization", async () => {
    mockFindById.mockResolvedValueOnce(conversation({ organization_id: "other" }));
    await expect(markSpam("o1", "c1", "u1")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
