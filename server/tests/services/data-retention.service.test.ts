import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { DataRetentionService } from "../../services/data-retention.service";

// Mock AppDataSource
const mockSave = jest.fn();

jest.mock("../../database/data-source", () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      createQueryBuilder: jest.fn(),
      save: jest.fn(),
    }),
  },
}));

// Mock vector store service
const mockDeleteByConversationIds = jest.fn();
jest.mock("../../services/vector-store.service", () => ({
  vectorStoreService: {
    deleteByConversationIds: jest.fn(),
  },
}));

// Mock debug logger
jest.mock("../../lib/debug-logger", () => ({
  debugLog: jest.fn(),
}));

/**
 * Helper to create a mock conversation object
 */
function makeConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "conv-1",
    organization_id: overrides.organization_id ?? "org-1",
    status: overrides.status ?? "closed",
    deleted_at: overrides.deleted_at ?? null,
    legal_hold: overrides.legal_hold ?? false,
    closed_at: overrides.closed_at ?? new Date("2025-01-01"),
    created_at: overrides.created_at ?? new Date("2025-01-01"),
    title: overrides.title ?? "Test conversation",
    customer_id: overrides.customer_id ?? "cust-1",
    context: overrides.context ?? null,
    metadata: overrides.metadata ?? null,
    document_ids: overrides.document_ids ?? null,
    ...overrides,
  };
}

describe("DataRetentionService", () => {
  let service: DataRetentionService;

  // Track which repositories are queried
  let orgQueryBuilder: Record<string, jest.Mock>;
  let convQueryBuilder: Record<string, jest.Mock>;
  let msgQueryBuilder: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new DataRetentionService();

    // Build chainable query builder mocks
    orgQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };

    convQueryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    msgQueryBuilder = {
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    };

    // Wire up the vectorStoreService mock
    const vectorStore = require("../../services/vector-store.service");
    vectorStore.vectorStoreService.deleteByConversationIds = mockDeleteByConversationIds;
  });

  describe("anonymizeExpiredConversations", () => {
    it("should return zeros when no organizations have retention policies", async () => {
      setupRepositories({ organizations: [] });

      const result = await service.anonymizeExpiredConversations();

      expect(result.organizationsProcessed).toBe(0);
      expect(result.conversationsAnonymized).toBe(0);
      expect(result.messagesDeleted).toBe(0);
      expect(result.embeddingsDeleted).toBe(0);
    });

    it("should anonymize conversations older than 7-day retention window", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const expiredConv = makeConversation({
        id: "conv-expired",
        organization_id: "org-1",
        status: "closed",
        closed_at: tenDaysAgo,
        created_at: tenDaysAgo,
      });

      setupRepositories({
        organizations: [{ id: "org-1", name: "Test Org", settings: { retentionDays: 7 } }],
        expiredConversations: [expiredConv],
        messagesDeleted: 5,
        embeddingsDeleted: 3,
      });

      const result = await service.anonymizeExpiredConversations();

      expect(result.organizationsProcessed).toBe(1);
      expect(result.conversationsAnonymized).toBe(1);
      expect(result.messagesDeleted).toBe(5);
      expect(result.embeddingsDeleted).toBe(3);

      // Verify embeddings were deleted
      expect(mockDeleteByConversationIds).toHaveBeenCalledWith("org-1", ["conv-expired"]);

      // Verify audit log was saved
      expect(mockSave).toHaveBeenCalled();
      const auditLogArg = mockSave.mock.calls[0]?.[0];
      expect(auditLogArg).toBeDefined();
      expect(auditLogArg.action).toBe("retention.cleanup");
      expect(auditLogArg.status).toBe("success");
      expect(auditLogArg.organizationId).toBe("org-1");
      expect(auditLogArg.metadata.conversationsAnonymized).toBe(1);
      expect(auditLogArg.metadata.embeddingsDeleted).toBe(3);
    });

    it("should preserve conversations with legal_hold = true", async () => {
      // The query filters out legal_hold conversations, so the mock
      // returns only non-legal-hold conversations.
      // This test verifies the query includes the legal_hold filter.
      setupRepositories({
        organizations: [{ id: "org-1", name: "Test Org", settings: { retentionDays: 7 } }],
        expiredConversations: [],
      });

      const result = await service.anonymizeExpiredConversations();

      expect(result.conversationsAnonymized).toBe(0);
      expect(result.messagesDeleted).toBe(0);
      expect(result.embeddingsDeleted).toBe(0);

      // Verify the query builder was called with legal_hold filter
      expect(convQueryBuilder.andWhere).toHaveBeenCalledWith("conv.legal_hold = false");
    });

    it("should skip organizations with retentionDays = 0 or null", async () => {
      setupRepositories({
        organizations: [{ id: "org-1", name: "No Retention", settings: { retentionDays: 0 } }],
      });

      const result = await service.anonymizeExpiredConversations();

      expect(result.organizationsProcessed).toBe(0);
      expect(result.conversationsAnonymized).toBe(0);
    });

    it("should process multiple organizations independently", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const org1Conv = makeConversation({
        id: "conv-org1",
        organization_id: "org-1",
        closed_at: tenDaysAgo,
      });
      const org2Conv = makeConversation({
        id: "conv-org2",
        organization_id: "org-2",
        closed_at: tenDaysAgo,
      });

      setupMultiOrgRepositories([
        {
          org: { id: "org-1", name: "Org 1", settings: { retentionDays: 7 } },
          conversations: [org1Conv],
          messagesDeleted: 3,
          embeddingsDeleted: 1,
        },
        {
          org: { id: "org-2", name: "Org 2", settings: { retentionDays: 14 } },
          conversations: [org2Conv],
          messagesDeleted: 2,
          embeddingsDeleted: 0,
        },
      ]);

      const result = await service.anonymizeExpiredConversations();

      expect(result.organizationsProcessed).toBe(2);
      expect(result.conversationsAnonymized).toBe(2);
      expect(result.messagesDeleted).toBe(5);
      expect(result.embeddingsDeleted).toBe(1);
    });

    it("should set deleted_at, null out PII fields, and clear document_ids", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const conv = makeConversation({
        id: "conv-1",
        organization_id: "org-1",
        closed_at: tenDaysAgo,
        document_ids: ["doc-1", "doc-2"],
      });

      setupRepositories({
        organizations: [{ id: "org-1", name: "Test Org", settings: { retentionDays: 7 } }],
        expiredConversations: [conv],
      });

      await service.anonymizeExpiredConversations();

      // Verify the update was called with correct anonymization fields
      expect(convQueryBuilder.set).toHaveBeenCalledWith(
        expect.objectContaining({
          customer_id: null,
          title: "[Anonymized]",
          context: null,
          metadata: null,
          document_ids: null,
        }),
      );

      // Verify deleted_at is set (should be a Date)
      const setArg = convQueryBuilder.set.mock.calls[0]?.[0];
      expect(setArg.deleted_at).toBeInstanceOf(Date);
    });

    it("should only anonymize conversations with status closed or resolved", async () => {
      setupRepositories({
        organizations: [{ id: "org-1", name: "Test Org", settings: { retentionDays: 7 } }],
        expiredConversations: [],
      });

      await service.anonymizeExpiredConversations();

      // Verify the query filters by status
      expect(convQueryBuilder.andWhere).toHaveBeenCalledWith("conv.status IN (:...statuses)", {
        statuses: ["closed", "resolved"],
      });
    });

    it("should continue processing other organizations if one fails", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const conv = makeConversation({
        id: "conv-org2",
        organization_id: "org-2",
        closed_at: tenDaysAgo,
      });

      setupMultiOrgRepositories([
        {
          org: { id: "org-1", name: "Failing Org", settings: { retentionDays: 7 } },
          conversations: [],
          shouldThrow: true,
        },
        {
          org: { id: "org-2", name: "Working Org", settings: { retentionDays: 7 } },
          conversations: [conv],
          messagesDeleted: 1,
          embeddingsDeleted: 0,
        },
      ]);

      const result = await service.anonymizeExpiredConversations();

      // org-2 should still be processed even though org-1 failed
      expect(result.organizationsProcessed).toBe(2);
      expect(result.conversationsAnonymized).toBe(1);
    });

    it("should log failure to audit when organization processing fails", async () => {
      setupRepositories({
        organizations: [{ id: "org-1", name: "Failing Org", settings: { retentionDays: 7 } }],
        expiredConversations: [],
        shouldThrowOnConvQuery: true,
      });

      await service.anonymizeExpiredConversations();

      // Verify failure audit log was saved
      expect(mockSave).toHaveBeenCalled();
      const auditLogArg = mockSave.mock.calls[0]?.[0];
      expect(auditLogArg.action).toBe("retention.cleanup");
      expect(auditLogArg.status).toBe("failure");
    });

    it("should return embeddingsDeleted count in results", async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      const conv = makeConversation({
        id: "conv-1",
        organization_id: "org-1",
        closed_at: tenDaysAgo,
      });

      setupRepositories({
        organizations: [{ id: "org-1", name: "Test Org", settings: { retentionDays: 7 } }],
        expiredConversations: [conv],
        embeddingsDeleted: 42,
      });

      const result = await service.anonymizeExpiredConversations();

      expect(result.embeddingsDeleted).toBe(42);
    });
  });

  describe("setLegalHold", () => {
    it("should enable legal hold on a conversation", async () => {
      const mockUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const mockFindOne = jest.fn().mockResolvedValue(
        makeConversation({
          id: "conv-1",
          legal_hold: true,
          legal_hold_set_at: new Date(),
        }),
      );

      const { AppDataSource } = require("../../database/data-source");
      AppDataSource.getRepository = jest.fn().mockReturnValue({
        update: mockUpdate,
        findOne: mockFindOne,
      });

      const result = await service.setLegalHold("conv-1", "org-1", true);

      expect(result).not.toBeNull();
      expect(result!.legal_hold).toBe(true);
      expect(mockUpdate).toHaveBeenCalledWith(
        { id: "conv-1", organization_id: "org-1" },
        expect.objectContaining({ legal_hold: true }),
      );
    });

    it("should disable legal hold on a conversation", async () => {
      const mockUpdate = jest.fn().mockResolvedValue({ affected: 1 });
      const mockFindOne = jest.fn().mockResolvedValue(
        makeConversation({
          id: "conv-1",
          legal_hold: false,
          legal_hold_set_at: new Date(),
        }),
      );

      const { AppDataSource } = require("../../database/data-source");
      AppDataSource.getRepository = jest.fn().mockReturnValue({
        update: mockUpdate,
        findOne: mockFindOne,
      });

      const result = await service.setLegalHold("conv-1", "org-1", false);

      expect(result).not.toBeNull();
      expect(result!.legal_hold).toBe(false);
    });

    it("should return null when conversation does not exist", async () => {
      const mockUpdate = jest.fn().mockResolvedValue({ affected: 0 });

      const { AppDataSource } = require("../../database/data-source");
      AppDataSource.getRepository = jest.fn().mockReturnValue({
        update: mockUpdate,
      });

      const result = await service.setLegalHold("nonexistent", "org-1", true);

      expect(result).toBeNull();
    });
  });

  // ─── Test Helpers ────────────────────────────────────────────────

  /**
   * Set up single-organization mock repositories
   */
  function setupRepositories(config: {
    organizations: Array<Record<string, unknown>>;
    expiredConversations?: Array<Record<string, unknown>>;
    messagesDeleted?: number;
    embeddingsDeleted?: number;
    shouldThrowOnConvQuery?: boolean;
  }) {
    const { AppDataSource } = require("../../database/data-source");

    // Reset query builder mocks
    orgQueryBuilder.getMany.mockResolvedValue(config.organizations);

    if (config.shouldThrowOnConvQuery) {
      convQueryBuilder.getMany.mockRejectedValue(new Error("Database error"));
    } else {
      convQueryBuilder.getMany.mockResolvedValue(config.expiredConversations || []);
    }

    convQueryBuilder.execute.mockResolvedValue({ affected: 0 });
    msgQueryBuilder.execute.mockResolvedValue({
      affected: config.messagesDeleted || 0,
    });
    mockDeleteByConversationIds.mockResolvedValue(config.embeddingsDeleted || 0);
    mockSave.mockResolvedValue({});

    // Set up repos in order: Organization, Conversation, Message, AuditLog
    let callCount = 0;
    AppDataSource.getRepository = jest.fn().mockImplementation(() => {
      callCount++;
      switch (callCount) {
        case 1: // Organization repo
          return {
            createQueryBuilder: jest.fn().mockReturnValue(orgQueryBuilder),
          };
        case 2: // Conversation repo
          return {
            createQueryBuilder: jest.fn().mockReturnValue(convQueryBuilder),
          };
        case 3: // Message repo
          return {
            createQueryBuilder: jest.fn().mockReturnValue(msgQueryBuilder),
          };
        case 4: // AuditLog repo
          return { save: mockSave.mockResolvedValue({}) };
        default:
          return {
            createQueryBuilder: jest.fn().mockReturnValue(convQueryBuilder),
            save: mockSave.mockResolvedValue({}),
          };
      }
    });
  }

  /**
   * Set up multi-organization mock repositories.
   *
   * The service calls getRepository 4 times at the start (Org, Conv, Msg, AuditLog)
   * and then reuses those same repo references. createQueryBuilder is called
   * on each repo per-org iteration, so we need the mock to return different
   * query builders on successive calls.
   */
  function setupMultiOrgRepositories(
    orgConfigs: Array<{
      org: Record<string, unknown>;
      conversations: Array<Record<string, unknown>>;
      messagesDeleted?: number;
      embeddingsDeleted?: number;
      shouldThrow?: boolean;
    }>,
  ) {
    const { AppDataSource } = require("../../database/data-source");
    const orgs = orgConfigs.map((c) => c.org);

    let embeddingCallIdx = 0;

    const orgQb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(orgs),
    };

    // Per-org conversation query builders
    const convQbs = orgConfigs.map((config) => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      getMany: config.shouldThrow
        ? jest.fn().mockRejectedValue(new Error("Simulated error"))
        : jest.fn().mockResolvedValue(config.conversations),
      execute: jest.fn().mockResolvedValue({ affected: 0 }),
    }));

    const msgQbs = orgConfigs.map((config) => ({
      delete: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ affected: config.messagesDeleted || 0 }),
    }));

    mockDeleteByConversationIds.mockImplementation(() => {
      const idx = embeddingCallIdx++;
      return Promise.resolve(orgConfigs[idx]?.embeddingsDeleted || 0);
    });

    mockSave.mockResolvedValue({});

    // convCreateQBCallCount tracks how many times convRepo.createQueryBuilder is called
    // For each org with conversations: 1 call for find, 1 call for update = 2 calls
    // For each org without conversations: 1 call for find = 1 call
    let convCreateQBCallCount = 0;
    let msgCreateQBCallCount = 0;

    // createQueryBuilder on conv repo is called per-org for find, and again for update
    const convCreateQB = jest.fn().mockImplementation(() => {
      const callNum = convCreateQBCallCount++;
      // Map call number to org index: each org with convs gets 2 calls (find + update)
      // Each org without convs gets 1 call (find only)
      let orgIdx = 0;
      let remaining = callNum;
      for (let i = 0; i < orgConfigs.length; i++) {
        const callsForOrg =
          !orgConfigs[i].shouldThrow && orgConfigs[i].conversations.length > 0 ? 2 : 1;
        if (remaining < callsForOrg) {
          orgIdx = i;
          break;
        }
        remaining -= callsForOrg;
        orgIdx = i + 1;
      }
      orgIdx = Math.min(orgIdx, convQbs.length - 1);
      return convQbs[orgIdx];
    });

    const msgCreateQB = jest.fn().mockImplementation(() => {
      const idx = Math.min(msgCreateQBCallCount++, msgQbs.length - 1);
      return msgQbs[idx];
    });

    // getRepository is called 4 times at the top: Org, Conv, Msg, AuditLog
    let callCount = 0;
    AppDataSource.getRepository = jest.fn().mockImplementation(() => {
      callCount++;
      switch (callCount) {
        case 1: // Organization repo
          return { createQueryBuilder: jest.fn().mockReturnValue(orgQb) };
        case 2: // Conversation repo (reused for all orgs)
          return { createQueryBuilder: convCreateQB };
        case 3: // Message repo (reused for all orgs)
          return { createQueryBuilder: msgCreateQB };
        case 4: // AuditLog repo
          return { save: mockSave.mockResolvedValue({}) };
        default:
          return { save: mockSave.mockResolvedValue({}) };
      }
    });
  }
});
