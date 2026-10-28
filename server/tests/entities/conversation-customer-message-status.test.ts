import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Conversation.addMessage() for a shopper (CUSTOMER) message decides whether
 * the AI runs again. "Needs attention" (pending-human) must be sticky: the
 * shopper writing again keeps the conversation in the queue and does not
 * re-enqueue the orchestrator. Only Take Over / Return to AI leave that state.
 */

const mockGetMessages = jest.fn();
const mockUpdate = jest.fn();
const mockUpdateById = jest.fn();
jest.mock("../../repositories/conversation.repository", () => ({
  conversationRepository: {
    getMessages: mockGetMessages,
    update: mockUpdate,
    updateById: mockUpdateById,
  },
}));

const mockCreateMessage = jest.fn();
jest.mock("../../repositories/message.repository", () => ({
  messageRepository: { create: mockCreateMessage },
}));

const mockEnqueue = jest.fn();
jest.mock("../../services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: mockEnqueue },
}));

jest.mock("../../services/redis.service", () => ({
  redisService: { isConnected: () => false },
}));
jest.mock("../../services/websocket.service", () => ({
  websocketService: { sendToConversation: jest.fn(() => 0) },
}));
// The entity module pulls in repositories whose base class touches the
// DataSource at import time; no database is needed for these tests.
jest.mock("../../database/data-source", () => ({ AppDataSource: {} }));

// Waiting for a person: the AI stays quiet within business hours and keeps
// answering outside them (D5-7).
const mockWithinHours = jest.fn(async () => true);
jest.mock("../../services/business-hours.service", () => ({
  isWithinBusinessHours: () => mockWithinHours(),
}));

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(() => mockLogger),
};
jest.mock("../../lib/logger", () => ({ createLogger: () => mockLogger }));

import { Conversation } from "../../database/entities/conversation.entity";
import { MessageType } from "../../database/entities/message.entity";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";

const makeConversation = (status: Conversation["status"]) => {
  const conversation = new Conversation();
  conversation.id = CONVERSATION_ID;
  conversation.organization_id = ORG_ID;
  conversation.status = status;
  conversation.needs_processing = false;
  conversation.metadata = {};
  return conversation;
};

const shopperMessage = { content: "Hello? Anyone there?", type: MessageType.CUSTOMER };

describe("Conversation.addMessage status for a shopper message", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMessages.mockResolvedValue([]);
    mockCreateMessage.mockImplementation(async (data: Record<string, unknown>) => ({
      id: "msg-new",
      created_at: new Date(),
      ...data,
    }));
  });

  it("keeps a pending-human conversation in Needs Attention and does not wake the AI", async () => {
    const conversation = makeConversation("pending-human");

    await conversation.addMessage(shopperMessage);

    expect(mockUpdate).toHaveBeenCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "pending-human", needs_processing: false }),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(conversation.status).toBe("pending-human");
    expect(conversation.needs_processing).toBe(false);
  });

  it("lets the AI answer a waiting conversation outside business hours, without leaving the queue", async () => {
    mockWithinHours.mockResolvedValueOnce(false);
    const conversation = makeConversation("pending-human");

    await conversation.addMessage(shopperMessage);

    expect(mockUpdate).toHaveBeenCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "pending-human", needs_processing: true }),
    );
    expect(conversation.status).toBe("pending-human");
  });

  it("reopens an open conversation for the AI", async () => {
    const conversation = makeConversation("open");

    await conversation.addMessage(shopperMessage);

    expect(mockUpdate).toHaveBeenCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "open", needs_processing: true }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, "customer_message");
  });

  it("reopens a resolved conversation for the AI", async () => {
    const conversation = makeConversation("resolved");

    await conversation.addMessage(shopperMessage);

    expect(mockUpdate).toHaveBeenCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "open", needs_processing: true }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, "customer_message");
  });

  it("keeps a taken-over conversation with the human once they have replied", async () => {
    const conversation = makeConversation("human-took-over");
    mockGetMessages.mockResolvedValue([{ content: "Hi, Sam here", type: MessageType.HUMAN_AGENT }]);

    await conversation.addMessage(shopperMessage);

    expect(mockUpdate).toHaveBeenCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "human-took-over", needs_processing: false }),
    );
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
