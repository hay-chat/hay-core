const findByPluginId = jest.fn();
const findByPlugin = jest.fn();
const startPluginWorker = jest.fn();
const getPlugin = jest.fn();

jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { findByPluginId },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByPlugin },
}));
jest.mock("@server/repositories/plugin-webhook-route.repository", () => ({
  pluginWebhookRouteRepository: {},
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: { startPluginWorker, getPlugin },
}));
jest.mock("@server/services/plugin-instance-manager.service", () => ({
  pluginInstanceManagerService: {},
}));
jest.mock("@server/services/plugin-route.service", () => ({
  verifyHmacSha256: jest.fn(),
}));

import { webhookRouterService } from "../../services/webhook-router.service";

const routing = { strategy: "shared" };

describe("webhookRouterService.getRoutingDescriptor", () => {
  beforeEach(() => jest.resetAllMocks());

  it("returns the cached descriptor without starting a worker when metadata is fresh", async () => {
    findByPluginId.mockResolvedValue({
      id: "reg-1",
      metadataState: "fresh",
      metadata: { webhookRouting: routing },
    });

    await expect(webhookRouterService.getRoutingDescriptor("p")).resolves.toBe(routing);
    expect(startPluginWorker).not.toHaveBeenCalled();
  });

  it("refreshes stale metadata through an enabled org's worker", async () => {
    findByPluginId.mockResolvedValue({ id: "reg-1", metadataState: "stale", metadata: {} });
    findByPlugin.mockResolvedValue([
      { organizationId: "org-off", enabled: false },
      { organizationId: "org-on", enabled: true },
    ]);
    getPlugin.mockReturnValue({ metadataState: "fresh", metadata: { webhookRouting: routing } });

    await expect(webhookRouterService.getRoutingDescriptor("p")).resolves.toBe(routing);
    expect(startPluginWorker).toHaveBeenCalledWith("org-on", "p");
  });

  it("falls back to cached metadata when no org has the plugin enabled", async () => {
    findByPluginId.mockResolvedValue({
      id: "reg-1",
      metadataState: "missing",
      metadata: undefined,
    });
    findByPlugin.mockResolvedValue([]);
    getPlugin.mockReturnValue(undefined);

    await expect(webhookRouterService.getRoutingDescriptor("p")).resolves.toBeNull();
    expect(startPluginWorker).not.toHaveBeenCalled();
  });
});
