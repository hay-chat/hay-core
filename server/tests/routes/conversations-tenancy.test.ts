import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * conversations router: permissions per procedure, references scoped to the
 * caller's organization, and the conversation metadata a client may set.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logPermissionDenied: jest.fn(async () => undefined) },
}));

const mockConversationCreate = jest.fn(async (data: Record<string, unknown>) => ({
  id: "c1",
  ...data,
}));
const mockConversationUpdate =
  jest.fn<(id: string, orgId: string, data: Record<string, unknown>) => Promise<unknown>>();
jest.mock("@server/repositories/conversation.repository", () => ({
  ConversationRepository: jest.fn(() => ({
    create: mockConversationCreate,
    update: mockConversationUpdate,
    findById: async () => null,
  })),
}));
jest.mock("@server/repositories/message.repository", () => ({
  MessageRepository: jest.fn(() => ({})),
}));

const mockGetCustomer =
  jest.fn<(id: string, orgId: string) => Promise<Record<string, unknown> | null>>();
jest.mock("@server/services/customer.service", () => ({
  CustomerService: jest.fn(() => ({
    getCustomer: mockGetCustomer,
    createAnonymousCustomer: async () => ({ id: "anon" }),
  })),
}));

const mockAgentFind =
  jest.fn<(id: string, orgId: string) => Promise<Record<string, unknown> | null>>();
jest.mock("@server/repositories/agent.repository", () => ({
  AgentRepository: jest.fn(() => ({})),
  agentRepository: { findByIdAndOrganization: mockAgentFind, findByOrganization: async () => [] },
}));
jest.mock("@server/repositories/organization.repository", () => ({
  OrganizationRepository: jest.fn(() => ({})),
  organizationRepository: { findById: async () => ({ defaultAgentId: null }) },
}));
jest.mock("@server/services/hooks/hook-manager", () => ({
  hookManager: { trigger: async () => undefined },
}));

const mockApprove = jest.fn(async (_input: Record<string, unknown>) => ({ id: "m1" }));
jest.mock("@server/services/message-approval.service", () => ({
  messageApprovalService: { approve: mockApprove, block: mockApprove },
}));

import { conversationsRouter, clientConversationMetadata } from "@server/routes/v1/conversations";
import { getDefaultScopesForRole, matchesScope } from "@server/types/scopes";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "44444444-4444-4444-8444-444444444444";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";

const callerAs = (role: "owner" | "member" | "viewer" | "agent") => {
  const scopes = getDefaultScopesForRole(role);
  return conversationsRouter.createCaller({
    user: {
      id: "22222222-2222-4222-8222-222222222222",
      hasScope: (resource: string, action: string) => matchesScope(`${resource}:${action}`, scopes),
      getRole: () => role,
      userOrganization: { organization: {} },
    },
    organizationId: ORG_ID,
    req: { headers: {} },
    res: {},
  } as unknown as Context);
};

describe("conversations router tenancy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCustomer.mockResolvedValue(null);
    mockAgentFind.mockResolvedValue(null);
  });

  describe("permissions", () => {
    it.each([
      ["delete", () => callerAs("viewer").delete({ id: CONVERSATION_ID })],
      ["approveMessage", () => callerAs("viewer").approveMessage({ messageId: CONVERSATION_ID })],
      ["blockMessage", () => callerAs("viewer").blockMessage({ messageId: CONVERSATION_ID })],
      [
        "setLegalHold",
        () => callerAs("viewer").setLegalHold({ conversationId: CONVERSATION_ID, legalHold: true }),
      ],
      ["create", () => callerAs("viewer").create({})],
      ["update", () => callerAs("viewer").update({ id: CONVERSATION_ID, data: {} })],
      ["takeover", () => callerAs("viewer").takeover({ conversationId: CONVERSATION_ID })],
      [
        "sendMessage",
        () => callerAs("viewer").sendMessage({ conversationId: CONVERSATION_ID, content: "hi" }),
      ],
    ])("a viewer cannot call %s", async (_name, call) => {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("the agent role cannot delete conversations or set a legal hold", async () => {
      await expect(callerAs("agent").delete({ id: CONVERSATION_ID })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        callerAs("agent").setLegalHold({ conversationId: CONVERSATION_ID, legalHold: true }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("a member can approve a held reply", async () => {
      await callerAs("member").approveMessage({ messageId: CONVERSATION_ID });
      expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_ID }));
    });

    it("no longer exposes addMessage", () => {
      expect("addMessage" in conversationsRouter._def.procedures).toBe(false);
    });
  });

  describe("create", () => {
    it("refuses a customer from another organization", async () => {
      await expect(callerAs("member").create({ customerId: OTHER_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(mockGetCustomer).toHaveBeenCalledWith(OTHER_ID, ORG_ID);
      expect(mockConversationCreate).not.toHaveBeenCalled();
    });

    it("refuses an agent from another organization", async () => {
      await expect(callerAs("member").create({ agentId: OTHER_ID })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
      expect(mockAgentFind).toHaveBeenCalledWith(OTHER_ID, ORG_ID);
      expect(mockConversationCreate).not.toHaveBeenCalled();
    });

    it("links a customer of the caller's organization", async () => {
      mockGetCustomer.mockResolvedValue({ id: OTHER_ID });
      await callerAs("member").create({ customerId: OTHER_ID });
      expect(mockConversationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ customer_id: OTHER_ID, organization_id: ORG_ID }),
      );
    });

    it("ignores an organizationId in the input", async () => {
      await callerAs("member").create({ organizationId: OTHER_ID } as never);
      expect(mockConversationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ organization_id: ORG_ID }),
      );
    });

    it("keeps only the playground metadata a client may set", async () => {
      await callerAs("member").create({
        metadata: {
          sourceId: "playground",
          dryRun: true,
          isPlayground: true,
          runKind: "replay",
          channel: "whatsapp",
        },
      });
      expect(mockConversationCreate).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { sourceId: "playground", dryRun: true } }),
      );
    });
  });

  describe("update", () => {
    it("only passes title and status through", async () => {
      mockConversationUpdate.mockResolvedValue({ id: CONVERSATION_ID });
      await callerAs("member").update({
        id: CONVERSATION_ID,
        data: {
          title: "Renamed",
          metadata: { isPlayground: true },
          customer_id: OTHER_ID,
        } as never,
      });
      expect(mockConversationUpdate).toHaveBeenCalledWith(CONVERSATION_ID, ORG_ID, {
        title: "Renamed",
      });
    });
  });

  describe("input bounds", () => {
    it("rejects an unbounded message limit", async () => {
      await expect(
        callerAs("member").getMessages({ conversationId: CONVERSATION_ID, limit: 100_000 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("rejects an unbounded escalated conversations limit", async () => {
      await expect(
        callerAs("member").escalatedConversations({ period: "today", limit: 100_000 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
  });
});

describe("clientConversationMetadata", () => {
  it("drops server-owned keys", () => {
    expect(
      clientConversationMetadata({ isPlayground: true, runKind: "x", dryRun: "no", sourceId: "x" }),
    ).toEqual({});
  });
});
