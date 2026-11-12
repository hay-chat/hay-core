import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Widget-only socket events (C3): delivery acks, "Seen" and tool progress.
 * Pins their payloads on the Redis path, the direct fallback, the web-only
 * gate and the validation websocketService applies to what comes off Redis.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockPublish = jest.fn<(channel: string, data: unknown) => Promise<void>>(
  async () => undefined,
);
let redisConnected = true;
jest.mock("@server/services/redis.service", () => ({
  redisService: { publish: mockPublish, isConnected: () => redisConnected },
}));

const mockSendToConversation = jest.fn<(conversationId: string, data: unknown) => number>();
jest.mock("@server/services/websocket.service", () => ({
  websocketService: { sendToConversation: mockSendToConversation },
}));

import {
  acknowledgeVisitorMessage,
  announceAgentRead,
  markVisitorMessageDelivered,
  publishWidgetEvent,
  toWidgetEvent,
  validClientMessageId,
} from "@server/services/widget-events.service";

const web = { id: "conv-1", organization_id: "org-1", channel: "web" };

const publishedEvents = () =>
  mockPublish.mock.calls.map(([, data]) => {
    const { type, payload } = data as { type: string; payload: Record<string, unknown> };
    return { type, ...payload };
  });

describe("publishWidgetEvent", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisConnected = true;
  });

  it("publishes on the websocket:events channel for the conversation", async () => {
    await publishWidgetEvent(web, {
      type: "message_read",
      messageId: "m1",
      readAt: "2026-11-01T10:00:00.000Z",
    });

    expect(mockPublish).toHaveBeenCalledWith("websocket:events", {
      type: "message_read",
      organizationId: "org-1",
      conversationId: "conv-1",
      payload: { messageId: "m1", readAt: "2026-11-01T10:00:00.000Z" },
    });
  });

  it("sends straight to the widget sockets when Redis is down", async () => {
    redisConnected = false;
    await publishWidgetEvent(web, {
      type: "message_ack",
      messageId: "m1",
      status: "received",
    });

    expect(mockSendToConversation).toHaveBeenCalledWith("conv-1", {
      type: "message_ack",
      messageId: "m1",
      status: "received",
    });
  });

  it("only web conversations have a widget to tell", async () => {
    await publishWidgetEvent(
      { ...web, channel: "whatsapp" },
      { type: "message_ack", messageId: "m1", status: "received" },
    );
    expect(mockPublish).not.toHaveBeenCalled();
    expect(mockSendToConversation).not.toHaveBeenCalled();
  });

  it("never throws: a lost event only costs a tick", async () => {
    mockPublish.mockRejectedValueOnce(new Error("redis down"));
    await expect(
      publishWidgetEvent(web, { type: "message_ack", messageId: "m1", status: "received" }),
    ).resolves.toBeUndefined();
  });
});

describe("visitor message acks", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisConnected = true;
  });

  const message = { id: "m1", metadata: { clientMessageId: "local-7" } };

  it("an AI run follows: received now, delivered when the run picks it up", async () => {
    await acknowledgeVisitorMessage({ ...web, needs_processing: true }, message);
    expect(publishedEvents()).toEqual([
      { type: "message_ack", messageId: "m1", clientMessageId: "local-7", status: "received" },
    ]);

    await markVisitorMessageDelivered(web, message);
    expect(publishedEvents()[1]).toEqual({
      type: "message_ack",
      messageId: "m1",
      clientMessageId: "local-7",
      status: "delivered",
    });
  });

  it("no AI run follows (a person holds it): delivered at once", async () => {
    await acknowledgeVisitorMessage(
      { ...web, needs_processing: false },
      { id: "m2", metadata: null },
    );
    expect(publishedEvents()).toEqual([
      { type: "message_ack", messageId: "m2", status: "received" },
      { type: "message_ack", messageId: "m2", status: "delivered" },
    ]);
  });

  it("a run with no visitor message delivers nothing", async () => {
    await markVisitorMessageDelivered(web, null);
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("validClientMessageId accepts short non-empty strings only", () => {
    expect(validClientMessageId("local-7")).toBe("local-7");
    expect(validClientMessageId("")).toBeUndefined();
    expect(validClientMessageId("x".repeat(65))).toBeUndefined();
    expect(validClientMessageId(42)).toBeUndefined();
  });
});

describe("announceAgentRead", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisConnected = true;
  });

  it("marks the visitor's latest message read", async () => {
    await announceAgentRead(
      web,
      [
        { id: "c2", type: "Customer", created_at: new Date("2026-11-01T10:05:00Z") },
        { id: "c1", type: "Customer", created_at: new Date("2026-11-01T10:00:00Z") },
        { id: "b1", type: "BotAgent", created_at: new Date("2026-11-01T10:06:00Z") },
      ] as never,
      new Date("2026-11-01T11:00:00Z"),
    );
    expect(publishedEvents()).toEqual([
      { type: "message_read", messageId: "c2", readAt: "2026-11-01T11:00:00.000Z" },
    ]);
  });

  it("says nothing when the visitor has not written", async () => {
    await announceAgentRead(web, [{ id: "b1", type: "BotAgent", created_at: new Date() }] as never);
    expect(mockPublish).not.toHaveBeenCalled();
  });
});

describe("toWidgetEvent", () => {
  it("keeps only the known fields of each event", () => {
    expect(
      toWidgetEvent("message_ack", {
        messageId: "m1",
        status: "delivered",
        clientMessageId: "local-1",
        extra: "secret",
      }),
    ).toEqual({
      type: "message_ack",
      messageId: "m1",
      status: "delivered",
      clientMessageId: "local-1",
    });
    expect(
      toWidgetEvent("agent_activity", {
        state: "start",
        toolName: "shopify:get_order",
        label: "Looking up your order",
        doneLabel: "Checked your order",
        args: { email: "x@y.z" },
      }),
    ).toEqual({
      type: "agent_activity",
      state: "start",
      toolName: "shopify:get_order",
      label: "Looking up your order",
      doneLabel: "Checked your order",
    });
  });

  it("rejects malformed events", () => {
    expect(toWidgetEvent("message_ack", { messageId: "m1", status: "seen" })).toBeNull();
    expect(toWidgetEvent("message_read", { messageId: "m1" })).toBeNull();
    expect(toWidgetEvent("agent_activity", { state: "start", toolName: "t" })).toBeNull();
    expect(toWidgetEvent("tool_call", { messageId: "m1" })).toBeNull();
    expect(toWidgetEvent("message_ack", null)).toBeNull();
  });
});
