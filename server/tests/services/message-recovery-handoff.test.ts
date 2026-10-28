import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D11-1 / D5-2 for stale-message recovery: it must not reopen or post into a
 * conversation a human holds, must stay silent for a paused agent, and its
 * escalation line must not promise a reply time.
 */

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockUpdateById = jest.fn();
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: class {
    findById = (id: string) => mockFindById(id);
    updateById = mockUpdateById;
  },
  conversationRepository: { findById: (id: string) => mockFindById(id) },
}));
const mockEnqueue = jest.fn();
jest.mock("@server/services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: mockEnqueue },
}));
jest.mock("@server/services/conversation-events.service", () => ({
  conversationEventsService: { broadcastConversationUpdated: jest.fn() },
}));
jest.mock("@server/orchestrator/conversation-utils", () => ({
  generateHandoffSummary: jest.fn(async () => undefined),
}));
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

jest.mock("@server/services/stale-message-detector.service", () => ({
  StaleReason: { REPEATED_FAILURES: "repeated_failures" },
}));

import { MessageRecoveryService } from "../../services/message-recovery.service";

const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONVERSATION_ID,
    organization_id: "org-1",
    status: "open",
    assigned_user_id: null,
    deleted_at: null,
    language: "pt",
    agent: { enabled: true },
    organization: { suspendedAt: null, agentPausedAt: null, defaultLanguage: "en" },
    // Past the attempt budget, so recovery escalates to a human.
    recovery_attempts: 5,
    processing_error_count: 5,
    addMessage: jest.fn(async () => ({})),
    ...overrides,
  };
}

const stale = {
  conversationId: CONVERSATION_ID,
  stuckReason: "repeated_failures",
  staleDuration: 1000,
  processingAttempts: 5,
  processingErrorCount: 5,
} as never;

describe("MessageRecoveryService escalation", () => {
  beforeEach(() => jest.clearAllMocks());

  it("escalates with an honest line in the conversation's language", async () => {
    const conversation = makeConversation();
    mockFindById.mockResolvedValue(conversation);

    const result = await new MessageRecoveryService().recoverStaleConversation(stale);

    expect(result.action).toBe("escalated_to_human");
    expect(mockUpdateById).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ status: "pending-human" }),
    );
    const [first] = conversation.addMessage.mock.calls[0] as unknown as [{ content: string }];
    expect(first.content).toMatch(/equipe/);
    expect(first.content).not.toMatch(/shortly|em breve/i);
  });

  it("leaves a conversation a human took over untouched", async () => {
    const conversation = makeConversation({ status: "human-took-over", assigned_user_id: "u-1" });
    mockFindById.mockResolvedValue(conversation);

    const result = await new MessageRecoveryService().recoverStaleConversation(stale);

    expect(result).toEqual({ success: false, action: "skipped_human_took_over" });
    expect(mockUpdateById).not.toHaveBeenCalled();
    expect(conversation.addMessage).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("does not post when a human took over between detection and escalation", async () => {
    const conversation = makeConversation();
    mockFindById
      .mockResolvedValueOnce(conversation)
      .mockResolvedValue({ ...conversation, assigned_user_id: "u-1" });

    const result = await new MessageRecoveryService().recoverStaleConversation(stale);

    expect(result.action).toBe("skipped_assigned_to_human");
    expect(conversation.addMessage).not.toHaveBeenCalled();
  });

  it("queues a paused agent's conversation for a human without messaging the shopper", async () => {
    const conversation = makeConversation({ agent: { enabled: false } });
    mockFindById.mockResolvedValue(conversation);

    const result = await new MessageRecoveryService().recoverStaleConversation(stale);

    expect(result.action).toBe("escalated_to_human");
    expect(mockUpdateById).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ status: "pending-human" }),
    );
    const types = conversation.addMessage.mock.calls.map(
      (call) => (call as unknown as [{ type: string }])[0].type,
    );
    expect(types).toEqual(["System"]);
  });
});
