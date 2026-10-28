/**
 * ToolExecutionService: action log writer (D6-5), dry-run (D7-3), the
 * approval gate (D4-4) and webchat isolation of tool output when Redis is down.
 */
const mockCallTool = jest.fn();
const mockRecord = jest.fn();
const mockGetToolRisk = jest.fn();
const mockMessageUpdate = jest.fn();
const mockSendToOrganization = jest.fn();
const mockSendToConversation = jest.fn();
const mockUpdateById = jest.fn();
const mockConversationUpdate = jest.fn();
const mockFindOrg = jest.fn();
const mockHold = jest.fn();
const mockFindEarlierRequest = jest.fn();
const mockGetToolsForOrg = jest.fn();
const mockGetLastMessages = jest.fn();

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: class {
    updateById = mockUpdateById;
    update = mockConversationUpdate;
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
      getLastMessages: mockGetLastMessages,
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
  mcpRegistryService: { getToolRisk: mockGetToolRisk, getToolsForOrg: mockGetToolsForOrg },
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
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: mockFindOrg },
}));
jest.mock("@server/services/pending-action.service", () => ({
  pendingActionService: { hold: mockHold, findEarlierRequest: mockFindEarlierRequest },
}));

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

// Customer confirmation (D4-10) has its own suite; the others skip it.
const NO_CONFIRM = { customerConfirmation: false };
const APPROVAL_OFF = {
  settings: { actionApproval: { moneyMovesNeedApproval: false, ...NO_CONFIRM } },
};
const APPROVAL_DEFAULTS = { settings: { actionApproval: NO_CONFIRM } };

beforeEach(() => {
  jest.clearAllMocks();
  mockGetToolRisk.mockResolvedValue(REFUND_RISK);
  // Most suites test the live path; the approval gate has its own suite.
  mockFindOrg.mockResolvedValue(APPROVAL_OFF);
  mockFindEarlierRequest.mockResolvedValue(null);
  mockGetToolsForOrg.mockResolvedValue([]);
  mockGetLastMessages.mockResolvedValue([]);
  mockHold.mockImplementation(async (input: Record<string, unknown>) => ({
    id: "pa-1",
    idempotency_key: "key-from-pending-action",
    ...input,
  }));
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

describe("ToolExecutionService dry-run", () => {
  it("returns a mock for a write in a playground conversation and logs it as simulated", async () => {
    const service = new ToolExecutionService();

    const res = await service.handleToolExecution(
      makeConversation({ sourceId: "playground", dryRun: true }),
      { name: "shop:create_refund", args: { order_id: "1", amount: "10.00" } },
      "msg-1",
    );

    expect(mockCallTool).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      success: true,
      simulated: true,
      result: {
        simulated: true,
        wouldHaveCalled: { tool: "shop:create_refund", args: { order_id: "1", amount: "10.00" } },
      },
    });
    expect(mockRecord.mock.calls[0][0].outcome).toBe("simulated");
    expect(mockMessageUpdate.mock.calls[0][1].metadata.toolStatus).toBe("SIMULATED");
  });

  it("simulates by default in the playground even without the flag", async () => {
    const service = new ToolExecutionService();
    const res = await service.handleToolExecution(makeConversation({ sourceId: "playground" }), {
      name: "shop:create_refund",
      args: {},
    });
    expect(res.simulated).toBe(true);
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("simulates an unclassified tool (treated as a write)", async () => {
    mockGetToolRisk.mockResolvedValue({
      readOnly: false,
      category: "other_write",
      classified: false,
    });
    const service = new ToolExecutionService();
    const res = await service.handleToolExecution(makeConversation({ dryRun: true }), {
      name: "shop:mystery",
      args: {},
    });
    expect(res.simulated).toBe(true);
  });

  it("lets reads through to the live store", async () => {
    mockGetToolRisk.mockResolvedValue({ readOnly: true, category: null, classified: true });
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "order" }] });
    const service = new ToolExecutionService();

    const res = await service.handleToolExecution(makeConversation({ sourceId: "playground" }), {
      name: "shop:get_order",
      args: { order_id: "1" },
    });

    expect(mockCallTool).toHaveBeenCalledTimes(1);
    expect(res.simulated).toBeUndefined();
    expect(mockRecord.mock.calls[0][0].outcome).toBe("success");
  });

  it("sends writes when the playground was switched to the live store", async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "refunded" }] });
    const service = new ToolExecutionService();
    const res = await service.handleToolExecution(
      makeConversation({ sourceId: "playground", dryRun: false }),
      { name: "shop:create_refund", args: {} },
    );
    expect(mockCallTool).toHaveBeenCalledTimes(1);
    expect(res.simulated).toBeUndefined();
  });
});

describe("ToolExecutionService approval gate", () => {
  beforeEach(() => mockFindOrg.mockResolvedValue(APPROVAL_DEFAULTS)); // defaults: ON, threshold 0

  it("holds a refund, tells the AI it is pending and moves the conversation", async () => {
    const service = new ToolExecutionService();
    const conversation = makeConversation();

    const res = await service.handleToolExecution(
      conversation,
      { name: "shop:create_refund", args: { order_id: "1", amount: "25.00" } },
      "msg-1",
    );

    expect(mockCallTool).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      success: false,
      pending: true,
      result: { status: "pending_approval", pendingActionId: "pa-1" },
    });
    expect(mockHold).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "shop:create_refund",
        pluginId: "shop",
        category: "refund",
        amount: 25,
        holdReason: "money_move",
        expiryHours: 48,
      }),
    );
    expect(mockConversationUpdate).toHaveBeenCalledWith("conv-1", "org-1", {
      status: "awaiting-approval",
    });
    expect(conversation.status).toBe("awaiting-approval");
    expect(mockRecord.mock.calls[0][0]).toMatchObject({
      outcome: "held",
      idempotencyKey: "key-from-pending-action",
    });
    const metadata = mockMessageUpdate.mock.calls[0][1].metadata;
    expect(metadata).toMatchObject({ toolStatus: "PENDING_APPROVAL", pendingActionId: "pa-1" });
  });

  it("holds an unclassified tool", async () => {
    mockGetToolRisk.mockResolvedValue({
      readOnly: false,
      category: "other_write",
      classified: false,
    });
    const res = await new ToolExecutionService().handleToolExecution(makeConversation(), {
      name: "shop:mystery",
      args: {},
    });
    expect(res.pending).toBe(true);
    expect(mockHold.mock.calls[0][0]).toMatchObject({ holdReason: "unclassified_write" });
  });

  it("runs a refund under the threshold", async () => {
    mockFindOrg.mockResolvedValue({ settings: { actionApproval: { thresholdAmount: 50, ...NO_CONFIRM } } });
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "refunded" }] });
    const res = await new ToolExecutionService().handleToolExecution(makeConversation(), {
      name: "shop:create_refund",
      args: { amount: "20.00" },
    });
    expect(res.success).toBe(true);
    expect(mockHold).not.toHaveBeenCalled();
  });

  it("does not open a second request for the same pending call", async () => {
    mockFindEarlierRequest.mockResolvedValue({ id: "pa-0", status: "pending" });
    const res = await new ToolExecutionService().handleToolExecution(makeConversation(), {
      name: "shop:create_refund",
      args: { amount: "25.00" },
    });
    expect(mockHold).not.toHaveBeenCalled();
    expect(res).toMatchObject({ pending: true, result: { pendingActionId: "pa-0" } });
  });

  it("answers a call the team already declined without asking again", async () => {
    mockFindEarlierRequest.mockResolvedValue({
      id: "pa-0",
      status: "rejected",
      decision_note: "Outside the return window",
    });
    const res = await new ToolExecutionService().handleToolExecution(makeConversation(), {
      name: "shop:create_refund",
      args: { amount: "25.00" },
    });
    expect(mockHold).not.toHaveBeenCalled();
    expect(mockCallTool).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      success: false,
      result: { status: "rejected", reason: "Outside the return window" },
    });
    expect(mockRecord.mock.calls[0][0].errorCode).toBe("APPROVAL_REJECTED");
  });

  it("simulates instead of holding in a dry-run conversation", async () => {
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation({ dryRun: true }),
      { name: "shop:create_refund", args: {} },
    );
    expect(res.simulated).toBe(true);
    expect(mockHold).not.toHaveBeenCalled();
  });
});

describe("ToolExecutionService over-cap approval (capEnforced tools)", () => {
  const COUPON_RISK = { readOnly: false, category: "discount", classified: true, capEnforced: true };
  const needsApproval = {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          code: "NEEDS_APPROVAL",
          retryable: false,
          message: "A 20 (store currency) coupon is above the merchant's cap of 15.",
          details: { type: "absolute", requested: 20, cap: 15, amount: 20 },
        }),
      },
    ],
  };
  const couponCall = (args: Record<string, unknown> = {}) => ({
    name: "shop:create_coupon",
    args: { email: "ana@example.com", type: "absolute", value: 20, ...args },
  });

  beforeEach(() => {
    mockGetToolRisk.mockResolvedValue(COUPON_RISK);
    mockGetToolsForOrg.mockResolvedValue([
      {
        pluginId: "shop",
        name: "create_coupon",
        input_schema: { type: "object", properties: { value: {}, hay_approval_id: {} } },
      },
    ]);
  });

  it("runs a capped tool within its cap with approvals on, without holding", async () => {
    mockFindOrg.mockResolvedValue(APPROVAL_DEFAULTS);
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: '{"created":true}' }] });
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      couponCall({ value: 10 }),
    );
    expect(res.success).toBe(true);
    expect(mockHold).not.toHaveBeenCalled();
    expect(mockCallTool.mock.calls[0][1]).not.toHaveProperty("hay_approval_id");
  });

  it("turns the plugin's NEEDS_APPROVAL refusal into a held pending action", async () => {
    mockCallTool.mockResolvedValue(needsApproval);
    const conversation = makeConversation();
    const res = await new ToolExecutionService().handleToolExecution(conversation, couponCall());

    expect(res).toMatchObject({ success: false, pending: true, result: { pendingActionId: "pa-1" } });
    expect(mockHold).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "shop:create_coupon",
        category: "discount",
        amount: 20,
        holdReason: "over_cap",
        args: { email: "ana@example.com", type: "absolute", value: 20 },
      }),
    );
    expect(conversation.status).toBe("awaiting-approval");
    expect(mockRecord.mock.calls[0][0]).toMatchObject({ outcome: "held" });
  });

  it("strips a hay_approval_id the model tried to send", async () => {
    mockCallTool.mockResolvedValue(needsApproval);
    await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      couponCall({ hay_approval_id: "forged" }),
    );
    expect(mockCallTool.mock.calls[0][1]).not.toHaveProperty("hay_approval_id");
    expect(mockHold.mock.calls[0][0].args).not.toHaveProperty("hay_approval_id");
  });

  it("does not hold a NEEDS_APPROVAL refusal from a tool that does not declare a cap", async () => {
    mockGetToolRisk.mockResolvedValue({ readOnly: false, category: "note", classified: true });
    mockCallTool.mockResolvedValue(needsApproval);
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      couponCall(),
    );
    expect(res.success).toBe(false);
    expect(res.pending).toBeFalsy();
    expect(mockHold).not.toHaveBeenCalled();
  });

  it("re-runs an approved call with hay_approval_id and never holds it again", async () => {
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: '{"created":true}' }] });
    const res = await new ToolExecutionService().executeApprovedAction(makeConversation(), {
      id: "pa-1",
      tool_name: "shop:create_coupon",
      args: { email: "ana@example.com", type: "absolute", value: 20 },
      message_id: null,
      idempotency_key: "key-1",
    } as never);
    expect(res.success).toBe(true);
    expect(mockCallTool.mock.calls[0][1]).toMatchObject({ hay_approval_id: "pa-1" });
  });

  it("reports an approved call the plugin still refuses as an error, not a new hold", async () => {
    mockCallTool.mockResolvedValue(needsApproval);
    const res = await new ToolExecutionService().executeApprovedAction(makeConversation(), {
      id: "pa-1",
      tool_name: "shop:create_coupon",
      args: { value: 20 },
      message_id: null,
      idempotency_key: "key-1",
    } as never);
    expect(res).toMatchObject({ success: false, errorCode: "NEEDS_APPROVAL" });
    expect(mockHold).not.toHaveBeenCalled();
  });

  it("does not inject hay_approval_id when the tool schema does not declare it", async () => {
    mockGetToolsForOrg.mockResolvedValue([
      { pluginId: "shop", name: "create_coupon", input_schema: { properties: { value: {} } } },
    ]);
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    await new ToolExecutionService().executeApprovedAction(makeConversation(), {
      id: "pa-1",
      tool_name: "shop:create_coupon",
      args: { value: 20 },
      message_id: null,
      idempotency_key: "key-1",
    } as never);
    expect(mockCallTool.mock.calls[0][1]).not.toHaveProperty("hay_approval_id");
  });
});

describe("ToolExecutionService customer confirmation (D4-10)", () => {
  const refund = { name: "shop:create_refund", args: { order_id: "1", amount: "25.00" } };
  const ask = (overrides: Record<string, unknown> = {}) => ({
    id: "ask-1",
    type: "Tool",
    metadata: {
      toolName: "shop:create_refund",
      toolInput: { order_id: "1", amount: "25.00" },
      toolStatus: "NEEDS_CONFIRMATION",
      ...overrides,
    },
  });
  const customerReply = { id: "c-1", type: "Customer", metadata: {} };

  beforeEach(() => {
    mockFindOrg.mockResolvedValue({ settings: { actionApproval: { moneyMovesNeedApproval: false } } });
    mockCallTool.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
  });

  it("asks the shopper first: nothing runs, the AI is told to confirm", async () => {
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      refund,
      "msg-1",
    );

    expect(mockCallTool).not.toHaveBeenCalled();
    expect(res).toMatchObject({
      success: false,
      result: { status: "needs_customer_confirmation" },
    });
    expect(mockMessageUpdate.mock.calls[0][1].metadata.toolStatus).toBe("NEEDS_CONFIRMATION");
    expect(mockRecord.mock.calls[0][0].outcome).toBe("confirming");
  });

  it("runs once the shopper replied after the ask, and uses the ask up", async () => {
    mockGetLastMessages.mockResolvedValue([customerReply, ask()]);
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      refund,
      "msg-2",
    );

    expect(res.success).toBe(true);
    expect(mockCallTool).toHaveBeenCalled();
    expect(mockMessageUpdate).toHaveBeenCalledWith("ask-1", {
      metadata: expect.objectContaining({ confirmationUsed: true }),
    });
  });

  it("asks again when the shopper has not replied yet", async () => {
    mockGetLastMessages.mockResolvedValue([ask()]);
    await new ToolExecutionService().handleToolExecution(makeConversation(), refund, "msg-2");
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("asks again when the amount went up since the ask", async () => {
    mockGetLastMessages.mockResolvedValue([customerReply, ask()]);
    await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      { name: refund.name, args: { order_id: "1", amount: "40.00" } },
      "msg-2",
    );
    expect(mockCallTool).not.toHaveBeenCalled();
  });

  it("always asks before a cancel, even with confirmation switched off", async () => {
    mockGetToolRisk.mockResolvedValue({ readOnly: false, category: "cancel", classified: true });
    mockFindOrg.mockResolvedValue(APPROVAL_OFF);
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      { name: "shop:cancel_order", args: { order_id: "1" } },
      "msg-1",
    );
    expect(mockCallTool).not.toHaveBeenCalled();
    expect(res.result).toMatchObject({ status: "needs_customer_confirmation" });
  });

  it("asks in a dry-run conversation too, before simulating", async () => {
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation({ sourceId: "playground", dryRun: true }),
      refund,
      "msg-1",
    );
    expect(res.simulated).toBeUndefined();
    expect(res.result).toMatchObject({ status: "needs_customer_confirmation" });
  });

  it("does not ask about a call already waiting for the team", async () => {
    mockFindOrg.mockResolvedValue({ settings: {} });
    mockFindEarlierRequest.mockResolvedValue({ id: "pa-9", status: "pending" });
    const res = await new ToolExecutionService().handleToolExecution(
      makeConversation(),
      refund,
      "msg-1",
    );
    expect(res).toMatchObject({ pending: true, result: { status: "pending_approval" } });
  });
});

describe("action log helpers", () => {
  const { redactArgs, toolErrorCode } = jest.requireActual("@server/services/action-log.service");

  it("redacts sensitive keys at any depth", () => {
    expect(
      redactArgs({ a: 1, accessToken: "x", nested: [{ password: "p", note: "keep" }] }),
    ).toEqual({
      a: 1,
      accessToken: "[redacted]",
      nested: [{ password: "[redacted]", note: "keep" }],
    });
  });

  it("falls back to INTERNAL for non tool-errors failures", () => {
    expect(toolErrorCode("boom")).toBe("INTERNAL");
    expect(toolErrorCode(undefined)).toBe("INTERNAL");
    expect(toolErrorCode('{"code":"RATE_LIMITED"}')).toBe("RATE_LIMITED");
  });
});
