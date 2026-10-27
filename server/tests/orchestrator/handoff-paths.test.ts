import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D5-2 regression: on every hand-off path the shopper gets the fixed, honest
 * line. The planner's own hand-off text ("Please hold on for a moment",
 * "right away") was sent verbatim on staging, where the org had no agent.
 */

const mockFindById = jest.fn<(id: string) => Promise<unknown>>();
const mockUpdate = jest.fn();
jest.mock("@server/repositories/conversation.repository", () => ({
  conversationRepository: {
    findById: (id: string) => mockFindById(id),
    update: mockUpdate,
    updateById: jest.fn(),
  },
}));
jest.mock("@server/repositories/playbook.repository", () => ({
  playbookRepository: { findByStatus: async () => [] },
}));
const mockFindAgent = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("@server/repositories/agent.repository", () => ({
  agentRepository: { findById: (id: string) => mockFindAgent(id) },
}));
const mockFindOnline = jest.fn<() => Promise<unknown[]>>();
jest.mock("@server/repositories/user.repository", () => ({
  userRepository: { findOnlineByOrganization: () => mockFindOnline() },
}));
jest.mock("@server/services/conversation-secret.service", () => ({
  conversationSecretService: { deleteSecrets: jest.fn() },
}));
jest.mock("@server/services/core/tool-execution.service", () => ({
  ToolExecutionService: class {},
}));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));
jest.mock("../../orchestrator/conversation-utils", () => ({
  generateHandoffSummary: jest.fn(async () => undefined),
}));

let customerLanguage = "en";
jest.mock("../../orchestrator/perception.layer", () => ({
  PerceptionLayer: class {
    perceive = async () => ({
      intent: { label: "request_human", score: 0.9 },
      sentiment: { label: "neutral" },
      language: customerLanguage,
    });
  },
}));
jest.mock("../../orchestrator/retrieval.layer", () => ({
  RetrievalLayer: class {
    getRelevantDocuments = async () => [];
  },
}));
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
import { handoffCopy } from "../../orchestrator/handoff-copy";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "33333333-3333-4333-8333-333333333333";

const PLANNER_LINE =
  "I'll connect you with a human agent who can assist you further. Please hold on for a moment.";
const INSTRUCTIONS = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Ask for their email." }] }],
};

function makeConversation(agentId: string | null) {
  return {
    id: CONVERSATION_ID,
    organization_id: ORG_ID,
    status: "open",
    assigned_user_id: null,
    deleted_at: null,
    agent_id: agentId,
    agent: agentId ? { id: agentId, enabled: true } : null,
    organization: { suspendedAt: null, agentPausedAt: null, defaultLanguage: "en" },
    language: null,
    title: "",
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
      content: "I want to talk to a person",
      savePerception: jest.fn(),
    })),
    getPublicMessages: jest.fn(async () => []),
    addMessage: jest.fn(async (payload: { content: string }) => ({ id: "new", ...payload })),
    addHandoffInstructions: jest.fn(async (_doc: unknown, _type: string) => undefined),
    markProcessed: jest.fn(async () => true),
  };
}

let conversation: ReturnType<typeof makeConversation>;

function given(agent: Record<string, unknown> | null, onlineHumans: number) {
  conversation = makeConversation(agent ? AGENT_ID : null);
  mockFindById.mockImplementation(async () => conversation);
  mockFindAgent.mockResolvedValue(agent);
  mockFindOnline.mockResolvedValue(Array.from({ length: onlineHumans }, (_, i) => ({ id: i })));
}

const botMessages = () =>
  conversation.addMessage.mock.calls
    .map(([payload]) => payload as { type: string; content: string; metadata?: object })
    .filter((payload) => payload.type === "BotAgent");

describe("hand-off line", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    customerLanguage = "en";
    mockExecute.mockResolvedValue({
      step: "HANDOFF",
      userMessage: PLANNER_LINE,
      handoffReason: "Customer asked for a human",
    });
  });

  it("uses the honest line, not the planner's, when the org has no agent and nobody is online", async () => {
    given(null, 0);

    await runConversation(CONVERSATION_ID);

    expect(botMessages()).toEqual([
      expect.objectContaining({
        content: handoffCopy("handoffNobodyOnline", "en"),
        metadata: expect.objectContaining({
          isHandoffMessage: true,
          handoffType: "unavailable",
          discardedHandoffMessage: PLANNER_LINE,
        }),
      }),
    ]);
    expect(mockFindAgent).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, { status: "pending-human" });
  });

  it("answers in the customer's language", async () => {
    customerLanguage = "pt";
    mockExecute.mockResolvedValue({
      step: "HANDOFF",
      userMessage:
        "Claro, vou transferir você para um agente humano agora. Por favor, aguarde um momento.",
    });
    given(null, 0);

    await runConversation(CONVERSATION_ID);

    expect(botMessages().map((m) => m.content)).toEqual([handoffCopy("handoffNobodyOnline", "pt")]);
  });

  it("uses the queued line when someone is online", async () => {
    given({ id: AGENT_ID }, 1);

    await runConversation(CONVERSATION_ID);

    expect(botMessages().map((m) => m.content)).toEqual([handoffCopy("handoffQueued", "en")]);
  });

  it("replaces a guardrail's hand-off text too", async () => {
    mockExecute.mockResolvedValue({
      step: "HANDOFF",
      userMessage: "I'm bringing in a team member who can look into it for you right away.",
      handoff: { reason: "Low confidence" },
    });
    given({ id: AGENT_ID }, 0);

    await runConversation(CONVERSATION_ID);

    expect(botMessages().map((m) => m.content)).toEqual([handoffCopy("handoffNobodyOnline", "en")]);
  });

  it.each([
    ["online", 1, "human_handoff_available_instructions", "available"],
    ["offline", 0, "human_handoff_unavailable_instructions", "unavailable"],
  ])(
    "queues the conversation and runs the merchant's instructions (%s)",
    async (_label, online, field, handoffType) => {
      mockExecute
        .mockResolvedValueOnce({ step: "HANDOFF", userMessage: PLANNER_LINE })
        .mockResolvedValueOnce({ step: "RESPOND", userMessage: "What's your email?" });
      given({ id: AGENT_ID, [field]: INSTRUCTIONS }, online);

      await runConversation(CONVERSATION_ID);

      expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, {
        status: "pending-human",
      });
      expect(conversation.addHandoffInstructions).toHaveBeenCalledWith(INSTRUCTIONS, handoffType);
      expect(botMessages().map((m) => m.content)).toEqual(["What's your email?"]);
    },
  );
});
