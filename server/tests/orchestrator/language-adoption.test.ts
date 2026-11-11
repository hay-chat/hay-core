import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * The conversation's language follows the customer: when a long enough message
 * is perceived in another language, run.ts saves it on the conversation.
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
jest.mock("@server/repositories/user.repository", () => ({ userRepository: {} }));
jest.mock("@server/services/conversation-secret.service", () => ({
  conversationSecretService: { deleteSecrets: jest.fn() },
}));
jest.mock("@server/services/core/tool-execution.service", () => ({
  ToolExecutionService: class {
    handleToolExecution = jest.fn(async () => ({ success: true, result: {} }));
  },
}));
jest.mock("@server/services/core/core-tools", () => ({
  coreToolRegistry: { has: () => false },
}));
jest.mock("@server/services/core/llm.service", () => ({ LLMService: class {} }));
jest.mock("@server/services/prompt.service", () => ({
  PromptService: { getInstance: () => ({}) },
}));

let detectedLanguage: string | null = "sv";
jest.mock("../../orchestrator/perception.layer", () => ({
  PerceptionLayer: class {
    perceive = async () => ({
      intent: { label: "question", score: 0.9 },
      sentiment: { label: "neutral" },
      language: detectedLanguage,
    });
  },
}));
jest.mock("../../orchestrator/retrieval.layer", () => ({
  RetrievalLayer: class {
    getRelevantDocuments = async () => [];
  },
}));
const mockExecute = jest.fn<(...args: unknown[]) => Promise<unknown>>();
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

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

function makeConversation(content: string, language: string | null) {
  return {
    id: CONVERSATION_ID,
    organization_id: ORG_ID,
    status: "open",
    assigned_user_id: null,
    deleted_at: null,
    organization: { suspendedAt: null, agentPausedAt: null, aiPausedAt: null },
    language,
    title: "Order",
    needs_processing: true,
    processing_attempts: 0,
    orchestration_status: { version: "v1", lastTurn: 0, toolLog: [] },
    playbook_id: null,
    enabled_tools: [],
    document_ids: [],
    metadata: {},
    lock: jest.fn(async () => "locker"),
    refreshLock: jest.fn(async () => true),
    unlock: jest.fn(async () => undefined),
    getSystemMessages: jest.fn(async () => [{ id: "sys" }]),
    getBotMessages: jest.fn(async () => [{ id: "bot" }]),
    getLastCustomerMessage: jest.fn(async () => ({
      id: "msg-1",
      content,
      savePerception: jest.fn(),
    })),
    getPublicMessages: jest.fn(async () => []),
    getMessages: jest.fn(async () => []),
    addMessage: jest.fn(async (payload: { content: string }) => ({ id: "new", ...payload })),
    markProcessed: jest.fn(async () => true),
  };
}

let conversation: ReturnType<typeof makeConversation>;

function given(content: string, language: string | null) {
  conversation = makeConversation(content, language);
  mockFindById.mockImplementation(async () => conversation);
}

const languageUpdates = () =>
  mockUpdate.mock.calls.filter(([, , data]) => (data as object) && "language" in (data as object));

describe("conversation language follows the customer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    detectedLanguage = "sv";
    mockExecute.mockResolvedValue({ step: "RESPOND", userMessage: "Hej!" });
  });

  it("saves the customer's new language on the conversation", async () => {
    given("Hej, jag har inte fått min beställning ännu", "en");

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, { language: "sv" });
    expect(conversation.language).toBe("sv");
  });

  it("keeps the language on a short reply", async () => {
    given("tack", "en");

    await runConversation(CONVERSATION_ID);

    expect(languageUpdates()).toEqual([]);
    expect(conversation.language).toBe("en");
  });

  it("keeps the language when perception named none Hay knows", async () => {
    detectedLanguage = null;
    given("Hej, jag har inte fått min beställning ännu", "en");

    await runConversation(CONVERSATION_ID);

    expect(languageUpdates()).toEqual([]);
    expect(conversation.language).toBe("en");
  });

  it("does not rewrite an unchanged language", async () => {
    given("Hej, jag har inte fått min beställning ännu", "sv");

    await runConversation(CONVERSATION_ID);

    expect(languageUpdates()).toEqual([]);
  });
});
