import { describe, it, expect, jest, beforeEach, beforeAll } from "@jest/globals";

/**
 * channelDeliveryService — outbound /deliver path (attachments + provider failures).
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

type RedisHandler = (event: unknown) => void;
let capturedHandler: RedisHandler | null = null;
const mockPublish = jest.fn<(channel: string, data: unknown) => Promise<void>>();
jest.mock("@server/services/redis.service", () => ({
  redisService: {
    subscribe: jest.fn(async (_channel: string, handler: RedisHandler) => {
      capturedHandler = handler;
    }),
    publish: mockPublish,
  },
}));

const mockFindPluginIdByChannel =
  jest.fn<(organizationId: string, channel: string) => Promise<string | null>>();
const mockGetOrStartWorker = jest.fn<() => Promise<{ port: number }>>();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {
    findPluginIdByChannel: mockFindPluginIdByChannel,
    getOrStartWorker: mockGetOrStartWorker,
  },
}));

const mockMessageRepo = {
  updateProviderMessageId: jest.fn<(id: string, providerMessageId: string) => Promise<void>>(),
  update: jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>(),
};
jest.mock("@server/repositories/message.repository", () => ({
  MessageRepository: jest.fn(() => mockMessageRepo),
  messageRepository: mockMessageRepo,
}));

const mockConversationRepo = { findById: jest.fn<() => Promise<unknown>>() };
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => mockConversationRepo),
  conversationRepository: mockConversationRepo,
}));

import { channelDeliveryService } from "@server/services/channel-delivery.service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const conversation = {
  id: CONVERSATION_ID,
  organization_id: ORG_ID,
  channel: "whatsapp",
  metadata: { whatsapp: { phoneNumberId: "123" } },
  customer: { external_id: "5511999999999" },
};

const attachment = {
  id: "att-1",
  name: "photo.jpg",
  url: "https://cdn.example.com/photo.jpg",
  type: "image/jpeg",
  size: 1234,
};

const outboundEvent = (payload: Record<string, unknown>) => ({
  type: "message_received",
  organizationId: ORG_ID,
  conversationId: CONVERSATION_ID,
  payload: {
    id: "msg-1",
    type: "BotAgent",
    content: "hello",
    deliveryState: "sent",
    metadata: null,
    ...payload,
  },
});

const mockFetch =
  jest.fn<(url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }>>();

const deliverBody = () => {
  const [, init] = mockFetch.mock.calls[0] as unknown as [string, { body: string }];
  return JSON.parse(init.body) as Record<string, unknown>;
};

/** The subscribe handler fires-and-forgets; wait for the async chain to settle. */
const dispatch = async (event: unknown) => {
  capturedHandler!(event);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

describe("channelDeliveryService /deliver", () => {
  beforeAll(async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    await channelDeliveryService.initialize();
    expect(capturedHandler).not.toBeNull();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockFindPluginIdByChannel.mockResolvedValue("hay-channel-whatsapp");
    mockGetOrStartWorker.mockResolvedValue({ port: 4567 });
    mockFetch.mockResolvedValue({
      json: async () => ({ success: true, providerMessageId: "wamid.OUT.1" }),
    });
  });

  it("includes attachments in the /deliver body and stores the provider id", async () => {
    await dispatch(outboundEvent({ attachments: [attachment] }));

    expect(mockFindPluginIdByChannel).toHaveBeenCalledWith(ORG_ID, "whatsapp");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4567/deliver",
      expect.objectContaining({ method: "POST" }),
    );
    expect(deliverBody()).toMatchObject({
      to: "5511999999999",
      content: "hello",
      messageId: "msg-1",
      conversationId: CONVERSATION_ID,
      attachments: [attachment],
    });
    expect(mockMessageRepo.updateProviderMessageId).toHaveBeenCalledWith("msg-1", "wamid.OUT.1");
  });

  it("delivers attachment-only messages with empty content", async () => {
    await dispatch(outboundEvent({ content: "", attachments: [attachment] }));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(deliverBody()).toMatchObject({ content: "", attachments: [attachment] });
  });

  it("sends an empty attachments array when the message has none", async () => {
    await dispatch(outboundEvent({}));

    expect(deliverBody().attachments).toEqual([]);
  });

  it("skips messages that originated from the external channel", async () => {
    await dispatch(outboundEvent({ type: "HumanAgent", metadata: { externalOrigin: true } }));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips queued (test-mode) messages", async () => {
    await dispatch(outboundEvent({ deliveryState: "queued" }));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("persists a provider failure and publishes message_status_updated", async () => {
    mockFetch.mockResolvedValue({
      json: async () => ({ success: false, error: "24h_window_expired" }),
    });

    await dispatch(outboundEvent({}));

    expect(mockMessageRepo.update).toHaveBeenCalledWith("msg-1", {
      providerStatus: "failed",
      providerError: { code: "24h_window_expired" },
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith("websocket:events", {
      type: "message_status_updated",
      organizationId: ORG_ID,
      payload: {
        conversationId: CONVERSATION_ID,
        messageId: "msg-1",
        providerStatus: "failed",
        providerError: { code: "24h_window_expired" },
      },
    });
    expect(mockMessageRepo.updateProviderMessageId).not.toHaveBeenCalled();
  });
});
