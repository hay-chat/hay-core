import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * runConversation() on a channel whose AI mode is "off" (D7-14, "start on Web
 * Chat only"): no reply and no notice; the conversation waits for the team as
 * pending-human. Test conversations (playground, replays) still run.
 */

const mockFindById = jest.fn();
const mockUpdate = jest.fn();
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: { findById: mockFindById, update: mockUpdate },
}));
jest.mock("@server/repositories/playbook.repository", () => ({ playbookRepository: {} }));
jest.mock("@server/repositories/agent.repository", () => ({ agentRepository: {} }));
jest.mock("@server/repositories/user.repository", () => ({ userRepository: {} }));
jest.mock("@server/services/conversation-secret.service", () => ({
  conversationSecretService: {},
}));
jest.mock("@server/services/core/tool-execution.service", () => ({
  ToolExecutionService: class {},
}));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));
jest.mock("../../orchestrator/perception.layer", () => ({ PerceptionLayer: class {} }));
jest.mock("../../orchestrator/retrieval.layer", () => ({ RetrievalLayer: class {} }));
jest.mock("../../orchestrator/execution.layer", () => ({ ExecutionLayer: class {} }));
// A parked conversation within business hours waits for the team (D5-7).
jest.mock("@server/services/business-hours.service", () => ({
  isWithinBusinessHours: async () => true,
}));

const mockPublish = jest.fn();
jest.mock("@server/services/redis.service", () => ({
  redisService: { isConnected: () => true, publish: mockPublish },
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { runConversation } from "../../orchestrator/run";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";

const conversation = (overrides: Record<string, unknown>) => ({
  id: CONVERSATION_ID,
  organization_id: ORG_ID,
  organization: {
    suspendedAt: null,
    settings: { channelAiModes: { whatsapp: "off", email: "drafts" } },
  },
  agent_id: AGENT_ID,
  agent: { id: AGENT_ID, enabled: true },
  channel: "whatsapp",
  metadata: {},
  title: "Where is my order?",
  status: "open",
  assigned_user_id: null,
  needs_processing: true,
  getLastCustomerMessage: jest.fn(async () => ({ id: "msg-1", content: "hi" })),
  getMessages: jest.fn(async () => []),
  addMessage: jest.fn(async () => ({})),
  lock: jest.fn(async () => null),
  ...overrides,
});

describe("runConversation on a channel with the AI off", () => {
  beforeEach(() => jest.clearAllMocks());

  it("queues the conversation for the team without a word to the shopper", async () => {
    const convo = conversation({});
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, {
      needs_processing: false,
      status: "pending-human",
    });
    expect(mockPublish).toHaveBeenCalledWith(
      "websocket:events",
      expect.objectContaining({ type: "conversation_status_changed" }),
    );
    expect(convo.addMessage).not.toHaveBeenCalled();
    expect(convo.lock).not.toHaveBeenCalled();
  });

  it("leaves a conversation already waiting for the team alone", async () => {
    const convo = conversation({ status: "pending-human", needs_processing: false });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(convo.lock).not.toHaveBeenCalled();
  });

  it("still answers on other channels and in test conversations", async () => {
    for (const overrides of [
      { channel: "web" },
      { channel: "email" },
      { metadata: { isPlayground: true } },
      { metadata: { runKind: "replay" } },
    ]) {
      const convo = conversation(overrides);
      mockFindById.mockResolvedValueOnce(convo);
      await runConversation(CONVERSATION_ID);
      expect(convo.lock).toHaveBeenCalled();
    }
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
