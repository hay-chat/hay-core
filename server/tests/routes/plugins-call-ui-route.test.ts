import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * plugins.callUiRoute — authenticated, org-scoped forwarding of plugin settings
 * UI calls to the plugin's own worker `/ui/*` routes.
 */

const mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
jest.mock("@server/lib/logger", () => ({ createLogger: () => mockLogger }));

jest.mock("@server/trpc", () => {
  const { t } = jest.requireActual<typeof import("@server/trpc/init")>("@server/trpc/init");
  return { authenticatedProcedure: t.procedure };
});

const mockFindByOrgAndPlugin = jest.fn<(org: string, pluginId: string) => Promise<unknown>>();
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin: mockFindByOrgAndPlugin },
}));

const mockStartPluginWorker = jest.fn<(org: string, pluginId: string) => Promise<unknown>>();
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { startPluginWorker: mockStartPluginWorker },
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
jest.mock("@server/entities/plugin-registry.entity", () => ({ PluginStatus: {} }));

import { TRPCError } from "@trpc/server";
import { forwardPluginUiRoute, isPluginUiPath } from "@server/routes/v1/plugins/plugins.handler";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PLUGIN_ID = "hay-channel-whatsapp-meta";

describe("isPluginUiPath", () => {
  it.each(["/ui/status", "/ui/whatsapp/health", "/ui/"])("allows %s", (path) => {
    expect(isPluginUiPath(path)).toBe(true);
  });

  it.each([
    "/deliver",
    "/ui/../deliver",
    "/ui//x",
    "/UI/status",
    "/mcp/call-tool",
    "/ui",
    "/ui/status?x=1",
    "ui/status",
  ])("rejects %s", (path) => {
    expect(isPluginUiPath(path)).toBe(false);
  });
});

describe("forwardPluginUiRoute", () => {
  const fetchMock = jest.fn<typeof fetch>();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock;
    mockFindByOrgAndPlugin.mockResolvedValue({ enabled: true });
    mockStartPluginWorker.mockResolvedValue({ port: 5555 });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const expectCode = async (promise: Promise<unknown>, code: TRPCError["code"]) => {
    await expect(promise).rejects.toBeInstanceOf(TRPCError);
    await expect(promise).rejects.toMatchObject({ code });
  };

  it("forwards a GET to the org's worker and returns status + JSON", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ connected: true }), { status: 200 }));

    const result = await forwardPluginUiRoute(ORG_ID, {
      pluginId: PLUGIN_ID,
      method: "GET",
      path: "/ui/status",
    });

    expect(result).toEqual({ status: 200, data: { connected: true } });
    expect(mockFindByOrgAndPlugin).toHaveBeenCalledWith(ORG_ID, PLUGIN_ID);
    expect(mockStartPluginWorker).toHaveBeenCalledWith(ORG_ID, PLUGIN_ID);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:5555/ui/status");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("sends a JSON body on POST and passes through non-2xx statuses", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "bad" }), { status: 422 }));

    const result = await forwardPluginUiRoute(ORG_ID, {
      pluginId: PLUGIN_ID,
      method: "POST",
      path: "/ui/register",
      body: { pin: "123456" },
    });

    expect(result).toEqual({ status: 422, data: { error: "bad" } });
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"pin":"123456"}');
  });

  it("returns data null for an empty or non-JSON response", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(
      forwardPluginUiRoute(ORG_ID, { pluginId: PLUGIN_ID, method: "GET", path: "/ui/status" }),
    ).resolves.toEqual({ status: 204, data: null });

    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 500 }));
    await expect(
      forwardPluginUiRoute(ORG_ID, { pluginId: PLUGIN_ID, method: "GET", path: "/ui/status" }),
    ).resolves.toEqual({ status: 500, data: null });
  });

  it("never logs the request body", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await forwardPluginUiRoute(ORG_ID, {
      pluginId: PLUGIN_ID,
      method: "POST",
      path: "/ui/register",
      body: { secret: "do-not-log" },
    });
    const logged = JSON.stringify([...mockLogger.debug.mock.calls, ...mockLogger.info.mock.calls]);
    expect(logged).not.toContain("do-not-log");
  });

  it("rejects an invalid path before touching the instance", async () => {
    await expectCode(
      forwardPluginUiRoute(ORG_ID, { pluginId: PLUGIN_ID, method: "GET", path: "/deliver" }),
      "BAD_REQUEST",
    );
    expect(mockFindByOrgAndPlugin).not.toHaveBeenCalled();
  });

  it("is NOT_FOUND when the org has no instance", async () => {
    mockFindByOrgAndPlugin.mockResolvedValue(null);
    await expectCode(
      forwardPluginUiRoute(ORG_ID, { pluginId: PLUGIN_ID, method: "GET", path: "/ui/status" }),
      "NOT_FOUND",
    );
    expect(mockStartPluginWorker).not.toHaveBeenCalled();
  });

  it("is PRECONDITION_FAILED when the instance is disabled", async () => {
    mockFindByOrgAndPlugin.mockResolvedValue({ enabled: false });
    await expectCode(
      forwardPluginUiRoute(ORG_ID, { pluginId: PLUGIN_ID, method: "GET", path: "/ui/status" }),
      "PRECONDITION_FAILED",
    );
    expect(mockStartPluginWorker).not.toHaveBeenCalled();
  });

  it("maps an aborted request to TIMEOUT", async () => {
    const abort = new Error("aborted");
    abort.name = "AbortError";
    fetchMock.mockRejectedValue(abort);
    await expectCode(
      forwardPluginUiRoute(ORG_ID, { pluginId: PLUGIN_ID, method: "GET", path: "/ui/status" }),
      "TIMEOUT",
    );
  });

  it("maps a network failure to INTERNAL_SERVER_ERROR", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expectCode(
      forwardPluginUiRoute(ORG_ID, { pluginId: PLUGIN_ID, method: "GET", path: "/ui/status" }),
      "INTERNAL_SERVER_ERROR",
    );
  });
});
