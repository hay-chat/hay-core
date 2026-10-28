import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * D14-8: organizations created from now on keep conversations for 365 days by
 * default (Roger's D14 answer 7). Existing organizations are not touched.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

const mockCreate = jest.fn((data: Record<string, unknown>) => ({ id: "org-new", ...data }));
const manager = {
  getRepository: () => ({
    create: mockCreate,
    findOne: async () => null,
    save: async () => undefined,
  }),
};
jest.mock("@server/database/data-source", () => ({
  AppDataSource: {
    isInitialized: false,
    getRepository: () => ({}),
    transaction: (run: (m: typeof manager) => Promise<unknown>) => run(manager),
  },
}));
jest.mock("@server/services/organization.service", () => ({
  organizationService: { generateUniqueSlug: async () => "casa-aurora" },
}));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logOrganizationCreated: async () => undefined },
}));

import { organizationsRouter } from "@server/routes/v1/organizations";
import { DEFAULT_NEW_ORG_RETENTION_DAYS } from "@server/types/organization-settings.types";
import type { Context } from "@server/trpc/context";

const ctx = {
  user: { id: "user-1", isAuthenticated: () => true },
  organizationId: "11111111-1111-4111-8111-111111111111",
  req: { headers: {} },
  res: {},
} as unknown as Context;

describe("new organization retention default", () => {
  beforeEach(() => jest.clearAllMocks());

  it("starts a new organization at 365 days", async () => {
    await organizationsRouter.createCaller(ctx).create({ name: "Casa Aurora" });

    expect(DEFAULT_NEW_ORG_RETENTION_DAYS).toBe(365);
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Casa Aurora", settings: { retentionDays: 365 } }),
    );
  });
});
