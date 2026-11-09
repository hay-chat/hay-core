import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/** plugins.* responses expose instance metadata only, never stored credentials. */

jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
jest.mock("@server/services/audit-log.service", () => ({
  auditLogService: { logPermissionDenied: jest.fn(), log: jest.fn() },
}));
jest.mock("@server/trpc", () => {
  const auth = jest.requireActual<typeof import("@server/trpc/middleware/auth")>(
    "@server/trpc/middleware/auth",
  );
  return { authenticatedProcedure: auth.protectedProcedure, scopedProcedure: auth.scopedProcedure };
});

const SECRET = "shpat_stored_credential_value";
const instance = {
  id: "instance-1",
  pluginId: "registry-1",
  organizationId: "org-1",
  enabled: false,
  runtimeState: "stopped",
  config: { apiKey: SECRET },
  authState: { methodId: "oauth", credentials: { accessToken: SECRET, refreshToken: SECRET } },
};
const findByOrgAndPlugin = jest.fn<() => Promise<unknown>>();
const findByOrganization = jest.fn<() => Promise<unknown>>();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin, findByOrganization },
}));
const getPlugin = jest.fn<() => unknown>();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { getPlugin },
  isPluginVisibleToOrganization: () => true,
  assertCustomPluginsAllowed: jest.fn(),
}));
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: {},
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
import {
  getPlugin as getPluginProcedure,
  getPluginInstances,
} from "@server/routes/v1/plugins/plugins.handler";

const router = t.router({ get: getPluginProcedure, getInstances: getPluginInstances });

function callerFor(role: "admin" | "member" | "contributor" | "viewer" | "agent") {
  const scopes = getDefaultScopesForRole(role);
  const user = {
    id: "user-1",
    hasScope: (resource: string, action: string) => hasRequiredScope(resource, action, scopes),
    getRole: () => role,
    userOrganization: { organization: {} },
  };
  return router.createCaller({ user, organizationId: "org-1", req: {} } as never);
}

beforeEach(() => {
  jest.clearAllMocks();
  findByOrgAndPlugin.mockResolvedValue(instance);
  findByOrganization.mockResolvedValue([instance]);
  getPlugin.mockReturnValue({ pluginId: "p", name: "P", manifest: {}, metadata: {} });
});

describe("plugin read responses", () => {
  it("plugins.get omits stored credentials and keeps the auth method", async () => {
    const result = await callerFor("admin").get({ pluginId: "p" });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).toMatchObject({ instanceId: "instance-1", authMethod: "oauth" });
    expect(result).not.toHaveProperty("auth");
  });

  it("plugins.getInstances returns no credentials or config", async () => {
    const [dto] = await callerFor("member").getInstances();
    expect(JSON.stringify(dto)).not.toContain(SECRET);
    expect(dto).toMatchObject({ id: "instance-1", authMethod: "oauth" });
  });

  it.each(["viewer", "agent"] as const)("denies %s", async (role) => {
    await expect(callerFor(role).get({ pluginId: "p" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(callerFor(role).getInstances()).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
