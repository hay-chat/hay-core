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
    mockGetPlugin.mockReturnValue({
      metadata: { routes: [{ method: "POST", path: "/webhook" }] },
    });
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
  it("allows a bounded number of cold starts per plugin per minute", () => {
    const start = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 40; i++) {
      if (takeColdStartSlot("cold-start-test", start + i)) allowed++;
    }
    expect(allowed).toBe(30);
    expect(takeColdStartSlot("another-plugin", start)).toBe(true);
    expect(takeColdStartSlot("cold-start-test", start + 60_000)).toBe(true);
  });
});
