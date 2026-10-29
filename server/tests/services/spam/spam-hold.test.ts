import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const mockUpdate = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => null);
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: { update: mockUpdate },
}));

const mockFindMessages = jest.fn<(...args: unknown[]) => Promise<Array<{ content: string }>>>();
const mockFindSettings = jest.fn<(...args: unknown[]) => Promise<unknown>>();
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    getRepository: (entity: { name: string }) =>
      entity.name === "WebchatSettings"
        ? { findOne: mockFindSettings }
        : { find: mockFindMessages },
  },
}));

const mockInvoke = jest.fn<(...args: unknown[]) => Promise<{ content: string }>>();
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: class {
    invokeWithMeta = mockInvoke;
  },
}));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({ getPrompt: async () => "prompt" }) },
}));

import { holdIfSpam } from "@server/services/spam/spam-hold.service";
import type { Conversation } from "@server/database/entities/conversation.entity";

const log = { info: jest.fn(), warn: jest.fn() };
const conversation = (overrides: Partial<Conversation> = {}) =>
  ({
    id: "c1",
    organization_id: "o1",
    channel: "web",
    spam_flagged_at: null,
    needs_processing: true,
    metadata: {},
    ...overrides,
  }) as Conversation;

describe("holdIfSpam", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindSettings.mockResolvedValue({ spamClassifierEnabled: false, spamGuidance: null });
  });

  it("lets a normal shopper through and records the check", async () => {
    mockFindMessages.mockResolvedValueOnce([{ content: "Where is my order?" }]);
    await expect(holdIfSpam(conversation(), log)).resolves.toBe(false);
    const update = mockUpdate.mock.calls[0][2] as { metadata: { spamCheck: { screened: number } } };
    expect(update.metadata.spamCheck.screened).toBe(1);
    expect(update).not.toHaveProperty("spam_flagged_at");
  });

  it("holds obvious spam: flags it, never bills it and parks it", async () => {
    mockFindMessages.mockResolvedValueOnce([
      { content: "SEO backlinks https://a.test https://b.test https://c.test" },
    ]);
    await expect(holdIfSpam(conversation(), log)).resolves.toBe(true);
    const update = mockUpdate.mock.calls[0][2] as Record<string, unknown>;
    expect(update.spam_flagged_at).toBeInstanceOf(Date);
    expect(update.spam_reason).toMatch(/^detector:.*links/);
    expect(update.needs_processing).toBe(false);
  });

  it("keeps an already flagged conversation away from the AI", async () => {
    await expect(holdIfSpam(conversation({ spam_flagged_at: new Date() }), log)).resolves.toBe(
      true,
    );
    expect(mockUpdate).toHaveBeenCalledWith("c1", "o1", { needs_processing: false });
    expect(mockFindMessages).not.toHaveBeenCalled();
  });

  it("never screens again after staff marked it not spam, or other channels", async () => {
    const cleared = { spamCheck: { clearedAt: "2026-10-28T00:00:00Z", screened: 1 } };
    await expect(holdIfSpam(conversation({ metadata: cleared }), log)).resolves.toBe(false);
    await expect(holdIfSpam(conversation({ channel: "email" }), log)).resolves.toBe(false);
    expect(mockFindMessages).not.toHaveBeenCalled();
  });

  it("asks the classifier about suspicious chats only when the owner enabled it", async () => {
    mockFindMessages.mockResolvedValue([{ content: "https://promo.test/deal" }]);
    await expect(holdIfSpam(conversation(), log)).resolves.toBe(false);
    expect(mockInvoke).not.toHaveBeenCalled();

    mockFindSettings.mockResolvedValue({ spamClassifierEnabled: true, spamGuidance: "No promos" });
    mockInvoke.mockResolvedValueOnce({
      content: JSON.stringify({ is_spam: true, reason: "promo" }),
    });
    await expect(holdIfSpam(conversation(), log)).resolves.toBe(true);
    expect(mockUpdate.mock.lastCall?.[2]).toMatchObject({ spam_reason: "detector:classifier" });
  });

  it("fails open when the classifier errors", async () => {
    mockFindMessages.mockResolvedValue([{ content: "https://promo.test/deal" }]);
    mockFindSettings.mockResolvedValue({ spamClassifierEnabled: true, spamGuidance: null });
    mockInvoke.mockRejectedValueOnce(new Error("provider down"));
    await expect(holdIfSpam(conversation(), log)).resolves.toBe(false);
  });
});
