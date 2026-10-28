import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Conversation.addMessage() for an AI (BotAgent) reply:
 * - stamps the AI processing region in effect (D14-5, shown in the debug view);
 * - queues the reply for approval when the agent or org is in test mode, or when
 *   the conversation's channel is set to "drafts only" (D14-7).
 */

const mockGetMessages = jest.fn<() => Promise<unknown[]>>();
jest.mock("../../repositories/conversation.repository", () => ({
  conversationRepository: { getMessages: () => mockGetMessages(), update: jest.fn() },
}));

const mockCreateMessage = jest.fn<(data: Record<string, unknown>) => Promise<unknown>>();
jest.mock("../../repositories/message.repository", () => ({
  messageRepository: { create: (data: Record<string, unknown>) => mockCreateMessage(data) },
}));

const mockFindAgent = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("../../repositories/agent.repository", () => ({
  agentRepository: { findById: (id: string) => mockFindAgent(id) },
}));

const mockFindOrg = jest.fn<(id: string) => Promise<unknown>>();
jest.mock("../../repositories/organization.repository", () => ({
  organizationRepository: { findById: (id: string) => mockFindOrg(id) },
}));

jest.mock("../../services/conversation-events.service", () => ({
  conversationEventsService: { broadcastMessageReceived: jest.fn() },
}));
jest.mock("../../database/data-source", () => ({ AppDataSource: {} }));

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

const makeConversation = (channel = "whatsapp") => {
  const conversation = new Conversation();
  conversation.id = "22222222-2222-4222-8222-222222222222";
  conversation.organization_id = ORG_ID;
  conversation.agent_id = null;
  conversation.channel = channel;
  conversation.status = "open";
  return conversation;
};

const botReply = { content: "Your order shipped yesterday.", type: MessageType.BOT_AGENT };

function created(): Record<string, unknown> {
  return mockCreateMessage.mock.calls[0][0];
}

describe("Conversation.addMessage for an AI reply", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMessages.mockResolvedValue([{ type: MessageType.CUSTOMER, content: "Where is it?" }]);
    mockFindAgent.mockResolvedValue(null);
    mockFindOrg.mockResolvedValue({ id: ORG_ID, settings: {} });
    mockCreateMessage.mockImplementation(async (data) => ({ id: "msg-new", ...data }));
  });

  it("stamps the AI region the reply was processed in", async () => {
    mockFindOrg.mockResolvedValue({ id: ORG_ID, settings: { aiRegion: "eu" } });
    await makeConversation().addMessage({ ...botReply, metadata: { model: "gpt-4.1" } });
    expect(created().metadata).toEqual({ model: "gpt-4.1", aiRegion: "eu" });

    mockCreateMessage.mockClear();
    mockFindOrg.mockResolvedValue({ id: ORG_ID, settings: {} });
    await makeConversation().addMessage(botReply);
    expect(created().metadata).toEqual({ aiRegion: "default" });
  });

  it("holds the reply for approval on a channel set to drafts only", async () => {
    mockFindOrg.mockResolvedValue({
      id: ORG_ID,
      settings: { channelAiModes: { whatsapp: "drafts" } },
    });
    await makeConversation("whatsapp").addMessage(botReply);
    expect(created()).toMatchObject({
      status: "pending",
      reviewRequired: true,
      deliveryState: "queued",
    });
  });

  it("holds product cards with the reply on a drafts-only web channel and in test mode", async () => {
    const cards = {
      content: "Recommending 2 products",
      type: MessageType.PRODUCT_RECOMMENDATION,
      metadata: { productRecommendation: { products: [{ id: "p1" }, { id: "p2" }] } },
    };
    mockFindOrg.mockResolvedValue({ id: ORG_ID, settings: { channelAiModes: { web: "drafts" } } });
    await makeConversation("web").addMessage(cards);
    expect(created()).toMatchObject({
      status: "pending",
      reviewRequired: true,
      deliveryState: "queued",
    });

    mockCreateMessage.mockClear();
    mockFindOrg.mockResolvedValue({ id: ORG_ID, settings: { testModeDefault: true } });
    await makeConversation("web").addMessage(cards);
    expect(created()).toMatchObject({ reviewRequired: true, deliveryState: "queued" });
  });

  it("sends straight away on other channels", async () => {
    mockFindOrg.mockResolvedValue({
      id: ORG_ID,
      settings: { channelAiModes: { whatsapp: "drafts" } },
    });
    await makeConversation("instagram").addMessage(botReply);
    expect(created()).not.toMatchObject({ reviewRequired: true });
  });

  it("does not hold a greeting sent before the customer wrote", async () => {
    mockGetMessages.mockResolvedValue([]);
    mockFindOrg.mockResolvedValue({
      id: ORG_ID,
      settings: { channelAiModes: { whatsapp: "drafts" } },
    });
    await makeConversation("whatsapp").addMessage(botReply);
    expect(created()).not.toMatchObject({ reviewRequired: true });
  });
});
