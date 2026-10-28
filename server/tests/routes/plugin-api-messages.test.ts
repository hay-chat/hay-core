import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import * as jwt from "jsonwebtoken";

/**
 * pluginApi messages.receive (attachments) + messages.updateStatus.
 */

const JWT_SECRET = "plugin-api-test-secret";
const mockConfig = {
  jwt: { secret: JWT_SECRET },
  conversation: { cooldownInterval: 1000 },
};
jest.mock("@server/config/env", () => ({ config: mockConfig }));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

// `@server/trpc` re-exports the whole v1 router tree; only `router` is needed.
jest.mock("@server/trpc", () => jest.requireActual("@server/trpc/init"));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

const mockMessageRepo = {
  create: jest.fn<(data: Record<string, unknown>) => Promise<Record<string, unknown>>>(),
  update: jest.fn<(id: string, data: Record<string, unknown>) => Promise<unknown>>(),
  findByProviderMessageIdAndOrganization:
    jest.fn<(mid: string, orgId: string) => Promise<Record<string, unknown> | null>>(),
};
jest.mock("@server/repositories/message.repository", () => ({
  MessageRepository: jest.fn(() => mockMessageRepo),
  messageRepository: mockMessageRepo,
}));

const mockConversationRepo = {
  findActiveByCustomerAndChannel: jest.fn<() => Promise<unknown>>(),
  findByExternalConversationId: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  findByIdAndOrganization: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  findById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  updateById: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
  getMessages: jest.fn<() => Promise<unknown[]>>(),
};
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => mockConversationRepo),
  conversationRepository: mockConversationRepo,
}));

const mockCustomerRepo = {
  findByExternalId: jest.fn<() => Promise<unknown>>(),
  create: jest.fn<() => Promise<unknown>>(),
  update: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
};
jest.mock("@server/repositories/customer.repository", () => ({
  CustomerRepository: jest.fn(() => mockCustomerRepo),
}));

const mockAgentRepo = { findByOrganization: jest.fn<() => Promise<unknown[]>>() };
jest.mock("@server/repositories/agent.repository", () => ({
  AgentRepository: jest.fn(() => mockAgentRepo),
  agentRepository: mockAgentRepo,
}));

jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: jest.fn(async () => null) },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
const mockChannelHealth = {
  recordDeliveryFailure: jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  markFailing: jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
  markOk: jest.fn<(...args: unknown[]) => Promise<void>>(async () => undefined),
};
jest.mock("@server/services/channel-health.service", () => ({
  channelHealthService: mockChannelHealth,
}));
jest.mock("@server/repositories/document.repository", () => ({ documentRepository: {} }));
jest.mock("@server/services/mcp-registry.service", () => ({ mcpRegistryService: {} }));
jest.mock("@server/services/product-sync.service", () => ({ productSyncService: {} }));
jest.mock("@server/services/storage.service", () => ({ storageService: { upload: jest.fn() } }));
jest.mock("@server/services/orchestrator-queue.service", () => ({
  orchestratorQueueService: { enqueue: jest.fn(async () => undefined) },
}));

const mockPublish = jest.fn<(channel: string, data: unknown) => Promise<void>>();
jest.mock("@server/services/redis.service", () => ({
  redisService: {
    publish: mockPublish,
    isConnected: () => true,
    getClient: () => null,
  },
}));

import { pluginApiTrpcRouter } from "@server/routes/v1/plugin-api/trpc";
import { Conversation } from "@server/database/entities/conversation.entity";
import type { PluginAuthContext } from "@server/trpc/middleware/plugin-auth";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const ctx = (organizationId = ORG_ID, capabilities = ["messages"]) => {
  const token = jwt.sign(
    { scope: "plugin-api", organizationId, pluginId: "hay-channel-test", capabilities },
    JWT_SECRET,
  );
  return {
    user: null,
    organizationId: null,
    req: { headers: { authorization: `Bearer ${token}` } },
    res: {},
  } as unknown as PluginAuthContext;
};

const caller = (organizationId?: string, capabilities?: string[]) =>
  pluginApiTrpcRouter.createCaller(ctx(organizationId, capabilities));

const makeConversation = () => {
  const conversation = new Conversation();
  conversation.id = CONVERSATION_ID;
  conversation.organization_id = ORG_ID;
  conversation.agent_id = "agent-1";
  conversation.channel = "whatsapp";
  conversation.status = "open";
  conversation.metadata = null;
  return conversation;
};

const attachment = {
  id: "att-1",
  name: "photo.jpg",
  url: "https://cdn.example.com/photo.jpg",
  type: "image/jpeg",
  size: 1234,
};

describe("pluginApi.messages.receive attachments", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomerRepo.findByExternalId.mockResolvedValue({
      id: "cust-1",
      name: "Ana",
      phone: null,
      external_metadata: {},
    });
    mockAgentRepo.findByOrganization.mockResolvedValue([{ id: "agent-1", channels: ["whatsapp"] }]);
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(makeConversation());
    mockConversationRepo.getMessages.mockResolvedValue([]);
    mockMessageRepo.create.mockImplementation(async (data) => ({ id: "msg-new", ...data }));
  });

  it("persists attachments and the provider message id", async () => {
    const result = await caller()["messages.receive"]({
      from: "5511999999999",
      content: "look at this",
      channel: "whatsapp",
      metadata: { mid: "wamid.IN.1" },
      attachments: [attachment],
    });

    expect(result).toMatchObject({ processed: true, deduped: false, messageId: "msg-new" });
    expect(mockMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "look at this",
        attachments: [attachment],
        providerMessageId: "wamid.IN.1",
      }),
    );
  });

  it("assigns an id to attachments that arrive without one", async () => {
    await caller()["messages.receive"]({
      from: "5511999999999",
      content: "",
      channel: "whatsapp",
      attachments: [
        { name: "voice.ogg", url: "https://cdn.example.com/v.ogg", type: "audio/ogg", size: 10 },
      ],
    });

    const created = mockMessageRepo.create.mock.calls[0][0] as {
      attachments: Array<{ id: string }>;
    };
    expect(created.attachments[0].id).toEqual(expect.any(String));
    expect(created.attachments[0].id.length).toBeGreaterThan(0);
  });

  it("does not dedupe an attachment-only message against the previous attachment-only message", async () => {
    mockConversationRepo.getMessages.mockResolvedValue([
      { id: "msg-prev", content: "", type: "Customer", attachments: [attachment] },
    ]);

    const result = await caller()["messages.receive"]({
      from: "5511999999999",
      content: "",
      channel: "whatsapp",
      attachments: [{ ...attachment, id: "att-2", name: "second.jpg" }],
    });

    expect(result.messageId).toBe("msg-new");
    expect(mockMessageRepo.create).toHaveBeenCalledTimes(1);
  });

  it("still dedupes identical text messages without attachments", async () => {
    mockConversationRepo.getMessages.mockResolvedValue([
      { id: "msg-prev", content: "hello", type: "Customer" },
    ]);

    const result = await caller()["messages.receive"]({
      from: "5511999999999",
      content: "hello",
      channel: "whatsapp",
    });

    expect(result.messageId).toBe("msg-prev");
    expect(mockMessageRepo.create).not.toHaveBeenCalled();
  });

  it("rejects attachments with an invalid url", async () => {
    await expect(
      caller()["messages.receive"]({
        from: "5511999999999",
        content: "",
        channel: "whatsapp",
        attachments: [{ ...attachment, url: "not-a-url" }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("pluginApi.messages.receive conversation lookup", () => {
  const THREAD_ID = "44444444-4444-4444-8444-444444444444";

  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomerRepo.findByExternalId.mockResolvedValue({
      id: "cust-1",
      name: "Ana",
      phone: null,
      email: null,
      external_metadata: {},
    });
    mockAgentRepo.findByOrganization.mockResolvedValue([{ id: "agent-1", channels: ["email"] }]);
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(null);
    mockConversationRepo.findByExternalConversationId.mockResolvedValue(null);
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(null);
    mockConversationRepo.getMessages.mockResolvedValue([]);
    mockConversationRepo.create.mockImplementation(async () => {
      const conversation = makeConversation();
      conversation.channel = "email";
      return conversation;
    });
    mockMessageRepo.create.mockImplementation(async (data) => ({ id: "msg-new", ...data }));
  });

  const emailConversation = (
    id: string,
    status: Conversation["status"] = "resolved",
    customerId = "cust-1",
  ) => {
    const conversation = makeConversation();
    conversation.id = id;
    conversation.channel = "email";
    conversation.status = status;
    conversation.customer_id = customerId;
    conversation.metadata = { email: { conversationId: "<root@shopper.com>" } };
    return conversation;
  };

  it("uses the plugin-recovered Hay conversation id before any other lookup", async () => {
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(emailConversation(THREAD_ID));
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(
      emailConversation(CONVERSATION_ID, "open"),
    );

    const result = await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "reply via token",
      channel: "email",
      conversationId: THREAD_ID,
      externalConversationId: "<other@shopper.com>",
    });

    expect(result.conversationId).toBe(THREAD_ID);
    expect(mockConversationRepo.findByIdAndOrganization).toHaveBeenCalledWith(THREAD_ID, ORG_ID);
    expect(mockConversationRepo.findByExternalConversationId).not.toHaveBeenCalled();
    expect(mockConversationRepo.findActiveByCustomerAndChannel).not.toHaveBeenCalled();
    expect(mockConversationRepo.create).not.toHaveBeenCalled();
  });

  it("ignores a Hay conversation id that belongs to another customer", async () => {
    // The id travels in the Reply-To of every outbound email; a third party who
    // was forwarded one must not be able to write into the shopper's thread.
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(
      emailConversation(THREAD_ID, "open", "cust-other"),
    );
    mockConversationRepo.findByExternalConversationId.mockResolvedValue(
      emailConversation(THREAD_ID, "open", "cust-other"),
    );

    const result = await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "I am not the shopper",
      channel: "email",
      conversationId: THREAD_ID,
      externalConversationId: "<root@shopper.com>",
      holdForHuman: true,
    });

    expect(result.conversationId).toBe(CONVERSATION_ID);
    expect(mockConversationRepo.create).toHaveBeenCalled();
    expect(mockConversationRepo.update).toHaveBeenCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "pending-human" }),
    );
  });

  it("starts a new thread when the external id is unknown instead of merging into the active conversation", async () => {
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(
      emailConversation(THREAD_ID, "open"),
    );

    const result = await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "Unrelated second question",
      channel: "email",
      externalConversationId: "<second@shopper.com>",
    });

    expect(result.conversationId).toBe(CONVERSATION_ID);
    expect(mockConversationRepo.findActiveByCustomerAndChannel).not.toHaveBeenCalled();
    expect(mockConversationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { email: { conversationId: "<second@shopper.com>" } } }),
    );
  });

  it("keeps the stored thread root when a reply references only our own message", async () => {
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(
      emailConversation(THREAD_ID, "open"),
    );

    await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "reply via token",
      channel: "email",
      conversationId: THREAD_ID,
      externalConversationId: "<hay-1@updates.hay.chat>",
    });

    expect(mockConversationRepo.updateById).not.toHaveBeenCalledWith(
      THREAD_ID,
      expect.objectContaining({ metadata: expect.anything() }),
    );
  });

  it("ignores a Hay conversation id that belongs to another channel", async () => {
    const whatsapp = makeConversation();
    whatsapp.id = THREAD_ID;
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(whatsapp);

    const result = await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "hello",
      channel: "email",
      conversationId: THREAD_ID,
    });

    expect(result.conversationId).toBe(CONVERSATION_ID);
    expect(mockConversationRepo.create).toHaveBeenCalled();
  });

  it("finds the thread by external id before falling back to the customer's active conversation", async () => {
    mockConversationRepo.findByExternalConversationId.mockResolvedValue(
      emailConversation(THREAD_ID),
    );
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(
      emailConversation(CONVERSATION_ID, "open"),
    );

    const result = await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "reply via headers",
      channel: "email",
      externalConversationId: "<root@shopper.com>",
    });

    expect(result.conversationId).toBe(THREAD_ID);
    expect(mockConversationRepo.findByExternalConversationId).toHaveBeenCalledWith(
      "email",
      "<root@shopper.com>",
      ORG_ID,
    );
    expect(mockConversationRepo.findActiveByCustomerAndChannel).not.toHaveBeenCalled();
  });

  it("creates a titled conversation seeded with the external id and backfills the customer email", async () => {
    await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "Where is my order?",
      channel: "email",
      externalConversationId: "<root@shopper.com>",
      title: "Order 1234 late",
      metadata: { email: "ana@shopper.com" },
    });

    expect(mockConversationRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "email",
        title: "Order 1234 late",
        metadata: { email: { conversationId: "<root@shopper.com>" } },
      }),
    );
    expect(mockCustomerRepo.update).toHaveBeenCalledWith(
      "cust-1",
      ORG_ID,
      expect.objectContaining({ email: "ana@shopper.com" }),
    );
  });
});

describe("pluginApi.messages.receive holdForHuman", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomerRepo.findByExternalId.mockResolvedValue({
      id: "cust-1",
      name: "Ana",
      phone: null,
      email: null,
      external_metadata: {},
    });
    mockAgentRepo.findByOrganization.mockResolvedValue([{ id: "agent-1", channels: ["email"] }]);
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(null);
    mockConversationRepo.findByExternalConversationId.mockResolvedValue(null);
    const conversation = makeConversation();
    conversation.channel = "email";
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(conversation);
    mockConversationRepo.getMessages.mockResolvedValue([]);
    mockMessageRepo.create.mockImplementation(async (data) => ({ id: "msg-new", ...data }));
  });

  it("stores the message and parks the conversation as pending-human", async () => {
    const result = await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "suspicious",
      channel: "email",
      holdForHuman: true,
    });

    expect(result.processed).toBe(true);
    expect(mockMessageRepo.create).toHaveBeenCalled();
    expect(mockConversationRepo.update).toHaveBeenLastCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "pending-human", needs_processing: false }),
    );
  });

  it("leaves a conversation a human already took over alone", async () => {
    const conversation = makeConversation();
    conversation.channel = "email";
    conversation.status = "human-took-over";
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(conversation);
    mockConversationRepo.getMessages.mockResolvedValue([{ type: "HumanAgent" }]);

    await caller()["messages.receive"]({
      from: "ana@shopper.com",
      content: "follow-up",
      channel: "email",
      holdForHuman: true,
    });

    const statuses = mockConversationRepo.update.mock.calls.map(
      (call) => (call[2] as { status?: string } | undefined)?.status,
    );
    expect(statuses).not.toContain("pending-human");
  });
});

describe("pluginApi.messages.receive replyWindowExpiresAt (D13-2)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomerRepo.findByExternalId.mockResolvedValue({
      id: "cust-1",
      name: "Ana",
      phone: null,
      external_metadata: {},
    });
    mockAgentRepo.findByOrganization.mockResolvedValue([{ id: "agent-1", channels: ["whatsapp"] }]);
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(null);
    mockConversationRepo.findByExternalConversationId.mockResolvedValue(null);
    mockConversationRepo.getMessages.mockResolvedValue([]);
    mockMessageRepo.create.mockImplementation(async (data) => ({ id: "msg-new", ...data }));
  });

  const windowUpdates = () =>
    mockConversationRepo.updateById.mock.calls.filter(
      (call) => (call[1] as Record<string, unknown>).reply_window_expires_at !== undefined,
    );

  it("stores the window the channel plugin reports", async () => {
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(makeConversation());

    await caller()["messages.receive"]({
      from: "5511999999999",
      content: "hi",
      channel: "whatsapp",
      metadata: { mid: "wamid.W.1" },
      replyWindowExpiresAt: "2026-10-28T10:00:00.000Z",
    });

    expect(windowUpdates()).toEqual([
      [CONVERSATION_ID, { reply_window_expires_at: new Date("2026-10-28T10:00:00.000Z") }],
    ]);
  });

  it("never moves the window backwards (late webhook retries)", async () => {
    const conversation = makeConversation();
    conversation.reply_window_expires_at = new Date("2026-10-29T10:00:00.000Z");
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(conversation);

    await caller()["messages.receive"]({
      from: "5511999999999",
      content: "older",
      channel: "whatsapp",
      metadata: { mid: "wamid.W.2" },
      replyWindowExpiresAt: "2026-10-28T10:00:00.000Z",
    });

    expect(windowUpdates()).toEqual([]);
  });
});

describe("pluginApi.messages.receive human echoes (D13-8, D11-11)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCustomerRepo.findByExternalId.mockResolvedValue({
      id: "cust-1",
      name: "Ana",
      phone: null,
      external_metadata: {},
    });
    mockAgentRepo.findByOrganization.mockResolvedValue([{ id: "agent-1", channels: ["whatsapp"] }]);
    mockConversationRepo.findByIdAndOrganization.mockResolvedValue(null);
    mockConversationRepo.findByExternalConversationId.mockResolvedValue(null);
    mockConversationRepo.findActiveByCustomerAndChannel.mockResolvedValue(makeConversation());
    mockConversationRepo.getMessages.mockResolvedValue([]);
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue(null);
    mockMessageRepo.create.mockImplementation(async (data) => ({ id: "msg-new", ...data }));
  });

  it("stores the owner's app reply as a human message and takes the conversation over", async () => {
    const result = await caller()["messages.receive"]({
      from: "+5511999999999",
      content: "Sent it this morning!",
      channel: "whatsapp",
      senderType: "human_agent",
      metadata: { mid: "wamid.ECHO.1", echo: true },
    });

    expect(result.processed).toBe(true);
    expect(mockMessageRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "HumanAgent",
        providerMessageId: "wamid.ECHO.1",
        metadata: expect.objectContaining({ externalOrigin: true }),
      }),
    );
    expect(mockConversationRepo.update).toHaveBeenLastCalledWith(
      CONVERSATION_ID,
      ORG_ID,
      expect.objectContaining({ status: "human-took-over", needs_processing: false }),
    );
  });

  it("skips an echo of a message Hay.chat sent itself", async () => {
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue({
      id: "bot-msg",
      conversation_id: CONVERSATION_ID,
    });

    const result = await caller()["messages.receive"]({
      from: "instagram:123",
      content: "AI reply",
      channel: "instagram",
      senderType: "human_agent",
      metadata: { mid: "mid.OWN" },
    });

    expect(result).toEqual({
      messageId: null,
      conversationId: CONVERSATION_ID,
      processed: false,
      deduped: true,
    });
    expect(mockMessageRepo.findByProviderMessageIdAndOrganization).toHaveBeenCalledWith(
      "mid.OWN",
      ORG_ID,
    );
    expect(mockMessageRepo.create).not.toHaveBeenCalled();
    expect(mockConversationRepo.update).not.toHaveBeenCalled();
  });
});

describe("pluginApi.messages.updateStatus", () => {
  const storedMessage = (providerStatus: string | null = null) => ({
    id: "msg-1",
    conversation_id: CONVERSATION_ID,
    providerStatus,
    providerError: null,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockPublish.mockResolvedValue(undefined);
  });

  it("requires the messages capability", async () => {
    await expect(
      caller(ORG_ID, ["customers"])["messages.updateStatus"]({
        providerMessageId: "wamid.1",
        status: "sent",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns updated:false when the provider id is unknown", async () => {
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue(null);

    await expect(
      caller()["messages.updateStatus"]({ providerMessageId: "wamid.unknown", status: "sent" }),
    ).resolves.toEqual({ updated: false, reason: "message_not_found" });
    expect(mockMessageRepo.update).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("scopes the lookup to the authenticated organization", async () => {
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue(null);

    await caller(OTHER_ORG_ID)["messages.updateStatus"]({
      providerMessageId: "wamid.1",
      status: "sent",
    });

    expect(mockMessageRepo.findByProviderMessageIdAndOrganization).toHaveBeenCalledWith(
      "wamid.1",
      OTHER_ORG_ID,
    );
  });

  it("applies a newer status and publishes message_status_updated only", async () => {
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue(storedMessage("sent"));

    await expect(
      caller()["messages.updateStatus"]({ providerMessageId: "wamid.1", status: "delivered" }),
    ).resolves.toEqual({ updated: true });

    expect(mockMessageRepo.update).toHaveBeenCalledWith("msg-1", {
      providerStatus: "delivered",
      providerError: null,
    });
    expect(mockPublish).toHaveBeenCalledTimes(1);
    expect(mockPublish).toHaveBeenCalledWith("websocket:events", {
      type: "message_status_updated",
      organizationId: ORG_ID,
      payload: {
        conversationId: CONVERSATION_ID,
        messageId: "msg-1",
        providerStatus: "delivered",
        providerError: null,
      },
    });
    const publishedTypes = mockPublish.mock.calls.map((call) => (call[1] as { type: string }).type);
    expect(publishedTypes).not.toContain("message_received");
  });

  it("never downgrades read to delivered", async () => {
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue(storedMessage("read"));

    await expect(
      caller()["messages.updateStatus"]({ providerMessageId: "wamid.1", status: "delivered" }),
    ).resolves.toEqual({ updated: false, reason: "status_not_newer" });
    expect(mockMessageRepo.update).not.toHaveBeenCalled();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("failed always applies and stores the provider error", async () => {
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue(storedMessage("read"));
    const error = { code: 131047, title: "Re-engagement message", message: "Outside window" };

    await expect(
      caller()["messages.updateStatus"]({ providerMessageId: "wamid.1", status: "failed", error }),
    ).resolves.toEqual({ updated: true });

    expect(mockMessageRepo.update).toHaveBeenCalledWith("msg-1", {
      providerStatus: "failed",
      providerError: error,
    });
    expect(mockPublish).toHaveBeenCalledWith(
      "websocket:events",
      expect.objectContaining({
        type: "message_status_updated",
        payload: expect.objectContaining({ providerStatus: "failed", providerError: error }),
      }),
    );
  });

  it("feeds a failure into the channel health check (D13-11)", async () => {
    mockMessageRepo.findByProviderMessageIdAndOrganization.mockResolvedValue(storedMessage("sent"));
    mockConversationRepo.findById.mockResolvedValue(makeConversation());

    await caller()["messages.updateStatus"]({ providerMessageId: "wamid.1", status: "failed" });
    await new Promise((resolve) => setImmediate(resolve));

    expect(mockChannelHealth.recordDeliveryFailure).toHaveBeenCalledWith(ORG_ID, "whatsapp");
  });
});

describe("pluginApi.channel.reportHealth (D13-11)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("marks a quality drop failing and clears only the plugin's own report", async () => {
    await expect(
      caller()["channel.reportHealth"]({ status: "failing", detail: "RED" }),
    ).resolves.toEqual({ ok: true });
    expect(mockChannelHealth.markFailing).toHaveBeenCalledWith(
      ORG_ID,
      expect.any(String),
      "quality_drop",
      "RED",
    );

    await caller()["channel.reportHealth"]({ status: "ok" });
    expect(mockChannelHealth.markOk).toHaveBeenCalledWith(ORG_ID, expect.any(String), [
      "quality_drop",
    ]);
  });

  it("requires the messages capability", async () => {
    await expect(
      caller(ORG_ID, ["customers"])["channel.reportHealth"]({ status: "failing" }),
    ).rejects.toThrow(/messages/);
  });
});

describe("pluginApi.conversations.updateStatusByExternalId", () => {
  beforeEach(() => jest.clearAllMocks());

  it("cannot park a conversation in awaiting-approval", async () => {
    await expect(
      caller()["conversations.updateStatusByExternalId"]({
        channel: "whatsapp",
        externalConversationId: "ext-1",
        status: "awaiting-approval" as "open",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockConversationRepo.findByExternalConversationId).not.toHaveBeenCalled();
  });
});
