import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * messageApprovalService — releasing / blocking replies held by approval mode.
 *
 * The important contract: approving re-broadcasts the message as a
 * `message_received` event with `deliveryState: "sent"`, because that event is
 * the only thing channelDeliveryService (WhatsApp, Instagram, Chatwoot, ...)
 * and the webchat WebSocket path react to. Blocking must never publish it.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

type RedisHandler = (event: unknown) => void;
let deliveryHandler: RedisHandler | null = null;
const mockPublish = jest.fn<(channel: string, data: unknown) => Promise<void>>();
let redisConnected = true;
jest.mock("@server/services/redis.service", () => ({
  redisService: {
    publish: mockPublish,
    isConnected: () => redisConnected,
    subscribe: jest.fn(async (_channel: string, handler: RedisHandler) => {
      deliveryHandler = handler;
    }),
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

const mockSendToConversation = jest.fn<(conversationId: string, data: unknown) => number>();
const mockSendToOrganization = jest.fn<(organizationId: string, data: unknown) => number>();
jest.mock("@server/services/websocket.service", () => ({
  websocketService: {
    sendToConversation: mockSendToConversation,
    sendToOrganization: mockSendToOrganization,
  },
}));

type MessageRow = Record<string, unknown> & { id: string; content: string };
let storedMessage: MessageRow | null;
const mockMessageRepo = {
  findByIdAndOrganization: jest.fn<(id: string, orgId: string) => Promise<MessageRow | null>>(),
  /** Conditional update, like the real repository: no-op unless still in `from`. */
  transitionDeliveryState: jest.fn(
    async (_id: string, from: string, data: Record<string, unknown>) => {
      if (storedMessage?.deliveryState !== from) return null;
      storedMessage = { ...(storedMessage as MessageRow), ...data };
      return storedMessage;
    },
  ),
  update: jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>(),
  updateProviderMessageId: jest.fn<(id: string, providerMessageId: string) => Promise<void>>(),
};
jest.mock("@server/repositories/message.repository", () => ({
  MessageRepository: jest.fn(() => mockMessageRepo),
}));

const mockConversationRepo = { findById: jest.fn<() => Promise<unknown>>() };
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => mockConversationRepo),
}));

import { messageApprovalService } from "@server/services/message-approval.service";
import { channelDeliveryService } from "@server/services/channel-delivery.service";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";

const conversation = {
  id: CONVERSATION_ID,
  organization_id: ORG_ID,
  channel: "whatsapp",
  metadata: { whatsapp: { phoneNumberId: "123" } },
  customer: { external_id: "5511999999999" },
};

const queuedMessage = (): MessageRow => ({
  id: MESSAGE_ID,
  conversation_id: CONVERSATION_ID,
  content: "Your order ships tomorrow.",
  type: "BotAgent",
  sender: "assistant",
  created_at: new Date("2026-10-26T10:00:00Z"),
  metadata: { confidence: 0.9 },
  attachments: [],
  status: "pending",
  deliveryState: "queued",
});

const publishedTypes = () =>
  mockPublish.mock.calls.map(([, event]) => (event as { type: string }).type);
const publishedEvent = (type: string) =>
  mockPublish.mock.calls
    .map(([, event]) => event as { type: string; payload: Record<string, unknown> })
    .find((event) => event.type === type);

describe("messageApprovalService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisConnected = true;
    storedMessage = queuedMessage();
    mockMessageRepo.findByIdAndOrganization.mockImplementation(async () => storedMessage);
    mockConversationRepo.findById.mockResolvedValue(conversation);
  });

  describe("approve", () => {
    it("marks the message sent and re-broadcasts it so channels deliver it", async () => {
      const result = await messageApprovalService.approve({
        messageId: MESSAGE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(mockMessageRepo.findByIdAndOrganization).toHaveBeenCalledWith(MESSAGE_ID, ORG_ID);
      expect(mockMessageRepo.transitionDeliveryState).toHaveBeenCalledWith(
        MESSAGE_ID,
        "queued",
        expect.objectContaining({
          status: "approved",
          deliveryState: "sent",
          approvedBy: USER_ID,
          approvedAt: expect.any(Date),
        }),
      );
      expect(result).toMatchObject({ id: MESSAGE_ID, deliveryState: "sent" });

      // Delivery event first (what channel plugins + webchat react to), then the dashboard notice.
      expect(publishedTypes()).toEqual(["message_received", "message_approved"]);

      const delivery = publishedEvent("message_received");
      expect(delivery).toMatchObject({
        organizationId: ORG_ID,
        conversationId: CONVERSATION_ID,
        payload: {
          id: MESSAGE_ID,
          type: "BotAgent",
          content: "Your order ships tomorrow.",
          deliveryState: "sent",
          status: "approved",
          attachments: [],
          isPlayground: false,
        },
      });

      expect(publishedEvent("message_approved")).toMatchObject({
        organizationId: ORG_ID,
        payload: {
          conversationId: CONVERSATION_ID,
          messageId: MESSAGE_ID,
          messageType: "BotAgent",
        },
      });
    });

    it("delivers the edited text, not the original draft", async () => {
      await messageApprovalService.approve({
        messageId: MESSAGE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        editedContent: "Your order ships on Tuesday.",
      });

      expect(mockMessageRepo.transitionDeliveryState).toHaveBeenCalledWith(
        MESSAGE_ID,
        "queued",
        expect.objectContaining({
          status: "edited",
          content: "Your order ships on Tuesday.",
          originalContent: "Your order ships tomorrow.",
        }),
      );
      expect(publishedEvent("message_received")?.payload).toMatchObject({
        content: "Your order ships on Tuesday.",
        status: "edited",
        deliveryState: "sent",
      });
      expect(publishedEvent("message_approved")?.payload).toMatchObject({
        editedContent: "Your order ships on Tuesday.",
      });
    });

    it("treats unchanged edited content as a plain approval", async () => {
      await messageApprovalService.approve({
        messageId: MESSAGE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        editedContent: "Your order ships tomorrow.",
      });

      const [, , updates] = mockMessageRepo.transitionDeliveryState.mock.calls[0];
      expect(updates.status).toBe("approved");
      expect(updates).not.toHaveProperty("originalContent");
    });

    it("lets only one of two concurrent approvals through, so the reply is delivered once", async () => {
      const approve = () =>
        messageApprovalService.approve({
          messageId: MESSAGE_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        });

      // Both callers read the row while it is still queued; the conditional
      // update lets the first one through and the second finds nothing to move.
      const [first, second] = await Promise.allSettled([approve(), approve()]);

      expect(first.status).toBe("fulfilled");
      expect(second.status).toBe("rejected");
      expect((second as PromiseRejectedResult).reason).toMatchObject({ code: "BAD_REQUEST" });
      expect(publishedTypes().filter((type) => type === "message_received")).toHaveLength(1);
    });

    it("rejects a message that is not queued and publishes nothing", async () => {
      storedMessage = { ...queuedMessage(), deliveryState: "sent" };

      await expect(
        messageApprovalService.approve({
          messageId: MESSAGE_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(mockMessageRepo.transitionDeliveryState).not.toHaveBeenCalled();
      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("hides messages of other organizations", async () => {
      mockMessageRepo.findByIdAndOrganization.mockResolvedValue(null);

      await expect(
        messageApprovalService.approve({
          messageId: MESSAGE_ID,
          organizationId: "99999999-9999-4999-8999-999999999999",
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      expect(mockPublish).not.toHaveBeenCalled();
    });

    it("falls back to the local WebSocket server when Redis is down", async () => {
      redisConnected = false;

      await messageApprovalService.approve({
        messageId: MESSAGE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(mockPublish).not.toHaveBeenCalled();
      expect(mockSendToConversation).toHaveBeenCalledWith(
        CONVERSATION_ID,
        expect.objectContaining({
          type: "message",
          data: expect.objectContaining({ id: MESSAGE_ID, content: "Your order ships tomorrow." }),
        }),
      );
      expect(mockSendToOrganization).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({ type: "message_approved" }),
      );
    });
  });

  describe("approve → channel delivery", () => {
    const mockFetch =
      jest.fn<(url: string, init: RequestInit) => Promise<{ json: () => Promise<unknown> }>>();

    /** Replay what approval published through the channel-delivery subscriber. */
    const replayThroughChannelDelivery = async () => {
      for (const [, event] of mockPublish.mock.calls) {
        deliveryHandler!(event);
      }
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
    };

    beforeEach(async () => {
      global.fetch = mockFetch as unknown as typeof fetch;
      await channelDeliveryService.initialize();
      expect(deliveryHandler).not.toBeNull();
      mockFindPluginIdByChannel.mockResolvedValue("hay-channel-whatsapp-meta");
      mockGetOrStartWorker.mockResolvedValue({ port: 4567 });
      mockFetch.mockResolvedValue({
        json: async () => ({ success: true, providerMessageId: "wamid.OUT.1" }),
      });
    });

    it("posts the approved (edited) reply to the WhatsApp plugin's /deliver", async () => {
      await messageApprovalService.approve({
        messageId: MESSAGE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        editedContent: "Your order ships on Tuesday.",
      });
      await replayThroughChannelDelivery();

      expect(mockFindPluginIdByChannel).toHaveBeenCalledWith(ORG_ID, "whatsapp");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as unknown as [string, { body: string }];
      expect(url).toBe("http://localhost:4567/deliver");
      expect(JSON.parse(init.body)).toMatchObject({
        to: "5511999999999",
        content: "Your order ships on Tuesday.",
        messageId: MESSAGE_ID,
        conversationId: CONVERSATION_ID,
      });
      expect(mockMessageRepo.updateProviderMessageId).toHaveBeenCalledWith(
        MESSAGE_ID,
        "wamid.OUT.1",
      );
    });

    it("never delivers a blocked reply", async () => {
      await messageApprovalService.block({
        messageId: MESSAGE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
      });
      await replayThroughChannelDelivery();

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("block", () => {
    it("marks the message blocked and never publishes a delivery event", async () => {
      const result = await messageApprovalService.block({
        messageId: MESSAGE_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        reason: "Wrong shipping date",
      });

      expect(mockMessageRepo.transitionDeliveryState).toHaveBeenCalledWith(
        MESSAGE_ID,
        "queued",
        expect.objectContaining({
          status: "rejected",
          deliveryState: "blocked",
          approvedBy: USER_ID,
          metadata: { confidence: 0.9, blockReason: "Wrong shipping date" },
        }),
      );
      expect(result).toMatchObject({ deliveryState: "blocked" });

      expect(publishedTypes()).toEqual(["message_blocked"]);
      expect(publishedEvent("message_blocked")?.payload).toMatchObject({
        conversationId: CONVERSATION_ID,
        messageId: MESSAGE_ID,
        reason: "Wrong shipping date",
      });
    });

    it("rejects a message that is not queued", async () => {
      storedMessage = { ...queuedMessage(), deliveryState: "blocked" };

      await expect(
        messageApprovalService.block({
          messageId: MESSAGE_ID,
          organizationId: ORG_ID,
          userId: USER_ID,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      expect(mockPublish).not.toHaveBeenCalled();
    });
  });
});
