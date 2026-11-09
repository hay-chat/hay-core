import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import { DataRetentionService } from "../../services/data-retention.service";

// The retention sweeps themselves run against a real database: tests/integration/data-lifecycle.test.ts

// Mock AppDataSource
jest.mock("../../database/data-source", () => ({
  AppDataSource: {
    getRepository: jest.fn().mockReturnValue({
      createQueryBuilder: jest.fn(),
      save: jest.fn(),
    }),
  },
}));

// Mock centralized logger
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
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

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DataRetentionService();
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
});
