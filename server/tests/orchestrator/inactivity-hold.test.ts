import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D11-2: the inactivity nudge and close must not go out while a human holds
 * the conversation (taken over or assigned) or the agent or organization is
 * paused, including when that happens while the nudge is being written.
 */

const mockFindAllOpen = jest.fn<() => Promise<unknown[]>>();
const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockUpdate = jest.fn();
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: class {
    findAllOpenConversations = () => mockFindAllOpen();
    findById = (id: string) => mockFindById(id);
    update = mockUpdate;
    delete = jest.fn();
  },
  conversationRepository: { findById: (id: string) => mockFindById(id) },
}));
jest.mock("@server/repositories/message.repository", () => ({ MessageRepository: class {} }));

const mockInvoke = jest.fn<() => Promise<string>>();
jest.mock("@server/services/core/llm.service", () => ({
  LLMService: class {
    invoke = mockInvoke;
  },
}));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({ getPrompt: async () => "prompt" }) },
}));
jest.mock("@server/services/hooks/hook-manager", () => ({ hookManager: { trigger: jest.fn() } }));
const mockEnqueue = jest.fn();
jest.mock("@server/services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: mockEnqueue },
}));
jest.mock("../../orchestrator/run", () => ({ runConversation: jest.fn() }));
jest.mock("@server/services/team-questions/team-question.service", () => ({
  teamQuestionService: { conversationIdsWithOpenQuestion: async () => new Set<string>() },
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

import { Orchestrator } from "../../orchestrator";
import { config } from "../../config/env";

const THRESHOLD = config.conversation.inactivityInterval;
const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

/** The DB row as a fresh re-read sees it; tests flip fields "mid-run". */
let row: Record<string, unknown>;
let addMessage: jest.Mock;

function makeConversation(silentForMs: number, withWarning = false) {
  const messages = [
    {
      type: "Customer",
      content: "Where is my order?",
      created_at: new Date(Date.now() - silentForMs),
      metadata: {},
      intent: "question",
    },
    {
      type: "BotAgent",
      content: withWarning ? "Still there?" : "It ships tomorrow.",
      created_at: new Date(Date.now() - silentForMs + 1000),
      metadata: withWarning ? { isInactivityWarning: true } : {},
    },
  ];
  return {
    id: CONVERSATION_ID,
    organization_id: ORG_ID,
    status: "open",
    assigned_user_id: null,
    deleted_at: null,
    title: "Order status",
    playbook_id: null,
    created_at: new Date(Date.now() - silentForMs - 60_000),
    agent: { enabled: true },
    organization: { suspendedAt: null, agentPausedAt: null },
    getMessages: async () => messages,
    getPublicMessages: async () => messages,
  };
}

/** Load a conversation into the reaper, with `changes` applied to the DB row. */
function given(conversation: ReturnType<typeof makeConversation>, changes = {}) {
  row = { ...conversation, ...changes };
  mockFindAllOpen.mockResolvedValue([conversation]);
  mockFindById.mockImplementation(async () => ({ ...row, addMessage }));
}

const WARN_AT = THRESHOLD * 0.75;
const CLOSE_AT = THRESHOLD * 1.5;
const SILENT_CLOSE_AT = THRESHOLD * 2.5;

const closedAsResolved = () =>
  mockUpdate.mock.calls.some(
    ([, , data]) => (data as { status?: string } | undefined)?.status === "resolved",
  );

describe("checkInactivity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    addMessage = jest.fn(async () => ({}));
    mockInvoke.mockResolvedValue("Do you still need help with your order?");
  });

  it("nudges an idle conversation the AI is handling, without re-running the AI", async () => {
    given(makeConversation(WARN_AT));

    await new Orchestrator().checkInactivity();

    expect(addMessage).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ isInactivityWarning: true }) }),
    );
    // Re-running would answer the last customer message a second time.
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["assigned to a human", { assigned_user_id: "user-1" }],
    ["with the agent switched off", { agent: { enabled: false } }],
    ["with the organization paused", { organization: { agentPausedAt: new Date() } }],
  ])("does not nudge a conversation %s", async (_label, changes) => {
    given(makeConversation(WARN_AT), changes);

    await new Orchestrator().checkInactivity();

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it.each([
    ["after a nudge", CLOSE_AT, true],
    ["silently", SILENT_CLOSE_AT, false],
  ])("does not close %s while a human holds the conversation", async (_l, silentFor, warned) => {
    given(makeConversation(silentFor, warned), { assigned_user_id: "user-1" });

    await new Orchestrator().checkInactivity();

    expect(addMessage).not.toHaveBeenCalled();
    expect(closedAsResolved()).toBe(false);
  });

  it("does not close while the agent is switched off", async () => {
    given(makeConversation(CLOSE_AT, true), { agent: { enabled: false } });

    await new Orchestrator().checkInactivity();

    expect(addMessage).not.toHaveBeenCalled();
    expect(closedAsResolved()).toBe(false);
  });

  it("drops the nudge when a human takes over while it is being written", async () => {
    given(makeConversation(WARN_AT));
    mockInvoke.mockImplementationOnce(async () => {
      row = { ...row, status: "human-took-over", assigned_user_id: "user-1" };
      return "Still there?";
    });

    await new Orchestrator().checkInactivity();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(addMessage).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it("drops the closing message and keeps the conversation open when the agent is paused meanwhile", async () => {
    given(makeConversation(CLOSE_AT));
    mockInvoke.mockImplementationOnce(async () => {
      row = { ...row, agent: { enabled: false } };
      return "I'll close this conversation now.";
    });

    await new Orchestrator().checkInactivity();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(addMessage).not.toHaveBeenCalled();
    expect(closedAsResolved()).toBe(false);
  });
});
