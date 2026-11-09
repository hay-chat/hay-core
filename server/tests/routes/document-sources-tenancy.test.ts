import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/** documentSources.create only accepts the caller's own plugin instance. */

jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logPermissionDenied: jest.fn(async () => undefined) },
}));

const mockGetPlugin = jest.fn();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { getPlugin: mockGetPlugin },
}));

const mockFindByOrgAndPlugin =
  jest.fn<(orgId: string, pluginId: string) => Promise<{ id: string } | null>>();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin: mockFindByOrgAndPlugin },
}));

const mockCreate = jest.fn(async (data: Record<string, unknown>) => ({ id: "source-1", ...data }));
jest.mock("@server/repositories/document-source.repository", () => ({
  documentSourceRepository: { create: mockCreate },
}));

import { documentSourcesRouter } from "@server/routes/v1/document-sources";
import { getDefaultScopesForRole, matchesScope } from "@server/types/scopes";
import type { Context } from "@server/trpc/context";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const OWN_INSTANCE = "33333333-3333-4333-8333-333333333333";
const FOREIGN_INSTANCE = "55555555-5555-4555-8555-555555555555";

const scopes = getDefaultScopesForRole("owner");
const caller = documentSourcesRouter.createCaller({
  user: {
    id: "22222222-2222-4222-8222-222222222222",
    hasScope: (resource: string, action: string) => matchesScope(`${resource}:${action}`, scopes),
    getRole: () => "owner",
    userOrganization: { organization: {} },
  },
  organizationId: ORG_ID,
  req: { headers: {} },
  res: {},
} as unknown as Context);

const input = (pluginInstanceId: string) => ({
  pluginId: "notion",
  pluginInstanceId,
  displayName: "Docs",
  sourceType: "notion",
});

describe("documentSources.create", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPlugin.mockReturnValue({ manifest: { capabilities: { document_importer: true } } });
    mockFindByOrgAndPlugin.mockResolvedValue({ id: OWN_INSTANCE });
  });

  it("refuses a sync interval shorter than the dashboard's fastest schedule", async () => {
    await expect(
      caller.create({ ...input(OWN_INSTANCE), syncIntervalMs: 1000 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects another organization's plugin instance", async () => {
    await expect(caller.create(input(FOREIGN_INSTANCE))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(mockFindByOrgAndPlugin).toHaveBeenCalledWith(ORG_ID, "notion");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects when the organization has no instance of the plugin", async () => {
    mockFindByOrgAndPlugin.mockResolvedValue(null);
    await expect(caller.create(input(OWN_INSTANCE))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates a source for the organization's own instance", async () => {
    await caller.create(input(OWN_INSTANCE));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORG_ID, pluginInstanceId: OWN_INSTANCE }),
    );
  });
});
