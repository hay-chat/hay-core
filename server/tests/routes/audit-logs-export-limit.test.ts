import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/** An export over the row cap is refused, never silently cut short. */

const mockGetLogs =
  jest.fn<(options: { limit?: number }) => Promise<{ logs: unknown[]; total: number }>>();
const mockRecord = jest.fn(async () => undefined);
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: {
    getLogs: mockGetLogs,
    record: mockRecord,
    logPermissionDenied: jest.fn(async () => undefined),
  },
}));

import { auditLogsRouter } from "@server/routes/v1/audit-logs";
import { getDefaultScopesForRole, matchesScope } from "@server/types/scopes";
import type { Context } from "@server/trpc/context";

const scopes = getDefaultScopesForRole("owner");
const caller = auditLogsRouter.createCaller({
  user: {
    id: "22222222-2222-4222-8222-222222222222",
    hasScope: (resource: string, action: string) => matchesScope(`${resource}:${action}`, scopes),
    getRole: () => "owner",
    userOrganization: { organization: {} },
  },
  organizationId: "11111111-1111-4111-8111-111111111111",
  req: { headers: {} },
  res: {},
} as unknown as Context);

describe("auditLogs.export", () => {
  beforeEach(() => jest.clearAllMocks());

  it("bounds the query and refuses when more rows match than the cap", async () => {
    mockGetLogs.mockResolvedValue({ logs: [], total: 60_000 });

    await expect(caller.export({ format: "json" })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mockGetLogs).toHaveBeenCalledWith(expect.objectContaining({ limit: 50_000 }));
    expect(mockRecord).not.toHaveBeenCalled();
  });
});
