import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import * as jwt from "jsonwebtoken";

/**
 * pluginApi connection.revoke — responds first, then revokes on the next tick.
 */

const JWT_SECRET = "plugin-api-test-secret";
const mockConfig = {
  jwt: { secret: JWT_SECRET },
  conversation: { cooldownInterval: 1000 },
  storage: {
    s3: {},
    local: { uploadDir: "/tmp/hay-test-uploads", baseUrl: "http://localhost/uploads" },
    limits: { maxFileSize: 10 * 1024 * 1024 },
  },
};
jest.mock("@server/config/env", () => ({ config: mockConfig }));

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

jest.mock("@server/trpc", () => jest.requireActual("@server/trpc/init"));
jest.mock("@server/database/data-source", () => ({ AppDataSource: { isInitialized: false } }));

jest.mock("@server/repositories/message.repository", () => ({
  MessageRepository: jest.fn(() => ({})),
  messageRepository: {},
}));
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({})),
  conversationRepository: {},
}));
jest.mock("@server/repositories/customer.repository", () => ({
  CustomerRepository: jest.fn(() => ({})),
}));
jest.mock("@server/repositories/agent.repository", () => ({
  AgentRepository: jest.fn(() => ({})),
  agentRepository: {},
}));
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: {},
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("@server/repositories/document.repository", () => ({ documentRepository: {} }));
jest.mock("@server/services/mcp-registry.service", () => ({ mcpRegistryService: {} }));
jest.mock("@server/services/product-sync.service", () => ({ productSyncService: {} }));
jest.mock("@server/services/redis.service", () => ({
  redisService: { publish: jest.fn(), isConnected: () => true, getClient: () => null },
}));

jest.mock("@server/services/storage.service", () => ({ storageService: { upload: jest.fn() } }));
jest.mock("@server/services/transcription.service", () => ({ transcriptionService: {} }));

const mockRevokeOAuth = jest.fn<(organizationId: string, pluginId: string) => Promise<void>>();
jest.mock("@server/services/oauth.service", () => ({
  oauthService: { revokeOAuth: mockRevokeOAuth },
}));

import { pluginApiTrpcRouter } from "@server/routes/v1/plugin-api/trpc";
import type { PluginAuthContext } from "@server/trpc/middleware/plugin-auth";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PLUGIN_ID = "hay-channel-test";

const ctx = (capabilities = ["messages", "customers"]) => {
  const token = jwt.sign(
    { scope: "plugin-api", organizationId: ORG_ID, pluginId: PLUGIN_ID, capabilities },
    JWT_SECRET,
  );
  return {
    user: null,
    organizationId: null,
    req: { headers: { authorization: `Bearer ${token}` } },
    res: {},
  } as unknown as PluginAuthContext;
};

const caller = (capabilities?: string[]) => pluginApiTrpcRouter.createCaller(ctx(capabilities));

const nextTick = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("pluginApi.connection.revoke", () => {
  beforeEach(() => jest.clearAllMocks());

  it("responds revoked:true before revoking, then revokes the caller's connection", async () => {
    mockRevokeOAuth.mockResolvedValue(undefined);

    const result = await caller()["connection.revoke"]({ reason: "PARTNER_APP_UNINSTALLED" });

    expect(result).toEqual({ revoked: true });
    expect(mockRevokeOAuth).not.toHaveBeenCalled();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      { organizationId: ORG_ID, pluginId: PLUGIN_ID, reason: "PARTNER_APP_UNINSTALLED" },
      expect.any(String),
    );

    await nextTick();

    expect(mockRevokeOAuth).toHaveBeenCalledWith(ORG_ID, PLUGIN_ID);
  });

  it("swallows and logs revoke failures", async () => {
    mockRevokeOAuth.mockRejectedValue(new Error("Plugin instance not found"));

    await expect(caller()["connection.revoke"]({ reason: "token invalid" })).resolves.toEqual({
      revoked: true,
    });
    await nextTick();
    await nextTick();

    expect(mockRevokeOAuth).toHaveBeenCalledTimes(1);
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, pluginId: PLUGIN_ID }),
      expect.any(String),
    );
  });

  it("rejects an empty reason", async () => {
    await expect(caller()["connection.revoke"]({ reason: "" })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("requires the messages capability", async () => {
    await expect(caller(["customers"])["connection.revoke"]({ reason: "x" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    await nextTick();
    expect(mockRevokeOAuth).not.toHaveBeenCalled();
  });
});
