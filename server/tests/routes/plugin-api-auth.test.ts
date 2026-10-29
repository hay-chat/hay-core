import { describe, it, expect, jest, beforeEach, beforeAll, afterAll } from "@jest/globals";
import * as jwt from "jsonwebtoken";
import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";

/**
 * Plugin API authentication (tRPC + REST) and MCP server registration input
 * handling.
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
jest.mock("@server/repositories/agent.repository", () => ({
  AgentRepository: jest.fn(() => ({})),
  agentRepository: {},
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
jest.mock("@server/services/redis.service", () => ({
  redisService: { publish: jest.fn(), isConnected: () => true, getClient: () => null },
}));
jest.mock("@server/services/storage.service", () => ({ storageService: { upload: jest.fn() } }));
jest.mock("@server/services/transcription.service", () => ({ transcriptionService: {} }));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));
jest.mock("@server/services/channel-health.service", () => ({ channelHealthService: {} }));
jest.mock("@server/services/email.service", () => ({ emailService: {} }));
jest.mock("@server/services/email-domains.service", () => ({
  emailDomainService: {},
  addressDomain: (address: string) => address.split("@").pop(),
}));

import { pluginApiTrpcRouter } from "@server/routes/v1/plugin-api/trpc";
import pluginApiRestRouter from "@server/routes/v1/plugin-api";
import type { PluginAuthContext } from "@server/trpc/middleware/plugin-auth";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PLUGIN_ID = "hay-mcp-test";
const ACTIVE_ORG = { isActive: true, suspendedAt: null };

const claims = (capabilities: string[]) => ({
  scope: "plugin-api",
  organizationId: ORG_ID,
  pluginId: PLUGIN_ID,
  capabilities,
});
const pluginToken = (capabilities = ["mcp"]) =>
  jwt.sign(claims(capabilities), JWT_SECRET, { issuer: "hay-plugin-api", audience: "plugin" });

const callerWith = (token: string) =>
  pluginApiTrpcRouter.createCaller({
    user: null,
    organizationId: null,
    req: { headers: { authorization: `Bearer ${token}` } },
    res: {},
  } as unknown as PluginAuthContext);

const tool = { name: "lookup", description: "Look up", input_schema: { type: "object" } };

beforeEach(() => {
  jest.clearAllMocks();
  mockFindOrg.mockResolvedValue(ACTIVE_ORG);
  mockFindByOrgAndPlugin.mockResolvedValue({ id: "instance-1", config: {} });
  mockUpdateConfig.mockResolvedValue(undefined);
  mockRegisterTools.mockResolvedValue(undefined);
});

describe("plugin API tRPC authentication", () => {
  const register = (token: string) =>
    callerWith(token)["mcp.registerLocal"]({ serverPath: "mcp", tools: [tool] });

  it("accepts a token with the plugin-api issuer and audience for an active org", async () => {
    await expect(register(pluginToken())).resolves.toMatchObject({ success: true });
    expect(mockFindOrg).toHaveBeenCalledWith(ORG_ID);
  });

  it("rejects a token without the plugin-api issuer and audience", async () => {
    const token = jwt.sign(claims(["mcp"]), JWT_SECRET);
    await expect(register(token)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it("rejects a token with another scope", async () => {
    const token = jwt.sign({ ...claims(["mcp"]), scope: "access" }, JWT_SECRET, {
      issuer: "hay-plugin-api",
      audience: "plugin",
    });
    await expect(register(token)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it.each([
    ["suspended", { isActive: true, suspendedAt: new Date() }],
    ["inactive", { isActive: false, suspendedAt: null }],
    ["missing", null],
  ])("rejects calls for a %s organization", async (_label, org) => {
    mockFindOrg.mockResolvedValue(org);
    await expect(register(pluginToken())).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });
});

describe("pluginApi mcp.registerLocal", () => {
  it("persists only the server id, path and tools", async () => {
    await callerWith(pluginToken())["mcp.registerLocal"]({
      serverId: "local-1",
      serverPath: "mcp",
      tools: [tool],
      // Fields from older clients are dropped, not stored.
      ...({ startCommand: "node x.js", installCommand: "npm i", env: { A: "1" } } as object),
    });

    const saved = mockUpdateConfig.mock.calls[0][1] as {
      mcpServers: { local: Record<string, unknown>[] };
    };
    expect(saved.mcpServers.local).toEqual([
      { serverId: "local-1", serverPath: "mcp", tools: [tool] },
    ]);
  });
});

describe("pluginApi mcp.registerRemote", () => {
  const registerRemote = (input: Record<string, unknown>) =>
    callerWith(pluginToken())["mcp.registerRemote"]({
      transport: "http",
      tools: [tool],
      ...input,
    } as Parameters<ReturnType<typeof callerWith>["mcp.registerRemote"]>[0]);

  it.each(["http://127.0.0.1:5432/mcp", "http://10.0.0.5/mcp", "http://169.254.169.254/latest"])(
    "rejects a server URL on a non-public address (%s)",
    async (url) => {
      await expect(registerRemote({ url })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(mockUpdateConfig).not.toHaveBeenCalled();
    },
  );

  it("rejects OAuth endpoints on a non-public address", async () => {
    await expect(
      registerRemote({
        url: "https://93.184.216.34/mcp",
        auth: {
          type: "oauth2",
          authorizationUrl: "https://93.184.216.34/authorize",
          tokenUrl: "http://127.0.0.1/token",
          scopes: [],
          clientIdEnvVar: "X_CLIENT_ID",
          clientSecretEnvVar: "X_CLIENT_SECRET",
        },
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockUpdateConfig).not.toHaveBeenCalled();
  });

  it("stores a server on a public address", async () => {
    await expect(registerRemote({ url: "https://93.184.216.34/mcp" })).resolves.toMatchObject({
      success: true,
    });
    expect(mockUpdateConfig).toHaveBeenCalledTimes(1);
  });
});

describe("plugin API REST authentication", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/v1/plugin-api", pluginApiRestRouter);
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/plugin-api`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const health = (token: string) =>
    fetch(`${baseUrl}/health`, { headers: { authorization: `Bearer ${token}` } });

  it("serves an active organization", async () => {
    const response = await health(pluginToken());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      data: { organizationId: ORG_ID, pluginId: PLUGIN_ID },
    });
  });

  it("rejects a token with another scope", async () => {
    const token = jwt.sign({ ...claims(["mcp"]), scope: "access" }, JWT_SECRET, {
      issuer: "hay-plugin-api",
      audience: "plugin",
    });
    expect((await health(token)).status).toBe(401);
  });

  it("rejects a suspended organization", async () => {
    mockFindOrg.mockResolvedValue({ isActive: true, suspendedAt: new Date() });
    expect((await health(pluginToken())).status).toBe(403);
  });

  it("no longer exposes MCP registration over REST", async () => {
    const response = await fetch(`${baseUrl}/mcp/register-local`, {
      method: "POST",
      headers: { authorization: `Bearer ${pluginToken()}`, "content-type": "application/json" },
      body: JSON.stringify({ serverPath: "mcp", startCommand: "node x.js" }),
    });
    expect(response.status).toBe(404);
  });
});
