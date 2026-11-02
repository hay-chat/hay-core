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
// Channel plugins declare their timing in their manifest; these stand in for them.
const mockChannelTiming: Record<string, unknown> = {
  whatsapp: { warningMinutes: 60, closeMinutes: 120 },
  email: { closeMinutes: 2880 },
};
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {
    findPluginIdByChannel: async (_organizationId: string, channel: string) =>
      channel in mockChannelTiming ? `plugin-${channel}` : null,
    getChannelInactivity: (pluginId: string) => mockChannelTiming[pluginId.replace("plugin-", "")],
  },
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
    organization: { suspendedAt: null, agentPausedAt: null },
    getMessages: async () => messages,
    getPublicMessages: async () => messages,
  };
}

/** Load a conversation into the reaper, with `changes` applied to the DB row. */
function given(conversation: Record<string, unknown>, changes = {}) {
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
    ["with the AI paused by the owner", { organization: { aiPausedAt: new Date() } }],
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

  it("does not close while the AI is paused", async () => {
    given(makeConversation(CLOSE_AT, true), { organization: { aiPausedAt: new Date() } });

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

  it("drops the closing message and keeps the conversation open when the AI is paused meanwhile", async () => {
    given(makeConversation(CLOSE_AT));
    mockInvoke.mockImplementationOnce(async () => {
      row = { ...row, organization: { aiPausedAt: new Date() } };
      return "I'll close this conversation now.";
    });

    await new Orchestrator().checkInactivity();

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(addMessage).not.toHaveBeenCalled();
    expect(closedAsResolved()).toBe(false);
  });
});

describe("checkInactivity per channel", () => {
  const MIN = 60_000;
  const withChannel = (channel: string, silentFor: number, warned = false, extra = {}) =>
    given({ ...makeConversation(silentFor, warned), channel, ...extra }, { channel, ...extra });

  beforeEach(() => {
    jest.clearAllMocks();
    addMessage = jest.fn(async () => ({}));
    mockInvoke.mockResolvedValue("Do you still need help?");
  });

  const warned = () =>
    addMessage.mock.calls.some(
      ([m]) =>
        (m as { metadata?: { isInactivityWarning?: boolean } }).metadata?.isInactivityWarning,
    );

  it("never checks in on email, and closes it with a sign-off after 2 days", async () => {
    withChannel("email", 25 * 60 * MIN);
    await new Orchestrator().checkInactivity();
    expect(addMessage).not.toHaveBeenCalled();
    expect(closedAsResolved()).toBe(false);

    jest.clearAllMocks();
    addMessage = jest.fn(async () => ({}));
    mockInvoke.mockResolvedValue("Closing this conversation.");
    withChannel("email", 49 * 60 * MIN);
    await new Orchestrator().checkInactivity();
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(warned()).toBe(false);
    expect(closedAsResolved()).toBe(true);
  });

  it("warns WhatsApp after 1 hour and closes with a sign-off after 2 hours", async () => {
    withChannel("whatsapp", 70 * MIN);
    await new Orchestrator().checkInactivity();
    expect(warned()).toBe(true);

    jest.clearAllMocks();
    addMessage = jest.fn(async () => ({}));
    mockInvoke.mockResolvedValue("Closing this chat.");
    withChannel("whatsapp", 130 * MIN, true);
    await new Orchestrator().checkInactivity();
    expect(addMessage).toHaveBeenCalledTimes(1);
    expect(closedAsResolved()).toBe(true);
  });

  it("closes web chat after 30 minutes, which email would not", async () => {
    withChannel("web", 40 * MIN, true);
    await new Orchestrator().checkInactivity();
    expect(closedAsResolved()).toBe(true);

    jest.clearAllMocks();
    withChannel("email", 40 * MIN, true);
    await new Orchestrator().checkInactivity();
    expect(closedAsResolved()).toBe(false);
  });

  it("uses the env interval for a channel whose plugin declares no timing", async () => {
    // CONVERSATION_INACTIVITY_INTERVAL in tests: check-in at half, close at the full value.
    const interval = config.conversation.inactivityInterval;
    withChannel("chatwoot", interval / 2 + MIN);
    await new Orchestrator().checkInactivity();
    expect(warned()).toBe(true);
  });

  it("neither warns nor signs off once the channel reply window has closed", async () => {
    const closedWindow = new Date(Date.now() - MIN);
    withChannel("whatsapp", 70 * MIN, false, { reply_window_expires_at: closedWindow });
    await new Orchestrator().checkInactivity();
    expect(addMessage).not.toHaveBeenCalled();

    withChannel("whatsapp", 130 * MIN, true, { reply_window_expires_at: closedWindow });
    await new Orchestrator().checkInactivity();
    expect(addMessage).not.toHaveBeenCalled();
    expect(closedAsResolved()).toBe(true);
  });
});
