import { describe, it, expect, jest } from "@jest/globals";

const findByOrgAndPlugin = jest.fn<(orgId: string, pluginId: string) => Promise<unknown>>();
const enablePlugin = jest.fn<(...args: unknown[]) => Promise<unknown>>();

jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: { findByOrgAndPlugin, enablePlugin },
}));
jest.mock("@server/services/plugin-manager.service", () => ({
  pluginManagerService: {
    getAllPlugins: () => [
      { pluginId: "core-default", sourceType: "core", manifest: { defaultEnabled: true } },
      { pluginId: "core-disabled-by-owner", sourceType: "core", manifest: { defaultEnabled: true } },
      { pluginId: "core-optional", sourceType: "core", manifest: {} },
      { pluginId: "custom-default", sourceType: "custom", manifest: { defaultEnabled: true } },
    ],
    needsInstallation: () => false,
    needsBuilding: () => false,
  },
}));

import {
  defaultEnabledPluginIds,
  enableDefaultPlugins,
} from "@server/services/default-plugins.service";

describe("default-enabled plugins", () => {
  it("only core plugins that declare defaultEnabled qualify", () => {
    expect(defaultEnabledPluginIds()).toEqual(["core-default", "core-disabled-by-owner"]);
  });

  it("enables missing instances and never touches an existing one", async () => {
    findByOrgAndPlugin.mockImplementation(async (_org, pluginId) =>
      pluginId === "core-disabled-by-owner" ? { enabled: false } : null,
    );
    enablePlugin.mockResolvedValue({});

    await enableDefaultPlugins("org-1");

    expect(enablePlugin).toHaveBeenCalledTimes(1);
    expect(enablePlugin).toHaveBeenCalledWith("org-1", "core-default", {});
  });
});
