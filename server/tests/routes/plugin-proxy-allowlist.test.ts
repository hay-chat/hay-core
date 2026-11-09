/**
 * The public plugin proxy only reaches routes a plugin declared with
 * register.route(), only for orgs that enabled the plugin, and bounds how fast
 * it wakes workers.
 */
const mockGetPlugin = jest.fn();
const mockStartPluginWorker = jest.fn();
const mockFindByOrgAndPlugin = jest.fn();
const mockFindOrgById = jest.fn();
const mockIsRunning = jest.fn();
const mockWorkerFetch = jest.fn();

jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { getPlugin: mockGetPlugin, startPluginWorker: mockStartPluginWorker },
}));
jest.mock("@server/services/plugin-instance-manager.service", () => ({
  pluginInstanceManagerService: { updateActivityTimestamp: jest.fn(async () => undefined) },
}));
jest.mock("@server/services/webhook-router.service", () => ({
  webhookRouterService: { getRoutingDescriptor: jest.fn(async () => null) },
}));
jest.mock("@server/repositories/organization.repository", () => ({
  organizationRepository: { findById: mockFindOrgById },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin: mockFindByOrgAndPlugin },
}));
jest.mock("@server/services/plugin-runner.service", () => ({
  getPluginRunnerService: () => ({ isRunning: mockIsRunning }),
}));
jest.mock("@server/lib/worker-client", () => ({
  WORKER_HOST: "127.0.0.1",
  workerFetch: mockWorkerFetch,
}));

import express from "express";
import type { Server } from "http";
import type { AddressInfo } from "net";
import proxyRouter, { isDeclaredRoute, takeColdStartSlot } from "../../routes/v1/plugins/proxy";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const PLUGIN = "hay-plugin-acme";
const pluginWith = (routes: unknown[]) => ({ metadataState: "fresh", metadata: { routes } });

describe("plugin proxy allow-list", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use("/v1/plugins", proxyRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/plugins/${PLUGIN}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindOrgById.mockResolvedValue({ id: ORG_ID });
    mockFindByOrgAndPlugin.mockResolvedValue({ enabled: true });
    mockGetPlugin.mockReturnValue(pluginWith([{ method: "POST", path: "/webhook", public: true }]));
    mockIsRunning.mockReturnValue(true);
    mockStartPluginWorker.mockResolvedValue({ port: 40123 });
    mockWorkerFetch.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
  });

  it("forwards a declared route to the org's worker", async () => {
    const response = await fetch(`${baseUrl}/webhook?organizationId=${ORG_ID}&x=1`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(response.status).toBe(200);
    expect(mockWorkerFetch).toHaveBeenCalledWith(
      40123,
      `/webhook?organizationId=${ORG_ID}&x=1`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns 404 for a route the plugin did not declare, without waking a worker", async () => {
    const response = await fetch(`${baseUrl}/admin/reset?organizationId=${ORG_ID}`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(mockStartPluginWorker).not.toHaveBeenCalled();
    expect(mockWorkerFetch).not.toHaveBeenCalled();
  });

  it("returns 404 for a declared route that is not public", async () => {
    mockGetPlugin.mockReturnValue(pluginWith([{ method: "POST", path: "/internal-action" }]));

    const response = await fetch(`${baseUrl}/internal-action?organizationId=${ORG_ID}`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(mockWorkerFetch).not.toHaveBeenCalled();
  });

  it("wakes the worker when cached metadata is stale, then applies the refreshed routes", async () => {
    mockGetPlugin
      .mockReturnValueOnce({ metadataState: "stale", metadata: { routes: [] } })
      .mockReturnValue(pluginWith([{ method: "POST", path: "/webhook", public: true }]));

    const response = await fetch(`${baseUrl}/webhook?organizationId=${ORG_ID}`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(mockWorkerFetch).toHaveBeenCalled();
  });

  it("drops worker headers that could act on the API origin", async () => {
    mockWorkerFetch.mockResolvedValue(
      new Response("<script>1</script>", {
        status: 200,
        headers: {
          "content-type": "text/html",
          "set-cookie": "session=x",
          "content-security-policy": "default-src *",
          "access-control-allow-origin": "*",
          etag: '"abc"',
        },
      }),
    );

    const response = await fetch(`${baseUrl}/webhook?organizationId=${ORG_ID}`, {
      method: "POST",
    });

    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBe("sandbox");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("etag")).toBe('"abc"');
  });

  it("returns 404 for a declared path with an undeclared method", async () => {
    const response = await fetch(`${baseUrl}/webhook?organizationId=${ORG_ID}`);
    expect(response.status).toBe(404);
    expect(mockWorkerFetch).not.toHaveBeenCalled();
  });

  it("returns 404 when the org has not enabled the plugin, without waking a worker", async () => {
    mockFindByOrgAndPlugin.mockResolvedValue(null);

    const response = await fetch(`${baseUrl}/webhook?organizationId=${ORG_ID}`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(mockStartPluginWorker).not.toHaveBeenCalled();
  });

  it("checks freshly fetched metadata when none was cached", async () => {
    mockGetPlugin.mockReturnValueOnce(undefined).mockReturnValue({ metadata: { routes: [] } });

    const response = await fetch(`${baseUrl}/webhook?organizationId=${ORG_ID}`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(mockWorkerFetch).not.toHaveBeenCalled();
  });

  it.each(["/setup/status", "/webchat/gate/conversation.create", "/mcp/call-tool"])(
    "never forwards runner endpoint %s",
    async (path) => {
      mockGetPlugin.mockReturnValue({ metadata: { routes: [{ method: "POST", path }] } });

      const response = await fetch(`${baseUrl}${path}?organizationId=${ORG_ID}`, {
        method: "POST",
      });

      expect(response.status).toBe(404);
      expect(mockFindByOrgAndPlugin).not.toHaveBeenCalled();
    },
  );
});

describe("isDeclaredRoute", () => {
  const routes = [
    { method: "POST" as const, path: "/webhook" },
    { method: "GET" as const, path: "/oauth/:provider/callback" },
  ];

  it("matches the way the worker's router does", () => {
    expect(isDeclaredRoute(routes, "post", "/webhook")).toBe(true);
    expect(isDeclaredRoute(routes, "POST", "/Webhook/")).toBe(true);
    expect(isDeclaredRoute(routes, "GET", "/oauth/meta/callback")).toBe(true);
    expect(isDeclaredRoute(routes, "HEAD", "/oauth/meta/callback")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isDeclaredRoute(routes, "GET", "/webhook")).toBe(false);
    expect(isDeclaredRoute(routes, "POST", "/webhook/extra")).toBe(false);
    expect(isDeclaredRoute(routes, "POST", "//webhook")).toBe(false);
    expect(isDeclaredRoute(routes, "GET", "/oauth//callback")).toBe(false);
    expect(isDeclaredRoute(routes, "POST", "")).toBe(false);
  });
});

describe("takeColdStartSlot", () => {
  const start = 1_000_000;

  it("allows a bounded number of cold starts per plugin and organization", () => {
    let allowed = 0;
    for (let i = 0; i < 40; i++) {
      if (takeColdStartSlot("budget-plugin", "org-a", `10.0.0.${i}`, start + i)) allowed++;
    }
    expect(allowed).toBe(30);
    expect(takeColdStartSlot("budget-plugin", "org-b", "10.0.1.1", start)).toBe(true);
    expect(takeColdStartSlot("other-plugin", "org-a", "10.0.1.2", start)).toBe(true);
    expect(takeColdStartSlot("budget-plugin", "org-a", "10.0.1.3", start + 60_000)).toBe(true);
  });

  it("stops one client spreading cold starts across organizations", () => {
    let allowed = 0;
    for (let i = 0; i < 150; i++) {
      if (takeColdStartSlot("ip-plugin", `org-${i}`, "10.9.9.9", start + i)) allowed++;
    }
    expect(allowed).toBe(120);
    expect(takeColdStartSlot("ip-plugin", "org-0", "10.9.9.10", start)).toBe(true);
  });

  it("does not spend the organization's budget on a refused client", () => {
    for (let i = 0; i < 120; i++) takeColdStartSlot("spend-plugin", `o-${i}`, "10.8.8.8", start);
    for (let i = 0; i < 5; i++) takeColdStartSlot("spend-plugin", "victim", "10.8.8.8", start);

    let allowed = 0;
    for (let i = 0; i < 30; i++) {
      if (takeColdStartSlot("spend-plugin", "victim", `10.8.7.${i}`, start)) allowed++;
    }
    expect(allowed).toBe(30);
  });
});
