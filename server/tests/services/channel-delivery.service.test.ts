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

const mockOnChannelDeliveryFailed = jest.fn<(args: unknown) => Promise<void>>();
jest.mock("@server/services/push-notification.service", () => ({
  pushNotificationService: { onChannelDeliveryFailed: mockOnChannelDeliveryFailed },
}));

const mockUploadFind =
  jest.fn<(options: unknown) => Promise<Array<{ id: string; folder: string }>>>();
jest.mock("@server/entities/upload.entity", () => ({ Upload: { find: mockUploadFind } }));
jest.mock("@server/config/env", () => {
  const actual = jest.requireActual<typeof import("@server/config/env")>("@server/config/env");
  return {
    ...actual,
    config: { ...actual.config, jwt: { ...actual.config.jwt, secret: "delivery-test-secret" } },
  };
});

import {
  ChannelDeliveryService,
  channelDeliveryService,
} from "@server/services/channel-delivery.service";
import { verifyMediaSignature } from "@server/services/media-url.service";

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
  jest.fn<
    (url: string, init: RequestInit) => Promise<{ status?: number; json: () => Promise<unknown> }>
  >();

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

  it("hands the worker a short-lived signed URL for private Hay uploads", async () => {
    const uploadId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    mockUploadFind.mockResolvedValue([{ id: uploadId, folder: "conversation-media" }]);
    const stored = { ...attachment, id: uploadId, url: `https://api.example/v1/media/${uploadId}` };

    await dispatch(outboundEvent({ attachments: [stored] }));

    const [delivered] = deliverBody().attachments as Array<{ url: string }>;
    const url = new URL(delivered.url);
    expect(url.pathname).toBe(`/v1/media/${uploadId}`);
    const expires = url.searchParams.get("expires") ?? undefined;
    expect(Number(expires) - Date.now() / 1000).toBeGreaterThan(14 * 60);
    expect(verifyMediaSignature(uploadId, expires, url.searchParams.get("sig") ?? undefined)).toBe(
      true,
    );
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

  it("never sends agent join/leave lines to an external channel", async () => {
    await dispatch(
      outboundEvent({
        type: "System",
        content: "Marina Souza took over this conversation",
        metadata: { systemEvent: "agent_joined", agentFirstName: "Marina" },
      }),
    );
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

describe("channelDeliveryService retry (D13-7)", () => {
  const sleep = jest.fn(async (_ms: number) => {});
  let handler: RedisHandler;

  const deliverOnce = async (event: unknown) => {
    handler(event);
    // Retries chain several awaits; give the loop time to settle.
    await new Promise((resolve) => setTimeout(resolve, 30));
  };

  const answer = (status: number, body: unknown) => ({ status, json: async () => body });

  beforeAll(async () => {
    global.fetch = mockFetch as unknown as typeof fetch;
    const service = new ChannelDeliveryService({ retryDelaysMs: [10, 20, 40], sleep });
    await service.initialize();
    handler = capturedHandler!;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockFindPluginIdByChannel.mockResolvedValue("hay-channel-whatsapp");
    mockGetOrStartWorker.mockResolvedValue({ port: 4567 });
  });

  it("retries a 503 with backoff and stores the provider id once it goes through", async () => {
    mockFetch
      .mockResolvedValueOnce(answer(503, { success: false, error: "rate_limited" }))
      .mockResolvedValueOnce(answer(503, { success: false, error: "rate_limited" }))
      .mockResolvedValueOnce(answer(200, { success: true, providerMessageId: "wamid.OK" }));

    await deliverOnce(outboundEvent({}));

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20]);
    expect(mockMessageRepo.updateProviderMessageId).toHaveBeenCalledWith("msg-1", "wamid.OK");
    expect(mockMessageRepo.update).not.toHaveBeenCalled();
    expect(mockOnChannelDeliveryFailed).not.toHaveBeenCalled();
  });

  it("gives up after 3 retries, keeps the message failed and alerts owners/admins", async () => {
    mockFetch.mockResolvedValue(answer(503, { success: false, error: "rate_limited" }));

    await deliverOnce(outboundEvent({}));

    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([10, 20, 40]);
    expect(mockMessageRepo.update).toHaveBeenCalledWith("msg-1", {
      providerStatus: "failed",
      providerError: { code: "rate_limited" },
    });
    expect(mockPublish).toHaveBeenCalledWith("websocket:events", {
      type: "channel_delivery_failed",
      organizationId: ORG_ID,
      payload: {
        conversationId: CONVERSATION_ID,
        messageId: "msg-1",
        channel: "whatsapp",
        providerError: { code: "rate_limited" },
      },
    });
    expect(mockOnChannelDeliveryFailed).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      conversationId: CONVERSATION_ID,
    });
  });

  it("never retries a permanent refusal (200 success:false) and does not alert", async () => {
    mockFetch.mockResolvedValue(answer(200, { success: false, error: "24h_window_expired" }));

    await deliverOnce(outboundEvent({}));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(mockMessageRepo.update).toHaveBeenCalledWith("msg-1", {
      providerStatus: "failed",
      providerError: { code: "24h_window_expired" },
    });
    expect(mockOnChannelDeliveryFailed).not.toHaveBeenCalled();
  });

  it("never retries a 500 (the worker may have sent part of the reply)", async () => {
    mockFetch.mockResolvedValue(answer(500, { success: false, error: "internal_error" }));

    await deliverOnce(outboundEvent({}));

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockMessageRepo.update).toHaveBeenCalledWith("msg-1", {
      providerStatus: "failed",
      providerError: { code: "internal_error" },
    });
  });

  it("retries when the worker refused the connection, not on other network errors", async () => {
    const refused = Object.assign(new TypeError("fetch failed"), {
      cause: { code: "ECONNREFUSED" },
    });
    mockFetch
      .mockRejectedValueOnce(refused)
      .mockResolvedValueOnce(answer(200, { success: true, providerMessageId: "wamid.OK" }));
    await deliverOnce(outboundEvent({}));
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockMessageRepo.updateProviderMessageId).toHaveBeenCalledWith("msg-1", "wamid.OK");

    jest.clearAllMocks();
    mockConversationRepo.findById.mockResolvedValue(conversation);
    mockFindPluginIdByChannel.mockResolvedValue("hay-channel-whatsapp");
    mockGetOrStartWorker.mockResolvedValue({ port: 4567 });
    const reset = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } });
    mockFetch.mockRejectedValueOnce(reset);
    await deliverOnce(outboundEvent({}));
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockMessageRepo.update).toHaveBeenCalledWith("msg-1", {
      providerStatus: "failed",
      providerError: { code: "worker_unreachable" },
    });
  });
});
