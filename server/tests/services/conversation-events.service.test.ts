import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * conversationEventsService.broadcastMessageReceived — the one place a
 * `message_received` payload is built. Pins the payload shape on the Redis
 * path and the "customer never sees an unreleased draft" gate on the
 * Redis-down fallback.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockPublish = jest.fn<(channel: string, data: unknown) => Promise<void>>();
let redisConnected = true;
jest.mock("@server/services/redis.service", () => ({
  redisService: { publish: mockPublish, isConnected: () => redisConnected },
}));

const mockSendToConversation = jest.fn<(conversationId: string, data: unknown) => number>();
jest.mock("@server/services/websocket.service", () => ({
  websocketService: { sendToConversation: mockSendToConversation },
}));

import { conversationEventsService } from "@server/services/conversation-events.service";
import type { Message } from "@server/database/entities/message.entity";

const conversation = { id: "conv-1", organization_id: "org-1", metadata: null };

const message = (overrides: Partial<Message>): Message =>
  ({
    id: "msg-1",
    content: "hello",
    type: "BotAgent",
    sender: "assistant",
    created_at: new Date("2026-10-26T10:00:00Z"),
    metadata: null,
    attachments: null,
    status: "approved",
    deliveryState: "sent",
    ...overrides,
  }) as unknown as Message;

describe("conversationEventsService.broadcastMessageReceived", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisConnected = true;
  });

  it("publishes the full message_received payload over Redis", async () => {
    await conversationEventsService.broadcastMessageReceived(conversation, message({}));

    expect(mockPublish).toHaveBeenCalledWith("websocket:events", {
      type: "message_received",
      organizationId: "org-1",
      conversationId: "conv-1",
      payload: {
        id: "msg-1",
        content: "hello",
        type: "BotAgent",
        sender: "assistant",
        timestamp: new Date("2026-10-26T10:00:00Z"),
        metadata: null,
        attachments: [],
        status: "approved",
        deliveryState: "sent",
        isPlayground: false,
      },
    });
    expect(mockSendToConversation).not.toHaveBeenCalled();
  });

  describe("without Redis", () => {
    beforeEach(() => {
      redisConnected = false;
    });

    it("pushes released public messages straight to the webchat clients", async () => {
      await conversationEventsService.broadcastMessageReceived(conversation, message({}));

      expect(mockSendToConversation).toHaveBeenCalledWith(
        "conv-1",
        expect.objectContaining({
          type: "message",
          data: expect.objectContaining({ id: "msg-1" }),
        }),
      );
    });

    it("keeps a queued (approval-mode) draft away from the customer", async () => {
      await conversationEventsService.broadcastMessageReceived(
        conversation,
        message({ status: "pending", deliveryState: "queued" } as Partial<Message>),
      );

      expect(mockSendToConversation).not.toHaveBeenCalled();
    });

    it("keeps internal message types away from the customer", async () => {
      await conversationEventsService.broadcastMessageReceived(
        conversation,
        message({ type: "Tool" } as Partial<Message>),
      );

      expect(mockSendToConversation).not.toHaveBeenCalled();
    });

    it("shows agent join/leave lines with metadata only, never the staff-facing text", async () => {
      await conversationEventsService.broadcastMessageReceived(
        conversation,
        message({
          type: "System",
          content: "Marina Souza took over this conversation",
          metadata: {
            systemEvent: "agent_joined",
            agentFirstName: "Marina",
            userName: "Marina Souza",
            userId: "u1",
          },
        } as unknown as Partial<Message>),
      );

      const [, event] = mockSendToConversation.mock.calls[0] as [
        string,
        { data: Record<string, unknown> },
      ];
      expect(event.data.content).toBe("");
      expect(event.data.metadata).toEqual({
        systemEvent: "agent_joined",
        agentFirstName: "Marina",
      });
      expect(JSON.stringify(event)).not.toContain("Souza");
    });

    it("keeps other System messages away from the customer", async () => {
      await conversationEventsService.broadcastMessageReceived(
        conversation,
        message({ type: "System", content: "internal instructions" } as Partial<Message>),
      );

      expect(mockSendToConversation).not.toHaveBeenCalled();
    });

    it("shows everything in playground conversations", async () => {
      await conversationEventsService.broadcastMessageReceived(
        { ...conversation, metadata: { isPlayground: true } },
        message({ type: "Tool" } as Partial<Message>),
      );

      expect(mockSendToConversation).toHaveBeenCalledTimes(1);
    });
  });
});
