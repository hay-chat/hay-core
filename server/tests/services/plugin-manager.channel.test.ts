const findEnabledByOrganization = jest.fn();

jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: {},
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findEnabledByOrganization },
}));
jest.mock("../../services/plugin-runner.service", () => ({
  getPluginRunnerService: () => ({}),
}));

import { pluginManagerService } from "../../services/plugin-manager.service";

const instance = (pluginId: string, channel?: string) => ({
  pluginId: `uuid-${pluginId}`,
  enabled: true,
  plugin: { pluginId, manifest: { id: pluginId, channel } },
});

describe("pluginManagerService.findPluginIdByChannel", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    pluginManagerService.registry.clear();
  });

  it("resolves the org's enabled plugin instance for the channel", async () => {
    findEnabledByOrganization.mockResolvedValue([
      instance("hay-channel-instagram-meta", "instagram"),
      instance("hay-channel-whatsapp-meta", "whatsapp"),
    ]);

    await expect(pluginManagerService.findPluginIdByChannel("org-a", "whatsapp")).resolves.toBe(
      "hay-channel-whatsapp-meta",
    );
    expect(findEnabledByOrganization).toHaveBeenCalledWith("org-a");
  });

  it("resolves different plugins for the same channel in different orgs", async () => {
    findEnabledByOrganization.mockImplementation(async (orgId: string) =>
      orgId === "org-a"
        ? [instance("hay-channel-whatsapp-twilio", "whatsapp")]
        : [instance("hay-channel-whatsapp-meta", "whatsapp")],
    );

    await expect(pluginManagerService.findPluginIdByChannel("org-a", "whatsapp")).resolves.toBe(
      "hay-channel-whatsapp-twilio",
    );
    await expect(pluginManagerService.findPluginIdByChannel("org-b", "whatsapp")).resolves.toBe(
      "hay-channel-whatsapp-meta",
    );
  });

  it("returns null when no enabled instance claims the channel", async () => {
    findEnabledByOrganization.mockResolvedValue([
      instance("hay-channel-instagram-meta", "instagram"),
      instance("hay-plugin-shopify"),
    ]);

    await expect(
      pluginManagerService.findPluginIdByChannel("org-a", "whatsapp"),
    ).resolves.toBeNull();
  });

  it("prefers the in-memory registry manifest over the stored copy", async () => {
    pluginManagerService.registry.set("hay-channel-x", {
      pluginId: "hay-channel-x",
      manifest: { id: "hay-channel-x", channel: "whatsapp" },
    } as never);
    findEnabledByOrganization.mockResolvedValue([instance("hay-channel-x", "stale-slug")]);

    await expect(pluginManagerService.findPluginIdByChannel("org-a", "whatsapp")).resolves.toBe(
      "hay-channel-x",
    );
  });

  it("picks deterministically when two enabled plugins share a slug", async () => {
    findEnabledByOrganization.mockResolvedValue([
      instance("hay-channel-whatsapp-twilio", "whatsapp"),
      instance("hay-channel-whatsapp-meta", "whatsapp"),
    ]);

    await expect(pluginManagerService.findPluginIdByChannel("org-a", "whatsapp")).resolves.toBe(
      "hay-channel-whatsapp-meta",
    );
  });
});
