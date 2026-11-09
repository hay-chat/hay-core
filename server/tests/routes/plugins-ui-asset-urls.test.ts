import { describe, it, expect, jest, beforeEach } from "@jest/globals";

/**
 * plugins.getUiAssetUrls — signed, org-scoped URLs of a plugin's UI bundle.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

jest.mock("@server/trpc", () => {
  const { t } = jest.requireActual<typeof import("@server/trpc/init")>("@server/trpc/init");
  return { authenticatedProcedure: t.procedure, scopedProcedure: () => t.procedure };
});

const mockFindByPluginId = jest.fn<(pluginId: string) => Promise<unknown>>();
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId: mockFindByPluginId },
}));

const mockFindByOrgAndPlugin = jest.fn<(org: string, pluginId: string) => Promise<unknown>>();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin: mockFindByOrgAndPlugin },
}));

jest.mock("@server/config/env", () => {
  const actual = jest.requireActual<typeof import("@server/config/env")>("@server/config/env");
  return {
    ...actual,
    config: {
      ...actual.config,
      jwt: { ...actual.config.jwt, secret: "test-jwt-secret" },
      plugins: { ...actual.config.plugins, allowCustomPluginUi: true },
    },
    getApiUrl: () => "http://api.test",
  };
});

jest.mock("@server/services/plugin-manager.service", () => ({ pluginManagerService: {} }));
jest.mock("@server/services/plugin-ui.service", () => ({ pluginUIService: {} }));
jest.mock("@server/services/plugin-runner.service", () => ({ getPluginRunnerService: jest.fn() }));
jest.mock("@server/services/plugin-cron.service", () => ({ pluginCronService: {} }));
jest.mock("@server/services/oauth.service", () => ({ oauthService: {} }));
jest.mock("@server/services/mcp-client-factory.service", () => ({ MCPClientFactory: {} }));
jest.mock("@server/services/plugin-tools.service", () => ({
  fetchToolsFromWorker: jest.fn(),
  fetchAndStoreTools: jest.fn(),
}));
jest.mock("@server/entities/plugin-registry.entity", () => ({ PluginStatus: {} }));

import { t } from "@server/trpc/init";
import { getPluginUiAssetUrls } from "@server/routes/v1/plugins/plugins.handler";
import { verifyPluginUiSignature } from "@server/services/plugin-asset.service";
import type { Context } from "@server/trpc/context";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

const callerFor = (organizationId: string) =>
  t.router({ getUiAssetUrls: getPluginUiAssetUrls }).createCaller({ organizationId } as Context);

describe("plugins.getUiAssetUrls", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByOrgAndPlugin.mockResolvedValue(null);
  });

  it("signs the bundle and stylesheet of a core plugin for the caller's organization", async () => {
    mockFindByPluginId.mockResolvedValue({ pluginId: "demo", sourceType: "core" });

    const urls = await callerFor(ORG_A).getUiAssetUrls({ pluginId: "demo" });

    const script = new URL(urls.script);
    const style = new URL(urls.style);
    expect(script.pathname).toBe("/plugins/ui/demo/ui.js");
    expect(style.pathname).toBe("/plugins/ui/demo/style.css");
    expect(verifyPluginUiSignature("demo", Object.fromEntries(script.searchParams))).toBe(ORG_A);
  });

  it("refuses unknown plugins and other organizations' custom plugins", async () => {
    mockFindByPluginId.mockResolvedValue(null);
    await expect(callerFor(ORG_A).getUiAssetUrls({ pluginId: "missing" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    mockFindByPluginId.mockResolvedValue({
      pluginId: "demo",
      sourceType: "custom",
      organizationId: ORG_A,
    });
    mockFindByOrgAndPlugin.mockResolvedValue({ enabled: true });
    await expect(callerFor(ORG_B).getUiAssetUrls({ pluginId: "demo" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(callerFor(ORG_A).getUiAssetUrls({ pluginId: "demo" })).resolves.toBeDefined();
  });
});
