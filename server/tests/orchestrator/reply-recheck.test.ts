import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D11-1: pause and take-over are read once at the start of runConversation,
 * but a run takes seconds. A reply that is already being generated must be
 * dropped if, by the time it would be saved, a human took over or the agent
 * or organization was paused.
 */

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockUpdate = jest.fn();
const mockUpdateById = jest.fn();
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: {
    findById: (id: string) => mockFindById(id),
    update: mockUpdate,
    updateById: mockUpdateById,
  },
}));
jest.mock("@server/repositories/playbook.repository", () => ({
  playbookRepository: { findByStatus: async () => [] },
}));
jest.mock("@server/repositories/agent.repository", () => ({ agentRepository: {} }));
jest.mock("@server/repositories/user.repository", () => ({ userRepository: {} }));
jest.mock("@server/services/conversation-secret.service", () => ({
  conversationSecretService: { deleteSecrets: jest.fn() },
}));

const mockHandleToolExecution = jest.fn(async () => ({ success: true, result: {} }));
jest.mock("@server/services/core/tool-execution.service", () => ({
  ToolExecutionService: class {
    handleToolExecution = mockHandleToolExecution;
  },
}));
jest.mock("@server/services/core/core-tools", () => ({
  coreToolRegistry: { has: () => false },
}));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));
jest.mock("../../orchestrator/perception.layer", () => ({
  PerceptionLayer: class {
    perceive = async () => ({
      intent: { label: "question", score: 0.9 },
      sentiment: { label: "neutral" },
      language: "en",
    });
  },
}));
jest.mock("../../orchestrator/retrieval.layer", () => ({
  RetrievalLayer: class {
    getRelevantDocuments = async () => [];
  },
}));

// Each test scripts what the planner returns and what happens "during" it.
const mockExecute = jest.fn<() => Promise<unknown>>();
jest.mock("../../orchestrator/execution.layer", () => ({
  ExecutionLayer: class {
    execute = mockExecute;
  },
}));

jest.mock("@server/services/redis.service", () => ({
  redisService: { isConnected: () => true, publish: jest.fn() },
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
import { getAiReplyBlocker } from "../../orchestrator/reply-guard";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";

/** The DB row as a fresh re-read sees it; tests flip fields "mid-run". */
let row: Record<string, unknown>;

const freshRow = () => ({
  id: CONVERSATION_ID,
  organization_id: ORG_ID,
  status: "open",
  assigned_user_id: null,
  deleted_at: null,
  agent: { id: AGENT_ID, enabled: true },
  organization: { suspendedAt: null, agentPausedAt: null },
});

function makeConversation() {
  return {
    ...freshRow(),
    agent_id: AGENT_ID,
    title: "Where is my order?",
    needs_processing: true,
    processing_attempts: 0,
    orchestration_status: { version: "v1", lastTurn: 0, toolLog: [] },
    playbook_id: null,
    enabled_tools: null,
    document_ids: [],
    metadata: {},
    lock: jest.fn(async () => "locker"),
    refreshLock: jest.fn(async () => true),
    unlock: jest.fn(async () => undefined),
    getSystemMessages: jest.fn(async () => [{ id: "sys" }]),
    getBotMessages: jest.fn(async () => [{ id: "bot" }]),
    getLastCustomerMessage: jest.fn(async () => ({
      id: "msg-1",
      content: "Where is my order?",
      savePerception: jest.fn(),
    })),
    getPublicMessages: jest.fn(async () => []),
    addMessage: jest.fn(async (payload: { content: string }) => ({ id: "new", ...payload })),
    setProcessed: jest.fn(),
  };
}

let conversation: ReturnType<typeof makeConversation>;

const botMessages = () =>
  conversation.addMessage.mock.calls
    .map(([payload]) => payload as { type: string; content: string })
    .filter((payload) => payload.type === "BotAgent");

beforeEach(() => {
  jest.clearAllMocks();
  row = freshRow();
  conversation = makeConversation();
  // First read loads the conversation for the run; later reads are re-checks.
  mockFindById.mockImplementationOnce(async () => conversation);
  mockFindById.mockImplementation(async () => ({ ...row }));
});

const respond = (userMessage: string) => ({ step: "RESPOND", userMessage });

describe("runConversation re-checks before sending", () => {
  it("sends the reply when nothing changed during the run", async () => {
    mockExecute.mockResolvedValueOnce(respond("It ships tomorrow."));

    await runConversation(CONVERSATION_ID);

    expect(botMessages()).toEqual([expect.objectContaining({ content: "It ships tomorrow." })]);
  });

  it("drops the reply when a human took over during the LLM call", async () => {
    mockExecute.mockImplementationOnce(async () => {
      row = { ...row, status: "human-took-over", assigned_user_id: "user-1" };
      return respond("It ships tomorrow.");
    });

    await runConversation(CONVERSATION_ID);

    expect(botMessages()).toEqual([]);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { blocker: "human_took_over" },
      "Dropped in-flight AI reply",
    );
    // Not counted as a processing failure.
    expect(mockUpdateById).not.toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ processing_error_count: expect.anything() }),
    );
    // A human holds it: leave the status alone.
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("drops the reply and parks the conversation when the agent was switched off", async () => {
    mockExecute.mockImplementationOnce(async () => {
      row = { ...row, agent: { id: AGENT_ID, enabled: false } };
      return respond("It ships tomorrow.");
    });

    await runConversation(CONVERSATION_ID);

    expect(botMessages()).toEqual([]);
    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, {
      needs_processing: false,
      status: "pending-human",
    });
  });

  it("drops the reply when the organization was paused", async () => {
    mockExecute.mockImplementationOnce(async () => {
      row = { ...row, organization: { suspendedAt: null, agentPausedAt: new Date() } };
      return respond("It ships tomorrow.");
    });

    await runConversation(CONVERSATION_ID);

    expect(botMessages()).toEqual([]);
    expect(mockLogger.info).toHaveBeenCalledWith(
      { blocker: "organization_paused" },
      "Dropped in-flight AI reply",
    );
  });

  it("does not run a planned tool after a take-over", async () => {
    mockExecute.mockImplementationOnce(async () => {
      row = { ...row, assigned_user_id: "user-1" };
      return { step: "CALL_TOOL", userMessage: null, tool: { name: "get_order", args: {} } };
    });

    await runConversation(CONVERSATION_ID);

    expect(mockHandleToolExecution).not.toHaveBeenCalled();
    expect(conversation.addMessage).not.toHaveBeenCalled();
  });

  it("drops the answer to a tool result when a human took over while the tool ran", async () => {
    mockExecute
      .mockResolvedValueOnce({
        step: "CALL_TOOL",
        userMessage: null,
        tool: { name: "get_order", args: {} },
      })
      .mockResolvedValueOnce(respond("Your order shipped."));
    mockHandleToolExecution.mockImplementationOnce(async () => {
      row = { ...row, status: "human-took-over", assigned_user_id: "user-1" };
      return { success: true, result: {} };
    });

    await runConversation(CONVERSATION_ID);

    expect(mockHandleToolExecution).toHaveBeenCalledTimes(1);
    expect(botMessages()).toEqual([]);
  });
});

describe("getAiReplyBlocker", () => {
  const base = freshRow();

  it("allows an open, unassigned conversation with an enabled agent", () => {
    expect(getAiReplyBlocker(base)).toBeNull();
    // The hand-off flow sets pending-human and then sends its message.
    expect(getAiReplyBlocker({ ...base, status: "pending-human" })).toBeNull();
  });

  it.each([
    [{ status: "human-took-over" }, "human_took_over"],
    [{ assigned_user_id: "user-1" }, "assigned_to_human"],
    [{ organization: { suspendedAt: new Date(), agentPausedAt: null } }, "organization_suspended"],
    [{ organization: { suspendedAt: null, agentPausedAt: new Date() } }, "organization_paused"],
    [{ agent: { enabled: false } }, "agent_disabled"],
    [{ deleted_at: new Date() }, "conversation_missing"],
  ])("blocks %o as %s", (overrides, blocker) => {
    expect(getAiReplyBlocker({ ...base, ...overrides } as typeof base)).toBe(blocker);
  });

  it("blocks a conversation that no longer exists", () => {
    expect(getAiReplyBlocker(null)).toBe("conversation_missing");
  });
});
