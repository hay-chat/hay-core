import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * runConversation() must not reply for a suspended organization: it returns
 * before acquiring the lock and clears needs_processing so the sweep stops
 * re-enqueuing the conversation.
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

const conversation = (overrides: Record<string, unknown>) => ({
  id: CONVERSATION_ID,
  organization_id: ORG_ID,
  status: "open",
  assigned_user_id: null,
  needs_processing: true,
  lock: jest.fn(async () => "locker"),
  ...overrides,
});

describe("runConversation for a suspended organization", () => {
  beforeEach(() => jest.clearAllMocks());

  it("skips processing, clears needs_processing and never takes the lock", async () => {
    const convo = conversation({
      organization: { suspendedAt: new Date(), suspensionReason: "trial_expired" },
    });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, { needs_processing: false });
    expect(convo.lock).not.toHaveBeenCalled();
    expect(mockLogger.info).toHaveBeenCalledWith(
      { reason: "trial_expired" },
      "Skipping - organization suspended",
    );
  });

  it("does not touch the conversation when needs_processing is already false", async () => {
    const convo = conversation({
      needs_processing: false,
      organization: { suspendedAt: new Date(), suspensionReason: "manual" },
    });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(convo.lock).not.toHaveBeenCalled();
  });

  it("proceeds to the lock for an active organization", async () => {
    // Returning null from lock() makes runConversation bail right after the
    // suspension check, which is all we need to prove the gate is open.
    const convo = conversation({
      organization: { suspendedAt: null, suspensionReason: null },
      lock: jest.fn(async () => null),
    });
    mockFindById.mockResolvedValueOnce(convo);

    await runConversation(CONVERSATION_ID);

    expect(convo.lock).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
