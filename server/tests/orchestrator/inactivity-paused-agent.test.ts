import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Orchestrator.checkInactivity() writes LLM-generated "are you still there?"
 * and closing messages to the shopper. For a paused agent none of that may go
 * out: the open conversation is left alone.
 */

const mockFindAllOpen = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: class {
    findAllOpenConversations = mockFindAllOpen;
    update = mockUpdate;
    delete = mockDelete;
  },
}));

const mockSendWarning = jest.fn();
const mockClose = jest.fn();
const mockTitle = jest.fn();
jest.mock("../../orchestrator/conversation-utils", () => ({
  generateConversationTitle: mockTitle,
  sendInactivityWarning: mockSendWarning,
  closeInactiveConversation: mockClose,
}));

const mockEnqueue = jest.fn();
jest.mock("@server/services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: mockEnqueue },
}));
jest.mock("@server/services/hooks/hook-manager", () => ({ hookManager: { trigger: jest.fn() } }));
jest.mock("../../orchestrator/run", () => ({ runConversation: jest.fn() }));
jest.mock("@server/config/env", () => ({
  config: { conversation: { inactivityInterval: 60_000 } },
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { Orchestrator } from "../../orchestrator/index";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

// Last shopper message 45 s ago: past the 30 s warning threshold, before the
// 60 s close threshold, so an enabled agent would send the warning.
const openConversation = (enabled: boolean) => ({
  id: CONVERSATION_ID,
  organization_id: ORG_ID,
  status: "open",
  created_at: new Date(Date.now() - 120_000),
  agent: { id: "agent", enabled },
  playbook_id: null,
  getMessages: jest.fn(async () => [
    { type: "Customer", created_at: new Date(Date.now() - 45_000), metadata: {} },
  ]),
});

describe("checkInactivity for a paused agent", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends neither the warning nor a closing message", async () => {
    mockFindAllOpen.mockResolvedValueOnce([openConversation(false)]);

    await new Orchestrator().checkInactivity();

    expect(mockSendWarning).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockLogger.debug).toHaveBeenCalledWith("Agent paused, skipping inactivity handling");
  });

  it("still warns for an enabled agent", async () => {
    mockFindAllOpen.mockResolvedValueOnce([openConversation(true)]);

    await new Orchestrator().checkInactivity();

    expect(mockSendWarning).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID);
    expect(mockEnqueue).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, "inactivity");
  });
});
