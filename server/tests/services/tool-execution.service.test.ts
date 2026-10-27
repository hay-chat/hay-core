/**
 * ToolExecutionService: action log writer (D6-5) and webchat isolation of
 * tool output when Redis is down.
 */
const mockCallTool = jest.fn();
const mockRecord = jest.fn();
const mockGetToolRisk = jest.fn();
const mockMessageUpdate = jest.fn();
const mockSendToOrganization = jest.fn();
const mockSendToConversation = jest.fn();
const mockUpdateById = jest.fn();

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: class {
    updateById = mockUpdateById;
  },
}));
jest.mock("@server/services/core/message.service", () => ({
  MessageService: class {
    messageRepository = {
      findById: jest.fn(async (id: string) => ({
        id,
        type: "Tool",
        sender: "System",
        metadata: { toolName: "shop:create_refund" },
        created_at: new Date(),
      })),
      update: mockMessageUpdate,
    };
  },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {
    getAllPlugins: () => [{ pluginId: "shop", name: "Shop", manifest: { capabilities: ["mcp"] } }],
    needsInstallation: () => false,
    needsBuilding: () => false,
    getStartCommand: () => "node index.js",
  },
}));
jest.mock("@server/services/conversation-secret.service", () => ({
  conversationSecretService: { getSecrets: async () => ({}) },
}));
jest.mock("@server/services/mcp-registry.service", () => ({
  mcpRegistryService: { getToolRisk: mockGetToolRisk, getToolsForOrg: async () => [] },
}));
jest.mock("@server/services/mcp-client-factory.service", () => ({
  MCPClientFactory: { createClient: async () => ({ callTool: mockCallTool }) },
}));
jest.mock("@server/services/core/core-tools", () => ({
  coreToolRegistry: { has: () => false },
}));
jest.mock("@server/services/redis.service", () => ({
  redisService: { isConnected: () => false },
}));
jest.mock("@server/services/websocket.service", () => ({
  websocketService: {
    sendToOrganization: mockSendToOrganization,
    sendToConversation: mockSendToConversation,
  },
}));
jest.mock("@server/services/action-log.service", () => ({
  ...jest.requireActual("@server/services/action-log.service"),
  actionLogService: { record: mockRecord },
}));
jest.mock("@server/database/data-source", () => ({ AppDataSource: {} }));

import { ToolExecutionService } from "@server/services/core/tool-execution.service";
import type { Conversation } from "@server/database/entities/conversation.entity";

const REFUND_RISK = { readOnly: false, category: "refund", classified: true };

function makeConversation(metadata: Record<string, unknown> = {}): Conversation {
  return {
    id: "conv-1",
    organization_id: "org-1",
    metadata,
    orchestration_status: { lastTurn: 0, toolLog: [] },
  } as unknown as Conversation;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetToolRisk.mockResolvedValue(REFUND_RISK);
});

describe("ToolExecutionService action log", () => {
  it("logs a successful call with redacted args and no http status", async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
    const service = new ToolExecutionService();

    const res = await service.handleToolExecution(
      makeConversation(),
      { name: "shop:create_refund", args: { order_id: "1", api_key: "sk_live_x" } },
      "msg-1",
    );

    expect(res.success).toBe(true);
    expect(mockRecord).toHaveBeenCalledTimes(1);
    const entry = mockRecord.mock.calls[0][0];
    expect(entry).toMatchObject({
      organizationId: "org-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      pluginId: "shop",
      toolName: "create_refund",
      outcome: "success",
      errorCode: null,
    });
    expect(typeof entry.durationMs).toBe("number");
    const metadata = mockMessageUpdate.mock.calls[0][1].metadata;
    expect(metadata.toolStatus).toBe("SUCCESS");
    expect(metadata).not.toHaveProperty("httpStatus");
  });

  it("logs the tool-errors code of a failed call", async () => {
    mockCallTool.mockResolvedValue({
      isError: true,
      content: [
        { type: "text", text: '{"code":"PRECONDITION","retryable":false,"message":"shipped"}' },
      ],
    });
    const service = new ToolExecutionService();

    const res = await service.handleToolExecution(
      makeConversation(),
      { name: "shop:create_refund", args: { order_id: "1" } },
      "msg-1",
    );

    expect(res.success).toBe(false);
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      outcome: "error",
      errorCode: "PRECONDITION",
    });
    expect(mockMessageUpdate.mock.calls[0][1].metadata.toolErrorCode).toBe("PRECONDITION");
  });

  it("does not send tool output to the webchat socket when Redis is down", async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "secret order data" }] });
    const service = new ToolExecutionService();

    await service.handleToolExecution(
      makeConversation(),
      { name: "shop:create_refund", args: {} },
      "msg-1",
    );

    expect(mockSendToOrganization).toHaveBeenCalled();
    expect(mockSendToConversation).not.toHaveBeenCalled();
  });
});

describe("action log helpers", () => {
  const { redactArgs, toolErrorCode } = jest.requireActual("@server/services/action-log.service");

  it("redacts sensitive keys at any depth", () => {
    expect(
      redactArgs({ a: 1, accessToken: "x", nested: [{ password: "p", note: "keep" }] }),
    ).toEqual({ a: 1, accessToken: "[redacted]", nested: [{ password: "[redacted]", note: "keep" }] });
  });

  it("falls back to INTERNAL for non tool-errors failures", () => {
    expect(toolErrorCode("boom")).toBe("INTERNAL");
    expect(toolErrorCode(undefined)).toBe("INTERNAL");
    expect(toolErrorCode('{"code":"RATE_LIMITED"}')).toBe("RATE_LIMITED");
  });
});
