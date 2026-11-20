import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Every plugin API procedure is refused to a token that lacks the capability
 * it needs, and a token stops working once its worker is gone.
 */

const JWT_SECRET = "plugin-api-test-secret";
const mockConfig = {
  jwt: { secret: JWT_SECRET },
  conversation: { cooldownInterval: 1000 },
  smtp: { from: { email: "noreply@hay.test", name: "Hay" } },
  storage: {
    s3: {},
    local: { uploadDir: "/tmp/hay-test-uploads", baseUrl: "http://localhost/uploads" },
    limits: { maxFileSize: 10 * 1024 * 1024, conversationMediaMaxFileSize: 25 * 1024 * 1024 },
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

type OrgRow = { isActive: boolean; suspendedAt: Date | null } | null;
const mockFindOrg = jest.fn<(id: string) => Promise<OrgRow>>();
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: mockFindOrg },
}));

type InstanceRow = { id: string; config: Record<string, unknown> | null };
const mockFindByOrgAndPlugin = jest.fn<(orgId: string, pluginId: string) => Promise<InstanceRow>>();
const mockUpdateConfig = jest.fn<(id: string, config: Record<string, unknown>) => Promise<void>>();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {
    findByOrgAndPlugin: mockFindByOrgAndPlugin,
    updateConfig: mockUpdateConfig,
  },
}));
jest.mock("@server/repositories/plugin-webhook-route.repository", () => ({
  pluginWebhookRouteRepository: {},
}));
jest.mock("@server/repositories/document.repository", () => ({ documentRepository: {} }));
const mockRegisterTools = jest.fn<() => Promise<void>>();
jest.mock("@server/services/mcp-registry.service", () => ({
  mcpRegistryService: { registerTools: mockRegisterTools },
}));
jest.mock("@server/services/product-sync.service", () => ({ productSyncService: {} }));
import { createFakeRedisClient } from "../helpers/fake-redis";
const mockRedisClient = createFakeRedisClient();
jest.mock("@server/services/redis.service", () => ({
  redisService: { publish: jest.fn(), isConnected: () => true, getClient: () => mockRedisClient },
}));
jest.mock("@server/services/storage.service", () => ({ storageService: { upload: jest.fn() } }));
jest.mock("@server/services/transcription.service", () => ({ transcriptionService: {} }));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));
jest.mock("@server/services/channel-health.service", () => ({ channelHealthService: {} }));
jest.mock("@server/services/email.service", () => ({ emailService: {} }));
jest.mock("@server/services/received-email.service", () => ({
  receivedEmailService: {},
  ReceivedEmailError: class extends Error {},
}));
jest.mock("@server/services/email-domains.service", () => ({
  emailDomainService: {},
  addressDomain: (address: string) => address.split("@").pop(),
}));

jest.mock("@server/services/plugin-credential.service", () => ({ issueCredential: jest.fn() }));

import { pluginApiTrpcRouter } from "@server/routes/v1/plugin-api/trpc";
import { mintPluginApiToken, revokePluginApiToken } from "@server/lib/plugin-api-token";
import {
  PLUGIN_API_CAPABILITIES,
  PLUGIN_API_PROCEDURE_CAPABILITIES,
} from "@server/lib/plugin-capabilities";
import type { PluginAuthContext } from "@server/trpc/middleware/plugin-auth";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PLUGIN_ID = "hay-capability-test";

// Written out on purpose: changing what a procedure needs must change this test.
const EXPECTED: Record<string, string[]> = {
  "messages.receive": ["messages"],
  "messages.send": ["messages"],
  "messages.updateStatus": ["messages"],
  "media.upload": ["messages"],
  "connection.revoke": ["messages", "auth"],
  "channel.reportHealth": ["messages"],
  "email.sendingDomain": ["email"],
  "email.receivedMessage": ["email"],
  "email.receivedAttachments": ["email"],
  "webhooks.setRoutingKeys": ["messages"],
  "conversations.updateStatusByExternalId": ["messages"],
  "messages.getByConversation": ["messages"],
  "customers.get": ["customers"],
  "customers.findByExternalId": ["customers"],
  "customers.upsert": ["customers"],
  "privacy.eraseCustomer": ["privacy"],
  "privacy.exportCustomer": ["privacy"],
  "sources.register": ["sources"],
  "mcp.registerLocal": ["mcp"],
  "mcp.registerRemote": ["mcp"],
  "credentials.get": ["credentials"],
  "state.get": ["state"],
  "state.set": ["state"],
  "state.delete": ["state"],
  "products.upsertMany": ["products"],
  "products.delete": ["products"],
  "products.prune": ["products"],
  "disputes.report": ["disputes"],
};

type AnyCaller = Record<string, (input?: unknown) => Promise<unknown>>;

const callerWith = (token: string) =>
  pluginApiTrpcRouter.createCaller({
    user: null,
    organizationId: null,
    req: { headers: { authorization: `Bearer ${token}` } },
    res: {},
  } as unknown as PluginAuthContext) as unknown as AnyCaller;

const callWith = (capabilities: string[], procedure: string) =>
  callerWith(mintPluginApiToken(ORG_ID, PLUGIN_ID, capabilities))[procedure]({});

const otherApiCapabilities = (needed: string[]) =>
  PLUGIN_API_CAPABILITIES.filter((capability) => !needed.includes(capability));

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOrg.mockResolvedValue({ isActive: true, suspendedAt: null });
});

describe("plugin API procedures and capabilities", () => {
  it("covers every procedure the router exposes, and no others", () => {
    const exposed = Object.keys(pluginApiTrpcRouter._def.procedures).sort();
    expect(exposed).toEqual(Object.keys(EXPECTED).sort());
    expect(PLUGIN_API_PROCEDURE_CAPABILITIES).toEqual(EXPECTED);
  });

  describe.each(Object.entries(EXPECTED))("%s", (procedure, needed) => {
    it("is refused to a token with no capabilities", async () => {
      await expect(callWith([], procedure)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("is refused to a token holding every other plugin API capability", async () => {
      await expect(callWith(otherApiCapabilities(needed), procedure)).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("capability"),
      });
    });

    it.each(needed)("gets past the capability check with '%s'", async (capability) => {
      await expect(callWith([capability], procedure)).rejects.not.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });

  it("ignores capabilities core does not recognise", async () => {
    await expect(callWith(["*", "admin", "messages:*"], "messages.receive")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("refuses a token once its worker has stopped", async () => {
    const token = mintPluginApiToken(ORG_ID, PLUGIN_ID, ["state"]);
    await revokePluginApiToken(token);
    await expect(callerWith(token)["state.get"]({ key: "k" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });
});
