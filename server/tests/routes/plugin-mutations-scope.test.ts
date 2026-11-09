import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * Plugin and git-connection mutations install or configure plugin code, so
 * they require the plugins:manage scope (admins/owners), not just a session.
 */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logPermissionDenied: jest.fn() },
}));
jest.mock("@server/trpc", () => {
  const auth = jest.requireActual<typeof import("@server/trpc/middleware/auth")>(
    "@server/trpc/middleware/auth",
  );
  return { authenticatedProcedure: auth.protectedProcedure, scopedProcedure: auth.scopedProcedure };
});

const syncPlugin = jest.fn<(id: string, org: string) => Promise<unknown>>();
const installPluginFromRepo = jest.fn<(params: unknown) => Promise<unknown>>();
jest.mock("@server/services/git-connection.service", () => ({
  gitConnectionService: { syncPlugin, installPluginFromRepo },
}));

const getPlugin = jest.fn<(id: string) => unknown>();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { getPlugin },
  isPluginVisibleToOrganization: jest.requireActual<
    typeof import("@server/services/plugin-manager.service")
  >("@server/services/plugin-manager.service").isPluginVisibleToOrganization,
  assertCustomPluginsAllowed: jest.fn(),
}));
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: {},
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("@server/services/plugin-ui.service", () => ({ pluginUIService: {} }));
jest.mock("@server/services/plugin-runner.service", () => ({ getPluginRunnerService: jest.fn() }));
jest.mock("@server/services/plugin-cron.service", () => ({ pluginCronService: {} }));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));
jest.mock("@server/services/mcp-client-factory.service", () => ({ MCPClientFactory: {} }));
jest.mock("@server/services/plugin-tools.service", () => ({
  fetchToolsFromWorker: jest.fn(),
  fetchAndStoreTools: jest.fn(),
}));

import { t } from "@server/trpc/init";
import { getDefaultScopesForRole, hasRequiredScope } from "@server/types/scopes";
import * as git from "@server/routes/v1/git-connections/git-connections.handler";
import {
  enablePlugin,
  getPlugin as getPluginProcedure,
} from "@server/routes/v1/plugins/plugins.handler";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const router = t.router({
  gitSync: git.syncPlugin,
  gitInstall: git.installPlugin,
  enable: enablePlugin,
  get: getPluginProcedure,
});

function callerFor(role: "owner" | "admin" | "member" | "viewer" | "contributor" | "agent") {
  const scopes = getDefaultScopesForRole(role);
  const user = {
    id: "user-1",
    hasScope: (resource: string, action: string) => hasRequiredScope(resource, action, scopes),
    getRole: () => role,
    userOrganization: { organization: {} },
  };
  return router.createCaller({ user, organizationId: ORG_B, req: {} } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("plugin and git mutations require plugins:manage", () => {
  it.each(["viewer", "member", "contributor", "agent"] as const)("denies %s", async (role) => {
    const caller = callerFor(role);
    await expect(caller.gitSync({ pluginId: "row-1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      caller.gitInstall({ connectionId: ORG_A, repoFullName: "acme/plugin" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.enable({ pluginId: "p" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(syncPlugin).not.toHaveBeenCalled();
    expect(installPluginFromRepo).not.toHaveBeenCalled();
  });

  it("allows an admin and scopes git sync to the caller's organization", async () => {
    syncPlugin.mockResolvedValue({ updated: false });
    await callerFor("admin").gitSync({ pluginId: "row-1" });
    expect(syncPlugin).toHaveBeenCalledWith("row-1", ORG_B);
  });

  it("rejects malformed repository names", async () => {
    await expect(
      callerFor("admin").gitInstall({ connectionId: ORG_A, repoFullName: "../../user" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(installPluginFromRepo).not.toHaveBeenCalled();
  });
});

describe("plugins.get / plugins.enable visibility", () => {
  const otherOrgPlugin = {
    pluginId: "private-plugin",
    sourceType: "git",
    organizationId: ORG_A,
    manifest: {},
  };

  it("hides another organization's plugin", async () => {
    getPlugin.mockReturnValue(otherOrgPlugin);
    await expect(callerFor("member").get({ pluginId: "private-plugin" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses to enable another organization's git plugin", async () => {
    getPlugin.mockReturnValue(otherOrgPlugin);
    await expect(callerFor("admin").enable({ pluginId: "private-plugin" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
