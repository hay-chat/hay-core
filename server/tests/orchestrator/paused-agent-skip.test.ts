import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * runConversation() must not reply for a paused agent — either the owner
 * switched it off (agents.enabled = false) or the operator paused the whole
 * organization (organizations.agent_paused_at, e.g. usage allowance used up).
 * It returns before acquiring the lock, parks a conversation that already has
 * a shopper message as pending-human (Needs Attention) and clears
 * needs_processing so the sweep stops re-enqueuing it.
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
  organization: { suspendedAt: null, suspensionReason: null },
  agent_id: AGENT_ID,
  agent: { id: AGENT_ID, enabled: false },
  title: "Where is my order?",
  status: "open",
  assigned_user_id: null,
  needs_processing: true,
  getLastCustomerMessage: jest.fn(async () => ({ id: "msg-1", content: "hi" })),
  lock: jest.fn(async () => "locker"),
  ...overrides,
});

describe("runConversation for a paused agent", () => {
  beforeEach(() => jest.clearAllMocks());

  it("parks a conversation with a shopper message as pending-human and never takes the lock", async () => {
    const convo = conversation({});
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, {
      needs_processing: false,
      status: "pending-human",
    });
    expect(convo.lock).not.toHaveBeenCalled();
    expect(mockPublish).toHaveBeenCalledWith(
      "websocket:events",
      expect.objectContaining({
        type: "conversation_status_changed",
        organizationId: ORG_ID,
        conversationId: CONVERSATION_ID,
        payload: expect.objectContaining({ status: "pending-human", title: "Where is my order?" }),
      }),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      { agentId: AGENT_ID, cause: "agent_disabled", reason: null, queued: true },
      "Skipping - agent paused",
    );
  });

  it("only clears needs_processing (no greeting, no queue entry) when the shopper has not written yet", async () => {
    const convo = conversation({ getLastCustomerMessage: jest.fn(async () => null) });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, { needs_processing: false });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(convo.lock).not.toHaveBeenCalled();
  });

  it("leaves an already parked conversation alone", async () => {
    const convo = conversation({ status: "pending-human", needs_processing: false });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
    expect(convo.lock).not.toHaveBeenCalled();
  });

  it("does not touch a conversation a human has taken over", async () => {
    const convo = conversation({ status: "human-took-over", assigned_user_id: "user-1" });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(convo.lock).not.toHaveBeenCalled();
  });

  it("proceeds to the lock for an enabled agent", async () => {
    // Returning null from lock() makes runConversation bail right after the
    // gates, which is all we need to prove the paused gate is open.
    const convo = conversation({
      agent: { id: AGENT_ID, enabled: true },
      lock: jest.fn(async () => null),
    });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(convo.lock).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("runConversation for an organization whose agent the operator paused", () => {
  beforeEach(() => jest.clearAllMocks());

  const pausedOrganization = {
    suspendedAt: null,
    suspensionReason: null,
    agentPausedAt: new Date("2026-10-26T10:00:00Z"),
    agentPauseReason: "usage_limit",
  };

  it("parks the conversation as pending-human even though the agent itself is enabled", async () => {
    const convo = conversation({
      organization: pausedOrganization,
      agent: { id: AGENT_ID, enabled: true },
    });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, {
      needs_processing: false,
      status: "pending-human",
    });
    expect(convo.lock).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      { agentId: AGENT_ID, cause: "organization_paused", reason: "usage_limit", queued: true },
      "Skipping - agent paused",
    );
  });

  it("sends no greeting when the shopper has not written yet", async () => {
    const convo = conversation({
      organization: pausedOrganization,
      agent: { id: AGENT_ID, enabled: true },
      getLastCustomerMessage: jest.fn(async () => null),
    });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, { needs_processing: false });
    expect(mockPublish).not.toHaveBeenCalled();
    expect(convo.lock).not.toHaveBeenCalled();
  });

  it("resumes normally once agentPausedAt is cleared", async () => {
    const convo = conversation({
      organization: { ...pausedOrganization, agentPausedAt: null, agentPauseReason: null },
      agent: { id: AGENT_ID, enabled: true },
      lock: jest.fn(async () => null),
    });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(convo.lock).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
