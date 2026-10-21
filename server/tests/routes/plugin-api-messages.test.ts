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
  findByIdAndOrganization: jest.fn<() => Promise<unknown>>(),
  create: jest.fn<() => Promise<unknown>>(),
  update: jest.fn<() => Promise<unknown>>(),
  updateById: jest.fn<() => Promise<unknown>>(),
  getMessages: jest.fn<() => Promise<unknown[]>>(),
};
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => mockConversationRepo),
  conversationRepository: mockConversationRepo,
}));

const mockCustomerRepo = {
  findByExternalId: jest.fn<() => Promise<unknown>>(),
  create: jest.fn<() => Promise<unknown>>(),
  update: jest.fn<() => Promise<unknown>>(),
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
});
